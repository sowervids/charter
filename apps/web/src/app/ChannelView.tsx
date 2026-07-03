import { useEffect, useMemo, useRef, useState } from "react";
import { Hash, MoreHorizontal } from "lucide-react";
import type { CommittedEvent } from "@charter/schema";
import { useStore } from "../lib/store.js";
import { NewTaskDialog } from "./BoardView.js";
import { Composer } from "./Composer.js";
import { DayDivider, EventRow, PendingRow, WorkingRow } from "./EventRow.js";
import { Menu, MenuItem } from "./Menu.js";

export function ChannelView({ channelId }: { channelId: string }) {
  const { state, ensureTimeline, navigate, deleteMessage, archiveChannel, toast } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [promoting, setPromoting] = useState<CommittedEvent | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const channel = state.channels.find((c) => c.channel_id === channelId);
  const loaded = state.loaded[channelId] === true;

  const events = useMemo(
    () =>
      (state.timelines[channelId] ?? []).filter(
        (e) => e.type !== "message.deleted" && !state.deleted[e.id],
      ),
    [state.timelines, state.deleted, channelId],
  );
  const pending = state.pending.filter((p) => p.channelId === channelId);
  const liveRuns = Object.values(state.runs).filter(
    (r) =>
      r.channelId === channelId &&
      (r.status === "queued" ||
        r.status === "running" ||
        ((r.status === "failed" || r.status === "interrupted") && recent(r.endedAt))),
  );

  useEffect(() => {
    ensureTimeline(channelId);
  }, [channelId, ensureTimeline]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length, pending.length, liveRuns.length, channelId]);

  const grouped = useMemo(() => groupByDay(events), [events]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line-1 px-5">
        <Hash size={16} strokeWidth={1.5} className="text-text-3" />
        <h1 className="text-[13px] font-semibold">{channel?.name ?? channelId}</h1>
        {channel?.topic && (
          <>
            <span className="mx-1 h-3.5 w-px bg-line-2" />
            <p className="truncate text-[12px] text-text-3">{channel.topic}</p>
          </>
        )}
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Channel options"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-bg-2 hover:text-text-1"
          >
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </button>
          {menuOpen && (
            <Menu onClose={() => setMenuOpen(false)} align="right">
              <MenuItem
                onClick={() => {
                  void navigator.clipboard?.writeText(`${location.origin}/c/${channelId}`);
                  toast("Channel link copied");
                }}
              >
                Copy link
              </MenuItem>
              {channelId !== "general" && (
                <MenuItem tone="danger" onClick={() => void archiveChannel(channelId)}>
                  Archive channel
                </MenuItem>
              )}
            </Menu>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto py-3"
      >
        {!loaded && <TimelineSkeleton />}
        {loaded && events.length === 0 && pending.length === 0 && (
          <EmptyChannel name={channel?.name ?? channelId} nextSeq={state.lastSeq + 1} />
        )}
        {grouped.map((group) => (
          <section key={group.date}>
            <DayDivider date={group.date} />
            {group.events.map((event, i) => (
              <EventRow
                key={event.id}
                event={event}
                prev={group.events[i - 1]}
                roster={state.roster}
                onPromote={setPromoting}
                onTrace={(runId) => navigate({ kind: "trace", runId })}
                onOpenTask={(taskId) => navigate({ kind: "board", taskId })}
                onDelete={(ev) => void deleteMessage(channelId, ev.id)}
              />
            ))}
          </section>
        ))}
        {pending.map((p) => (
          <PendingRow key={p.tempId} body={p.body} failed={p.failed} />
        ))}
        {liveRuns.map((run) => (
          <WorkingRow
            key={run.runId}
            agentId={run.agentId}
            status={run.status as "queued" | "running" | "failed" | "interrupted"}
            startedAt={run.startedAt}
            reason={run.reason}
          />
        ))}
      </div>

      <Composer channelId={channelId} />
      {promoting && (
        <NewTaskDialog
          onClose={() => setPromoting(null)}
          initial={{
            title:
              ((promoting.payload as { body?: string; note?: string }).body ??
                (promoting.payload as { note?: string }).note ??
                "")
                .split("\n")[0]
                ?.slice(0, 120) ?? "",
            origin_event_id: promoting.id,
            origin_channel_id: channelId,
          }}
        />
      )}
    </>
  );
}

function recent(endedAt: string | undefined): boolean {
  return endedAt !== undefined && Date.now() - Date.parse(endedAt) < 20_000;
}

function groupByDay(events: CommittedEvent[]): Array<{ date: string; events: CommittedEvent[] }> {
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
  return (
    <div className="px-5 pt-4" aria-hidden>
      {[62, 44, 80, 52].map((width, i) => (
        <div key={i} className="mb-5 flex gap-3">
          <div className="h-7 w-7 shrink-0 rounded-sm bg-bg-2" />
          <div className="flex-1">
            <div className="mb-1.5 h-3 w-24 rounded-sm bg-bg-2" />
            <div className="h-3.5 rounded-sm bg-bg-2" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyChannel({ name, nextSeq }: { name: string; nextSeq: number }) {
  return (
    <div className="flex h-full flex-col items-start justify-end px-6 pb-6">
      <h2 className="font-serif text-lg font-semibold text-text-1">#{name}</h2>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-2">
        This is the company record. Everything here is written to the log,
        permanently. Say something — or <span className="text-text-1">@mention an agent</span> to
        put it to work. Your next line becomes event{" "}
        <span className="tnum font-mono">#{nextSeq}</span>.
      </p>
    </div>
  );
}
