import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelStream, type CommittedEvent } from "@charter/schema";
import { buildServer } from "../src/server.js";
import { openServerContext, type ServerContext } from "../src/env.js";

let ctx: ServerContext;
let app: ReturnType<typeof buildServer>;

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "charter-test-"));
  mkdirSync(join(root, "company"), { recursive: true });
  writeFileSync(
    join(root, "company", "company.json"),
    JSON.stringify({ id: "co_test", name: "Test Co" }),
  );
  ctx = openServerContext(root);
  ctx.log.append({
    company_id: "co_test",
    stream: channelStream("general"),
    type: "channel.created",
    actor: { kind: "human", id: "founder" },
    payload: { channel_id: "general", name: "general" },
  });
  // A pre-UI event on the stream — must render retroactively in the timeline.
  ctx.log.append({
    company_id: "co_test",
    stream: channelStream("general"),
    type: "devlog.note",
    actor: { kind: "human", id: "founder" },
    payload: { note: "before the UI existed" },
  });
  app = buildServer(ctx);
});

afterAll(async () => {
  await app.close();
});

function authed(url: string) {
  return {
    method: "GET" as const,
    url,
    headers: { authorization: `Bearer ${ctx.token}` },
  };
}

describe("charterd API", () => {
  it("rejects requests without the token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "evil.example.com:4614" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("bootstrap returns company and channels", async () => {
    const res = await app.inject(authed("/api/bootstrap"));
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      company: { id: string };
      channels: Array<{ channel_id: string }>;
    };
    expect(body.company.id).toBe("co_test");
    expect(body.channels.map((c) => c.channel_id)).toContain("general");
  });

  it("timeline includes pre-UI events retroactively", async () => {
    const res = await app.inject(authed("/api/channels/general/timeline"));
    const { events } = res.json() as { events: CommittedEvent[] };
    const types = events.map((e) => e.type);
    expect(types).toContain("channel.created");
    expect(types).toContain("devlog.note");
  });

  it("posts a message and the timeline picks it up", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/channels/general/messages",
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { body: "hello from the API" },
    });
    expect(post.statusCode).toBe(200);
    const { event } = post.json() as { event: CommittedEvent };
    expect(event.type).toBe("message.posted");

    const res = await app.inject(authed("/api/channels/general/timeline"));
    const { events } = res.json() as { events: CommittedEvent[] };
    expect(events.at(-1)?.id).toBe(event.id);
  });

  it("rejects empty message bodies", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/channels/general/messages",
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { body: "   " },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("SSE stream", () => {
  it("replays from a cursor, then delivers live events, gaplessly", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("no address");
    }
    const base = `http://127.0.0.1:${address.port}`;

    const controller = new AbortController();
    const res = await fetch(
      `${base}/api/events/stream?after=0&token=${ctx.token}`,
      { signal: controller.signal },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const received: CommittedEvent[] = [];
    const target = ctx.log.lastSeq() + 1;

    // Fire a live event after the stream is open.
    setTimeout(() => {
      ctx.log.append({
        company_id: "co_test",
        stream: channelStream("general"),
        type: "message.posted",
        actor: { kind: "human", id: "founder" },
        payload: { body: "live over SSE" },
      });
    }, 50);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of buffer.split("\n\n").slice(0, -1)) {
        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (data) received.push(JSON.parse(data.slice(6)) as CommittedEvent);
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      if (received.some((e) => e.seq >= target)) break;
    }
    controller.abort();

    const seqs = received.map((e) => e.seq);
    // Gapless: strictly consecutive from 1 through the live event.
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBeGreaterThanOrEqual(target);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
    const live = received.find((e) => e.seq === target);
    expect((live?.payload as { body?: string })?.body).toBe("live over SSE");
  }, 10_000);
});
