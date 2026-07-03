import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import {
  channelStream,
  newTaskId,
  type CommittedEvent,
} from "@charter/schema";
import { registerEnforcement } from "./enforcement.js";
import type { ServerContext } from "./env.js";

const SSE_HEARTBEAT_MS = 25_000;
const TIMELINE_LIMIT = 200;

interface ChannelRow {
  channel_id: string;
  name: string;
  topic: string | null;
  created_at: string;
}

function bearerOf(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const query = request.query as Record<string, unknown>;
  if (typeof query["token"] === "string") return query["token"];
  return null;
}

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

export interface RosterEntry {
  id: string;
  name: string;
  role: string;
  kind: "human" | "agent";
}

export function buildServer(
  ctx: ServerContext,
  options: { roster?: RosterEntry[] } = {},
): FastifyInstance {
  const roster: RosterEntry[] = [
    { id: "founder", name: "Founder", role: "Founder", kind: "human" },
    ...(options.roster ?? []),
  ];
  const app = Fastify({ logger: false });

  // Host-header check: defeats DNS-rebinding access to the loopback API.
  // The security property is the hostname (an attacker's rebound domain
  // won't match), not the port.
  app.addHook("onRequest", (request, reply, done) => {
    const host = request.headers.host ?? "";
    const hostname = host.startsWith("[")
      ? host.slice(1, host.indexOf("]"))
      : (host.split(":")[0] ?? "");
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      void reply.code(403).send({ error: "forbidden host" });
      return;
    }
    done();
  });

  // Token auth for every /api route. EventSource cannot set headers, so the
  // SSE endpoint also accepts ?token=.
  app.addHook("onRequest", (request, reply, done) => {
    if (!request.url.startsWith("/api/")) return done();
    if (bearerOf(request) !== ctx.token) {
      void reply.code(401).send({ error: "unauthorized" });
      return;
    }
    done();
  });

  registerEnforcement(app, ctx);

  app.get("/api/health", () => ({
    ok: true,
    company: ctx.company,
    lastSeq: ctx.log.lastSeq(),
  }));

  app.get("/api/bootstrap", () => {
    const channels = ctx.db
      .prepare(
        `SELECT channel_id, name, topic, created_at FROM channels
          WHERE company_id = ? ORDER BY name`,
      )
      .all(ctx.company.id) as ChannelRow[];
    return {
      company: ctx.company,
      channels,
      roster,
      lastSeq: ctx.log.lastSeq(),
    };
  });

  app.get("/api/channels/:id/timeline", (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { after?: string; limit?: string };
    const events = ctx.log
      .read({
        stream: channelStream(id),
        companyId: ctx.company.id,
        afterSeq: Number(query.after ?? 0),
        limit: Math.min(Number(query.limit ?? TIMELINE_LIMIT), 1000),
      })
      .filter((e) => e.visibility === "company");
    return { events };
  });

  app.post("/api/channels/:id/messages", (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { body?: unknown };
    if (typeof body?.body !== "string" || body.body.trim().length === 0) {
      return reply.code(400).send({ error: "body must be a non-empty string" });
    }
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: channelStream(id),
      type: "message.posted",
      actor: { kind: "human", id: "founder" },
      payload: { body: body.body },
    });
    return { event };
  });

  app.post("/api/channels", (request, reply) => {
    const body = request.body as {
      channel_id?: unknown;
      name?: unknown;
      topic?: unknown;
    };
    if (typeof body?.channel_id !== "string" || typeof body?.name !== "string") {
      return reply.code(400).send({ error: "channel_id and name required" });
    }
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: channelStream(body.channel_id),
      type: "channel.created",
      actor: { kind: "human", id: "founder" },
      payload: {
        channel_id: body.channel_id,
        name: body.name,
        ...(typeof body.topic === "string" ? { topic: body.topic } : {}),
      },
    });
    return { event };
  });

  app.get("/api/tasks", () => {
    const tasks = ctx.db
      .prepare(
        `SELECT task_id, task_num, title, body, status, assignee_id,
                assignee_kind, pr_number, pr_url, branch, created_at, updated_at
           FROM tasks WHERE company_id = ? ORDER BY task_num DESC`,
      )
      .all(ctx.company.id);
    return { tasks };
  });

  app.post("/api/tasks", (request, reply) => {
    const body = request.body as {
      title?: unknown;
      body?: unknown;
      assignee_id?: unknown;
      assignee_kind?: unknown;
      origin_event_id?: unknown;
      origin_channel_id?: unknown;
    };
    if (typeof body?.title !== "string" || body.title.trim().length === 0) {
      return reply.code(400).send({ error: "title required" });
    }
    const taskId = newTaskId();
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: `task:${taskId}`,
      type: "task.created",
      actor: { kind: "human", id: "founder" },
      payload: {
        task_id: taskId,
        title: body.title.trim(),
        ...(typeof body.body === "string" && body.body.trim().length > 0
          ? { body: body.body }
          : {}),
        ...(typeof body.assignee_id === "string" &&
        (body.assignee_kind === "human" || body.assignee_kind === "agent")
          ? {
              assignee_id: body.assignee_id,
              assignee_kind: body.assignee_kind,
            }
          : {}),
        ...(typeof body.origin_event_id === "string"
          ? { origin_event_id: body.origin_event_id }
          : {}),
      },
      ...(typeof body.origin_event_id === "string"
        ? { refs: [{ rel: "origin", id: body.origin_event_id }] }
        : {}),
    });
    const row = ctx.db
      .prepare("SELECT task_num FROM tasks WHERE task_id = ?")
      .get(taskId) as { task_num: number };
    if (typeof body.origin_channel_id === "string") {
      ctx.log.append({
        company_id: ctx.company.id,
        stream: channelStream(body.origin_channel_id),
        type: "message.posted",
        actor: { kind: "system", id: "charterd" },
        payload: {
          body: `→ CH-${row.task_num} created: ${body.title.trim()}${
            typeof body.assignee_id === "string" ? ` (assigned @${body.assignee_id})` : ""
          }`,
        },
        refs: [{ rel: "task", id: taskId }],
      });
    }
    return { event, task_num: row.task_num };
  });

  app.patch("/api/tasks/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status?: unknown;
      assignee_id?: unknown;
      assignee_kind?: unknown;
    };
    const events: CommittedEvent[] = [];
    if (typeof body.status === "string") {
      events.push(
        ctx.log.append({
          company_id: ctx.company.id,
          stream: `task:${id}`,
          type: "task.status_changed",
          actor: { kind: "human", id: "founder" },
          payload: { task_id: id, status: body.status },
        }),
      );
    }
    if (
      typeof body.assignee_id === "string" &&
      (body.assignee_kind === "human" || body.assignee_kind === "agent")
    ) {
      events.push(
        ctx.log.append({
          company_id: ctx.company.id,
          stream: `task:${id}`,
          type: "task.assigned",
          actor: { kind: "human", id: "founder" },
          payload: {
            task_id: id,
            assignee_id: body.assignee_id,
            assignee_kind: body.assignee_kind,
          },
        }),
      );
    }
    if (events.length === 0) {
      return reply.code(400).send({ error: "nothing to update" });
    }
    return { events };
  });

  app.get("/api/tasks/:id/timeline", (request) => {
    const { id } = request.params as { id: string };
    const events = ctx.log
      .read({
        stream: `task:${id}`,
        companyId: ctx.company.id,
        afterSeq: 0,
        limit: 500,
      })
      .filter((e) => e.visibility === "company");
    return { events };
  });

  app.get("/api/log", (request) => {
    const query = request.query as {
      after?: string;
      limit?: string;
      stream?: string;
    };
    const events = ctx.log.read({
      afterSeq: Number(query.after ?? 0),
      limit: Math.min(Number(query.limit ?? 200), 1000),
      ...(query.stream ? { stream: query.stream } : {}),
      companyId: ctx.company.id,
    });
    return { events };
  });

  /**
   * SSE: gapless by construction. Subscribe FIRST (buffering live commits),
   * then replay from the cursor, then drain the buffer deduped by seq, then
   * go live. `id:` is the global seq, so Last-Event-ID reconnects replay
   * exactly what was missed.
   */
  app.get("/api/events/stream", (request, reply) => {
    const query = request.query as { after?: string };
    const lastEventId = request.headers["last-event-id"];
    const after = Number(
      (typeof lastEventId === "string" ? lastEventId : undefined) ??
        query.after ??
        0,
    );

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    raw.write(`: charter event stream\n\n`);

    let cursor = after;
    const send = (event: CommittedEvent) => {
      if (event.seq <= cursor) return;
      cursor = event.seq;
      raw.write(`id: ${event.seq}\nevent: charter\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const buffer: CommittedEvent[] = [];
    let replaying = true;
    const unsubscribe = ctx.log.onCommit((event) => {
      if (replaying) buffer.push(event);
      else send(event);
    });

    let replayCursor = after;
    for (;;) {
      const batch = ctx.log.read({ afterSeq: replayCursor, limit: 500 });
      if (batch.length === 0) break;
      for (const event of batch) {
        send(event);
        replayCursor = event.seq;
      }
    }
    replaying = false;
    for (const event of buffer) send(event);
    buffer.length = 0;

    const heartbeat = setInterval(() => {
      raw.write(`: ping\n\n`);
    }, SSE_HEARTBEAT_MS);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      raw.end();
    });
  });

  return app;
}
