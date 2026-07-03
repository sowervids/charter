import { styleText } from "node:util";
import { canonicalJson, type CommittedEvent } from "@charter/schema";

export function formatEvent(event: CommittedEvent): string {
  const time = event.created_at.slice(11, 19);
  const payload = canonicalJson(event.payload);
  const preview =
    payload.length > 100 ? `${payload.slice(0, 100)}…` : payload;
  return [
    styleText("dim", `#${String(event.seq).padStart(5, " ")}`),
    styleText("dim", time),
    styleText("cyan", event.stream.padEnd(18, " ")),
    styleText("bold", event.type.padEnd(16, " ")),
    styleText("yellow", `${event.actor.kind}:${event.actor.id}`),
    preview,
  ].join("  ");
}
