import type { CommittedEvent } from "@charter/schema";
import { DayDivider, EventRow, PendingRow, WorkingRow } from "./EventRow.js";

/**
 * /dev/gallery — every component in every state, one page (the plan's
 * Storybook replacement). New components get an entry in the same PR
 * (UI rule 9). Renders with NO daemon: pure fixtures.
 */

let seq = 0;
function ev(partial: Partial<CommittedEvent> & { type: string }): CommittedEvent {
  seq += 1;
  return {
    seq,
    id: `evt_gallery${seq}`,
    company_id: "co_gallery",
    stream: "channel:gallery",
    stream_seq: seq,
    actor: { kind: "human", id: "founder" },
    payload: {},
    refs: [],
    visibility: "company",
    hash_prev: "GENESIS",
    hash_self: "0".repeat(64),
    created_at: "2026-07-03T14:30:00.000Z",
    ...partial,
  };
}

const SECTIONS: Array<{ title: string; body: React.ReactNode }> = [
  {
    title: "EventRow · message.posted (human)",
    body: (
      <EventRow
        event={ev({
          type: "message.posted",
          payload: { body: "Plain human message. Hover shows the timestamp." },
        })}
      />
    ),
  },
  {
    title: "EventRow · message.posted (agent — provenance rail)",
    body: (
      <EventRow
        event={ev({
          type: "message.posted",
          actor: { kind: "agent", id: "scout" },
          payload: {
            body: "Agent-authored content is never visually indistinguishable from human input: 2px rail, mono small-caps attribution.",
          },
        })}
      />
    ),
  },
  {
    title: "EventRow · devlog.note with tags",
    body: (
      <EventRow
        event={ev({
          type: "devlog.note",
          payload: {
            note: "A note in the record, with its little glyph and tag chips.",
            tags: ["phase-1", "gallery"],
          },
        })}
      />
    ),
  },
  {
    title: "EventRow · system lines",
    body: (
      <>
        <EventRow event={ev({ type: "channel.created", payload: { channel_id: "x", name: "ops" } })} />
        <EventRow event={ev({ type: "company.created", payload: { name: "Charter" } })} />
        <EventRow event={ev({ type: "unknown.future_type" })} />
      </>
    ),
  },
  {
    title: "DayDivider",
    body: <DayDivider date="Thu, Jul 3, 2026" />,
  },
  {
    title: "WorkingRow · queued / running / failed / interrupted",
    body: (
      <>
        <WorkingRow agentId="scout" status="queued" startedAt={new Date().toISOString()} />
        <WorkingRow agentId="scout" status="running" startedAt={new Date(Date.now() - 23_000).toISOString()} />
        <WorkingRow agentId="scout" status="failed" startedAt="2026-07-03T14:30:00Z" reason="rate_limit" />
        <WorkingRow agentId="scout" status="interrupted" startedAt="2026-07-03T14:30:00Z" />
      </>
    ),
  },
  {
    title: "PendingRow · optimistic + failed",
    body: (
      <>
        <PendingRow body="An optimistic send, awaiting its seq…" />
        <PendingRow body="A send the daemon rejected." failed />
      </>
    ),
  },
];

export function Gallery() {
  return (
    <div className="min-h-full bg-bg-0 pb-24 text-text-1">
      <header className="border-b border-line-1 px-8 py-5">
        <h1 className="font-serif text-lg font-semibold">Component gallery</h1>
        <p className="font-mono text-[11px] text-text-3">
          every component · every state · no daemon required
        </p>
      </header>
      {SECTIONS.map((section) => (
        <section key={section.title} className="mt-8 px-8">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
            {section.title}
          </h2>
          <div className="rounded-md border border-line-1 bg-bg-0 py-2">
            {section.body}
          </div>
        </section>
      ))}
      <section className="mt-8 px-8">
        <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
          Tokens · palette
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            ["bg-0", "bg-bg-0"],
            ["bg-1", "bg-bg-1"],
            ["bg-2", "bg-bg-2"],
            ["bg-3", "bg-bg-3"],
            ["accent", "bg-accent"],
            ["ok", "bg-ok"],
            ["warn", "bg-warn"],
            ["danger", "bg-danger"],
            ["info", "bg-info"],
          ].map(([name, cls]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className={`h-10 w-16 rounded-sm border border-line-2 ${cls}`} />
              <span className="font-mono text-[10px] text-text-3">{name}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
