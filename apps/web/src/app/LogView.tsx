import { useEffect, useState } from "react";
import type { CommittedEvent } from "@charter/schema";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.js";

/**
 * The raw record: every event, no interpretation. The trust and debugging
 * surface — deliberately austere.
 */
export function LogView() {
  const { state } = useStore();
  const [events, setEvents] = useState<CommittedEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    api
      .log(Math.max(0, state.lastSeq - 500), 500)
      .then(({ events }) => {
        if (!cancelled) setEvents(events.reverse());
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
    };
    // Refetch when new events land so the log stays current.
  }, [state.lastSeq]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <h1 className="text-[13px] font-semibold">Event log</h1>
        <span className="tnum font-mono text-[11px] text-text-3">
          {state.lastSeq} events · hash-chained · append-only
        </span>
      </header>
      <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-[18px]">
        {error && (
          <div className="px-6 py-8 text-text-3">
            Couldn't read the log. Is charterd running?
          </div>
        )}
        {!error && events === null && (
          <div className="px-6 py-4" aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="mb-2 h-3.5 w-full rounded-sm bg-bg-2" />
            ))}
          </div>
        )}
        {events !== null && events.length === 0 && (
          <div className="px-6 py-8 text-text-3">The record is empty.</div>
        )}
        {events !== null && (
          <table className="w-full border-collapse">
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.id}
                  className="border-b border-line-1/50 align-top hover:bg-bg-1"
                >
                  <td className="tnum w-16 py-1.5 pl-6 pr-2 text-right text-text-3">
                    #{event.seq}
                  </td>
                  <td className="tnum w-20 px-2 py-1.5 text-text-3">
                    {event.created_at.slice(11, 19)}
                  </td>
                  <td className="w-40 truncate px-2 py-1.5 text-info">
                    {event.stream}
                  </td>
                  <td className="w-36 px-2 py-1.5 font-medium text-text-1">
                    {event.type}
                  </td>
                  <td className="w-32 truncate px-2 py-1.5 text-warn">
                    {event.actor.kind}:{event.actor.id}
                  </td>
                  <td className="max-w-0 truncate py-1.5 pl-2 pr-6 text-text-2">
                    {JSON.stringify(event.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
