import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { channelStream } from "@charter/schema";
import { rebuild, verify } from "../src/index.js";
import { dumpTable, freshLog, noteEvent } from "./helpers.js";

/**
 * The crown-jewel property (plan: "replay determinism"): for ANY sequence of
 * events across any streams, rebuilding every projection from the log yields
 * exactly the state the live projectors produced, and the hash chain holds.
 */
describe("replay determinism (property)", () => {
  const arbNote = fc.record({
    note: fc.string({ minLength: 1, maxLength: 200 }),
    channel: fc.constantFrom("devlog", "general", "ops"),
    tags: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 3 }),
      { nil: undefined },
    ),
  });

  it("rebuild(log) == live projection, for any event sequence", () => {
    fc.assert(
      fc.property(fc.array(arbNote, { maxLength: 100 }), (notes) => {
        const { db, log } = freshLog();
        for (const n of notes) {
          log.append(
            noteEvent(n.note, {
              stream: channelStream(n.channel),
              payload:
                n.tags === undefined
                  ? { note: n.note }
                  : { note: n.note, tags: n.tags },
            }),
          );
        }
        const live = dumpTable(db, "devlog_notes");
        rebuild(db);
        expect(dumpTable(db, "devlog_notes")).toBe(live);

        const chain = verify(db);
        expect(chain.ok).toBe(true);
        expect(chain.checked).toBe(notes.length);
      }),
      { numRuns: 30 },
    );
  });
});
