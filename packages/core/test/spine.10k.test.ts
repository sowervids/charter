import { describe, expect, it } from "vitest";
import { rebuild, verify } from "../src/index.js";
import { dumpTable, freshLog, noteEvent } from "./helpers.js";

/** Phase 0 exit criterion: append 10k events, rebuild byte-identically. */
describe("spine at 10k events", () => {
  it("appends 10,000 events, verifies the chain, and rebuilds identically", { timeout: 30_000 }, () => {
    const { db, log } = freshLog();

    for (let i = 0; i < 10_000; i++) {
      log.append(noteEvent(`event ${i}`));
    }
    expect(log.lastSeq()).toBe(10_000);

    const chain = verify(db);
    expect(chain).toEqual({ ok: true, checked: 10_000 });

    const before = dumpTable(db, "devlog_notes");
    rebuild(db);
    expect(dumpTable(db, "devlog_notes")).toBe(before);
  });
});
