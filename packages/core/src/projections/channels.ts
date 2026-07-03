import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const channelsProjector: Projector = {
  name: "channels",
  version: 2,
  types: ["channel.created", "channel.updated", "channel.archived"],
  apply(db, event) {
    switch (event.type) {
      case "channel.created": {
        const p = event.payload as EventPayload<"channel.created">;
        db.prepare(
          `INSERT INTO channels (channel_id, company_id, name, topic, created_at, event_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (company_id, channel_id) DO NOTHING`,
        ).run(
          p.channel_id,
          event.company_id,
          p.name,
          p.topic ?? null,
          event.created_at,
          event.id,
        );
        break;
      }
      case "channel.updated": {
        const p = event.payload as EventPayload<"channel.updated">;
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (p.name !== undefined) {
          sets.push("name = ?");
          vals.push(p.name);
        }
        if (p.topic !== undefined) {
          sets.push("topic = ?");
          vals.push(p.topic);
        }
        if (sets.length === 0) break;
        vals.push(p.channel_id, event.company_id);
        db.prepare(
          `UPDATE channels SET ${sets.join(", ")}
            WHERE channel_id = ? AND company_id = ?`,
        ).run(...(vals as never[]));
        break;
      }
      case "channel.archived": {
        const p = event.payload as EventPayload<"channel.archived">;
        db.prepare(
          `UPDATE channels SET archived_at = ?
            WHERE channel_id = ? AND company_id = ?`,
        ).run(event.created_at, p.channel_id, event.company_id);
        break;
      }
    }
  },
  truncate(db) {
    db.exec("DELETE FROM channels");
  },
};
