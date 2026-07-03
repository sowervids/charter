import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const channelsProjector: Projector = {
  name: "channels",
  version: 1,
  types: ["channel.created"],
  apply(db, event) {
    const payload = event.payload as EventPayload<"channel.created">;
    db.prepare(
      `INSERT INTO channels (channel_id, company_id, name, topic, created_at, event_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id, channel_id) DO NOTHING`,
    ).run(
      payload.channel_id,
      event.company_id,
      payload.name,
      payload.topic ?? null,
      event.created_at,
      event.id,
    );
  },
  truncate(db) {
    db.exec("DELETE FROM channels");
  },
};
