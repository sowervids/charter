import { describe, expect, it } from "vitest";
import { channelStream } from "@charter/schema";
import { ConcurrencyError, verify } from "../src/index.js";
import { COMPANY, freshLog, noteEvent } from "./helpers.js";

describe("EventLog.append", () => {
  it("commits an event and projects it in the same transaction", () => {
    const { db, log } = freshLog();
    const committed = log.append(noteEvent("first"));

    expect(committed.seq).toBe(1);
    expect(committed.stream_seq).toBe(1);
    expect(committed.id).toMatch(/^evt_/);
    expect(committed.hash_prev).toBe("GENESIS");

    const read = log.read();
    expect(read).toHaveLength(1);
    expect(read[0]).toEqual(committed);

    const projected = db
      .prepare("SELECT note FROM devlog_notes WHERE event_id = ?")
      .get(committed.id) as { note: string };
    expect(projected.note).toBe("first");
  });

  it("rejects unknown event types — malformed events never enter the log", () => {
    const { db, log } = freshLog();
    expect(() =>
      log.append(noteEvent("x", { type: "not.a.type" })),
    ).toThrow(/Unknown event type/);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM events")
      .get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("rejects malformed payloads", () => {
    const { log } = freshLog();
    expect(() =>
      log.append(noteEvent("x", { payload: { note: "" } })),
    ).toThrow(/Invalid payload/);
  });

  it("increments stream_seq per stream, independently across streams", () => {
    const { log } = freshLog();
    const a1 = log.append(noteEvent("a1"));
    const b1 = log.append(
      noteEvent("b1", { stream: channelStream("other") }),
    );
    const a2 = log.append(noteEvent("a2"));

    expect(a1.stream_seq).toBe(1);
    expect(b1.stream_seq).toBe(1);
    expect(a2.stream_seq).toBe(2);
    expect(a2.seq).toBe(3);
  });

  it("enforces optimistic concurrency via expected_stream_seq", () => {
    const { log } = freshLog();
    log.append(noteEvent("first"));
    expect(() =>
      log.append(noteEvent("stale", { expected_stream_seq: 1 })),
    ).toThrow(ConcurrencyError);
    const ok = log.append(noteEvent("fresh", { expected_stream_seq: 2 }));
    expect(ok.stream_seq).toBe(2);
  });

  it("chains hashes and detects tampering", () => {
    const { db, log } = freshLog();
    const first = log.append(noteEvent("one"));
    const second = log.append(noteEvent("two"));
    expect(second.hash_prev).toBe(first.hash_self);
    expect(verify(db)).toEqual({ ok: true, checked: 2 });

    db.prepare("UPDATE events SET payload = ? WHERE seq = ?").run(
      JSON.stringify({ note: "REWRITTEN" }),
      first.seq,
    );
    const result = verify(db);
    expect(result.ok).toBe(false);
    expect(result.firstBadSeq).toBe(first.seq);
  });

  it("notifies onCommit listeners after the transaction", () => {
    const { log } = freshLog();
    const seen: number[] = [];
    const unsubscribe = log.onCommit((e) => seen.push(e.seq));
    log.append(noteEvent("one"));
    unsubscribe();
    log.append(noteEvent("two"));
    expect(seen).toEqual([1]);
  });

  it("filters reads by stream and afterSeq", () => {
    const { log } = freshLog();
    log.append(noteEvent("a", { stream: channelStream("a") }));
    log.append(noteEvent("b", { stream: channelStream("b") }));
    log.append(noteEvent("a2", { stream: channelStream("a") }));

    const streamA = log.read({ stream: channelStream("a") });
    expect(streamA.map((e) => e.stream_seq)).toEqual([1, 2]);

    const tail = log.read({ afterSeq: 2, companyId: COMPANY });
    expect(tail).toHaveLength(1);
    expect(tail[0]?.seq).toBe(3);
  });
});
