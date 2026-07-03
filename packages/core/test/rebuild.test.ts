import { describe, expect, it } from "vitest";
import { ensureProjections, rebuild } from "../src/index.js";
import { dumpTable, freshLog, noteEvent } from "./helpers.js";

describe("rebuild", () => {
  it("rebuild from the log is byte-identical to the live projection", () => {
    const { db, log } = freshLog();
    for (let i = 0; i < 50; i++) {
      log.append(noteEvent(`note ${i}`, { payload: { note: `note ${i}`, tags: i % 2 ? ["odd"] : [] } }));
    }
    const before = dumpTable(db, "devlog_notes");
    rebuild(db);
    const after = dumpTable(db, "devlog_notes");
    expect(after).toBe(before);
  });

  it("rejects unknown projection names", () => {
    const { db } = freshLog();
    expect(() => rebuild(db, "nope")).toThrow(/Unknown projection/);
  });

  it("ensureProjections auto-rebuilds on version mismatch", () => {
    const { db, log } = freshLog();
    log.append(noteEvent("survives"));

    db.prepare("UPDATE projection_state SET version = 0 WHERE name = ?").run(
      "devlog",
    );
    db.exec("DELETE FROM devlog_notes");

    const rebuilt = ensureProjections(db);
    expect(rebuilt).toContain("devlog");

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM devlog_notes")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});
