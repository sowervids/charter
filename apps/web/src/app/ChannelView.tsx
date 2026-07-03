import { useEffect, useMemo, useRef } from "react";
import { Hash } from "lucide-react";
import type { CommittedEvent } from "@charter/schema";
import { useStore } from "../lib/store.js";
import { Composer } from "./Composer.js";
import { DayDivider, EventRow, PendingRow, WorkingRow } from "./EventRow.js";

export function ChannelView({ channelId }: { channelId: string }) {
  const { state, ensureTimeline } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const channel = state.channels.find((c) => c.channel_id === channelId);
  const events = state.timelines[channelId] ?? [];
  const pending = state.pending.filter((p) => p.channelId === channelId);
  const loaded = state.loaded[channelId] === true;

  useEffect(() => {
    ensureTimeline(channelId);
  }, [channelId, ensureTimeline]);

  // Pin to bottom on new content (the record grows downward).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, pending.length, channelId]);

  const grouped = useMemo(() => groupByDay(events), [events]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line-1 px-6">
        <Hash size={16} strokeWidth={1.5} className="text-text-3" />
        <h1 className="text-[13px] font-semibold">{channel?.name ?? channelId}</h1>
        {channel?.topic && (
          <>
            <span className="mx-1 h-3.5 w-px bg-line-2" />
            <p className="truncate text-[12px] text-text-3">{channel.topic}</p>
          </>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto pb-4">
        {!loaded && <TimelineSkeleton />}
        {loaded && events.length === 0 && pending.length === 0 && (
          <EmptyChannel
            name={channel?.name ?? channelId}
            nextSeq={state.lastSeq + 1}
          />
        )}
        {grouped.map((group) => (
          <section key={group.date}>
            <DayDivider date={group.date} />
            {group.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </section>
        ))}
        {pending.map((p) => (
          <PendingRow key={p.tempId} body={p.body} failed={p.failed} />
        ))}
        {Object.values(state.runs)
          .filter(
            (run) =>
              run.channelId === channelId &&
              (run.status === "queued" ||
                run.status === "running" ||
                ((run.status === "failed" || run.status === "interrupted") &&
                  recent(run.endedAt))),
          )
          .map((run) => (
            <WorkingRow
              key={run.runId}
              agentId={run.agentId}
              status={
                run.status as "queued" | "running" | "failed" | "interrupted"
              }
              startedAt={run.startedAt}
              reason={run.reason}
            />
          ))}
      </div>

      <Composer channelId={channelId} />
    </>
  );
}

function recent(endedAt: string | undefined): boolean {
  if (endedAt === undefined) return false;
  return Date.now() - Date.parse(endedAt) < 5 * 60_000;
}

function groupByDay(
  events: CommittedEvent[],
): Array<{ date: string; events: CommittedEvent[] }> {
  const groups: Array<{ date: string; events: CommittedEvent[] }> = [];
  for (const event of events) {
    const date = new Date(event.created_at).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const last = groups.at(-1);
    if (last?.date === date) last.events.push(event);
    else groups.push({ date, events: [event] });
  }
  return groups;
}

function TimelineSkeleton() {
  // Skeletons mirror layout (UI rule 3): author line + body line rows.
  return (
    <div className="px-6 pt-6" aria-hidden>
      {[72, 40, 88, 56, 64].map((width, i) => (
        <div key={i} className="mb-5">
          <div className="mb-1.5 h-3 w-24 rounded-sm bg-bg-2" />
          <div className="h-3.5 rounded-sm bg-bg-2" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

function EmptyChannel({ name, nextSeq }: { name: string; nextSeq: number }) {
  return (
    <div className="flex h-full flex-col items-start justify-end px-6 pb-6">
      <h2 className="font-serif text-lg font-semibold text-text-1">#{name}</h2>
      <p className="mt-2 max-w-md text-[13px] text-text-2">
        This is the company record. Everything that happens here is written to
        the log, permanently. Say something — it becomes event{" "}
        <span className="tnum font-mono">#{nextSeq}</span> of the company's
        history.
      </p>
    </div>
  );
}
