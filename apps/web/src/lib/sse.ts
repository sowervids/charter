import type { CommittedEvent } from "@charter/schema";
import { getToken } from "./api.js";

export type ConnectionStatus = "connecting" | "live" | "reconnecting";

/**
 * SSE client. The browser's EventSource re-sends Last-Event-ID on reconnect
 * automatically, and the server replays from it — reconnects are silent and
 * gapless (design: `id:` == global seq).
 */
export function connectEvents(handlers: {
  after: number;
  onEvent: (event: CommittedEvent) => void;
  onStatus: (status: ConnectionStatus) => void;
}): () => void {
  const token = getToken() ?? "";
  const source = new EventSource(
    `/api/events/stream?after=${handlers.after}&token=${encodeURIComponent(token)}`,
  );
  handlers.onStatus("connecting");

  source.addEventListener("open", () => handlers.onStatus("live"));
  source.addEventListener("error", () => handlers.onStatus("reconnecting"));
  source.addEventListener("charter", (raw) => {
    handlers.onEvent(JSON.parse((raw as MessageEvent<string>).data) as CommittedEvent);
  });

  return () => source.close();
}
