import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const devlogProjector: Projector = {
  name: "devlog",
  version: 1,
  types: ["devlog.note"],
  apply(db, event) {
    const payload = event.payload as EventPayload<"devlog.note">;
    db.prepare(
      `INSERT INTO devlog_notes (event_id, seq, created_at, note, tags)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.seq,
      event.created_at,
      payload.note,
      JSON.stringify(payload.tags ?? []),
    );
  },
  truncate(db) {
    db.exec("DELETE FROM devlog_notes");
  },
};
