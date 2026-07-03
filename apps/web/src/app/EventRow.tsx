import { useEffect, useState } from "react";
import { GitPullRequest, Link2, Trash2 } from "lucide-react";
import type { CommittedEvent } from "@charter/schema";
import type { RosterEntry } from "../lib/api.js";
import { agentHueVar } from "../lib/identity.js";
import { Avatar } from "./Avatar.js";

const GROUP_WINDOW_MS = 5 * 60_000;
const MESSAGE_TYPES = new Set(["message.posted", "devlog.note"]);

export interface RowHandlers {
  roster?: RosterEntry[];
  onPromote?: (event: CommittedEvent) => void;
  onTrace?: (runId: string) => void;
  onDelete?: (event: CommittedEvent) => void;
  onOpenTask?: (taskId: string) => void;
}

/** Dispatch by event type. Consecutive same-author messages within the window
 *  collapse under one header (Slack/Linear style). `prev` is the previous
 *  event in the same day group. */
export function EventRow({
  event,
  prev,
  ...h
}: { event: CommittedEvent; prev?: CommittedEvent } & RowHandlers) {
  if (event.type === "message.deleted") return null;

  if (MESSAGE_TYPES.has(event.type)) {
    const grouped =
      prev !== undefined &&
      MESSAGE_TYPES.has(prev.type) &&
      prev.actor.id === event.actor.id &&
      prev.actor.kind === event.actor.kind &&
      Date.parse(event.created_at) - Date.parse(prev.created_at) < GROUP_WINDOW_MS;
    return <MessageRow event={event} showHeader={!grouped} {...h} />;
  }

  switch (event.type) {
    case "task.created":
      return (
        <SystemLine event={event} onOpenTask={h.onOpenTask} taskId={taskIdOf(event)}>
          created a task · {(event.payload as { title: string }).title}
        </SystemLine>
      );
    case "task.status_changed":
      return (
        <SystemLine event={event} onOpenTask={h.onOpenTask} taskId={taskIdOf(event)}>
          moved to {(event.payload as { status: string }).status}
        </SystemLine>
      );
    case "task.assigned":
      return (
        <SystemLine event={event}>
          assigned to @{(event.payload as { assignee_id: string }).assignee_id}
        </SystemLine>
      );
    case "task.pr_opened": {
      const p = event.payload as { pr_url: string; pr_number: number };
      return (
        <SystemLine event={event}>
          <a href={p.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-info hover:underline">
            <GitPullRequest size={11} strokeWidth={1.5} /> opened PR #{p.pr_number}
          </a>
        </SystemLine>
      );
    }
    case "task.updated":
      return <SystemLine event={event}>edited the task</SystemLine>;
    case "channel.created":
      return <SystemLine event={event}>created #{(event.payload as { name: string }).name}</SystemLine>;
    case "channel.updated":
      return <SystemLine event={event}>updated the channel</SystemLine>;
    case "company.created":
      return <SystemLine event={event}>founded {(event.payload as { name: string }).name}</SystemLine>;
    case "agent.run_queued":
      return <SystemLine event={event}>run queued</SystemLine>;
    case "agent.run_started": {
      const p = event.payload as { model: string; resumed: boolean };
      return <SystemLine event={event}>run started · {p.model}{p.resumed ? " · resumed" : ""}</SystemLine>;
    }
    case "agent.run_step": {
      const p = event.payload as { kind: string; name?: string; preview?: string };
      return (
        <div className="flex gap-2 py-0.5 pl-14 pr-6 font-mono text-[11px] leading-[17px]">
          <span className="text-text-3">{p.kind === "tool_use" ? "→" : "·"}</span>
          <span className="text-info">{p.name ?? p.kind}</span>
          {p.preview && <span className="truncate text-text-2">{p.preview}</span>}
        </div>
      );
    }
    case "agent.run_completed": {
      const p = event.payload as { num_turns: number; duration_ms: number; usage?: { cost_usd?: number } };
      return (
        <SystemLine event={event}>
          run completed · {p.num_turns} turns · {(p.duration_ms / 1000).toFixed(1)}s
          {p.usage?.cost_usd !== undefined ? ` · $${p.usage.cost_usd.toFixed(4)}` : ""}
        </SystemLine>
      );
    }
    case "agent.run_failed": {
      const p = event.payload as { reason: string; detail?: string };
      return (
        <SystemLine event={event} tone="danger">
          run failed · {p.reason.replace(/_/g, " ")}
          {p.detail ? ` — ${p.detail.slice(0, 120)}` : ""}
        </SystemLine>
      );
    }
    case "agent.run_interrupted":
      return <SystemLine event={event}>run interrupted — requeued</SystemLine>;
    case "approval.requested": {
      const p = event.payload as { input_summary: string; rule: string };
      return (
        <SystemLine event={event} tone="warn">
          held for approval · {p.input_summary.slice(0, 70)} · {p.rule}
        </SystemLine>
      );
    }
    case "approval.resolved": {
      const p = event.payload as { decision: string; note?: string };
      return (
        <SystemLine event={event} tone={p.decision === "allow" ? "ok" : "danger"}>
          {p.decision === "allow" ? "approved" : "denied"} by {event.actor.id}
          {p.note ? ` — “${p.note}”` : ""}
        </SystemLine>
      );
    }
    case "approval.consumed":
      return <SystemLine event={event}>approval consumed — action executed</SystemLine>;
    default:
      return (
        <SystemLine event={event}>
          {event.type} · {event.actor.kind}:{event.actor.id}
        </SystemLine>
      );
  }
}

function taskIdOf(event: CommittedEvent): string | undefined {
  const ref = event.refs.find((r) => r.rel === "task");
  if (ref) return ref.id;
  return (event.payload as { task_id?: string }).task_id;
}

function MessageRow({
  event,
  showHeader,
  roster,
  onPromote,
  onTrace,
  onDelete,
}: { event: CommittedEvent; showHeader: boolean } & RowHandlers) {
  const isAgent = event.actor.kind === "agent";
  const isSystem = event.actor.kind === "system";
  const hue = isAgent ? agentHueVar(event.actor.id) : undefined;
  const name = displayName(event.actor.id, roster);
  const body =
    event.type === "message.posted"
      ? (event.payload as { body: string }).body
      : (event.payload as { note: string }).note;
  const tags = event.type === "devlog.note" ? (event.payload as { tags?: string[] }).tags : undefined;

  return (
    <div
      className="group relative flex gap-3 py-0.5 pl-4 pr-4 transition-colors duration-(--motion-fast) hover:bg-bg-1"
      style={isAgent ? { boxShadow: `inset 2px 0 0 ${hue}` } : undefined}
    >
      <div className="w-8 shrink-0 pt-0.5">
        {showHeader ? (
          <Avatar id={event.actor.id} name={name} kind={event.actor.kind} size={30} />
        ) : (
          <time
            dateTime={event.created_at}
            className="tnum block pt-1 text-center font-mono text-[10px] leading-4 text-text-3 opacity-0 group-hover:opacity-100"
          >
            {event.created_at.slice(11, 16)}
          </time>
        )}
      </div>
      <div className="min-w-0 flex-1 pb-0.5">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span
              className={isAgent ? "font-mono text-[12px] font-medium uppercase tracking-[0.04em]" : "text-[13px] font-semibold text-text-1"}
              style={isAgent ? { color: hue } : undefined}
            >
              {isAgent ? `@${event.actor.id}` : isSystem ? name : name}
            </span>
            <time dateTime={event.created_at} className="tnum font-mono text-[10px] text-text-3">
              {event.created_at.slice(11, 16)}
            </time>
          </div>
        )}
        <div className="text-[14px] leading-[21px] text-text-1">
          <RichBody text={body} roster={roster} />
        </div>
        {tags && tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="rounded-sm border border-line-1 px-1.5 font-mono text-[10px] leading-4 text-text-3">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="absolute right-3 top-0 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-line-2 bg-bg-2 px-0.5 py-0.5 shadow-[var(--shadow-1)] group-hover:flex">
        {isAgent && event.actor.invocation_id && onTrace && (
          <ActionButton title="Why did it do this?" onClick={() => onTrace(event.actor.invocation_id!)}>
            <span className="px-1 font-mono text-[10px]">why?</span>
          </ActionButton>
        )}
        {onPromote && (
          <ActionButton title="Promote to task" onClick={() => onPromote(event)}>
            <span className="px-1 font-mono text-[10px]">→ task</span>
          </ActionButton>
        )}
        {onDelete && event.type === "message.posted" && (
          <ActionButton title="Copy link" onClick={() => void navigator.clipboard?.writeText(`${location.origin}/#${event.id}`)}>
            <Link2 size={13} strokeWidth={1.5} />
          </ActionButton>
        )}
        {onDelete && event.type === "message.posted" && (
          <ActionButton title="Delete message" tone="danger" onClick={() => onDelete(event)}>
            <Trash2 size={13} strokeWidth={1.5} />
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  title,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-6 items-center justify-center rounded-sm px-1 transition-colors duration-(--motion-fast) hover:bg-bg-3 ${
        tone === "danger" ? "text-text-3 hover:text-danger" : "text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}

const TOKEN_RE = /(@[a-z0-9-]+)|(https?:\/\/[^\s]+)/gi;

function RichBody({ text, roster }: { text: string; roster?: RosterEntry[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  let k = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      const id = m[1].slice(1).toLowerCase();
      const entry = roster?.find((r) => r.id === id);
      if (entry) {
        const hue = entry.kind === "agent" ? agentHueVar(entry.id) : "var(--color-info)";
        parts.push(
          <span
            key={k++}
            className="rounded-sm px-1 font-medium"
            style={{ color: hue, background: `color-mix(in srgb, ${hue} 14%, transparent)` }}
          >
            @{entry.id}
          </span>,
        );
      } else {
        parts.push(m[1]);
      }
    } else if (m[2]) {
      parts.push(
        <a key={k++} href={m[2]} target="_blank" rel="noreferrer" className="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info">
          {m[2]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className="whitespace-pre-wrap break-words">{parts}</p>;
}

function displayName(id: string, roster?: RosterEntry[]): string {
  return roster?.find((r) => r.id === id)?.name ?? id;
}

function SystemLine({
  event,
  children,
  tone,
  taskId,
  onOpenTask,
}: {
  event: CommittedEvent;
  children: React.ReactNode;
  tone?: "ok" | "danger" | "warn";
  taskId?: string;
  onOpenTask?: (taskId: string) => void;
}) {
  const toneColor =
    tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-text-3";
  const clickable = taskId !== undefined && onOpenTask !== undefined;
  return (
    <div className="flex items-center gap-2 py-1 pl-5 pr-6">
      <span className="h-1 w-1 shrink-0 rounded-full bg-line-2" />
      <span
        className={`font-mono text-[11px] ${toneColor} ${clickable ? "cursor-pointer hover:underline" : ""}`}
        onClick={clickable ? () => onOpenTask(taskId) : undefined}
      >
        <span className="text-text-2">{displayNameSys(event)}</span> {children}
      </span>
      <time dateTime={event.created_at} className="tnum ml-1 font-mono text-[10px] text-text-3">
        {event.created_at.slice(11, 16)}
      </time>
    </div>
  );
}

function displayNameSys(event: CommittedEvent): string {
  if (event.actor.kind === "agent") return `@${event.actor.id}`;
  if (event.actor.kind === "system") return "system";
  return event.actor.id;
}

export function DayDivider({ date }: { date: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg-0/85 px-5 py-2 backdrop-blur-sm">
      <span className="h-px flex-1 bg-line-1" />
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{date}</span>
      <span className="h-px flex-1 bg-line-1" />
    </div>
  );
}

export function WorkingRow({
  agentId,
  status,
  startedAt,
  reason,
}: {
  agentId: string;
  status: "queued" | "running" | "failed" | "interrupted";
  startedAt: string;
  reason?: string;
}) {
  const [elapsed, setElapsed] = useState(() => sinceSeconds(startedAt));
  const hue = agentHueVar(agentId);
  useEffect(() => {
    if (status !== "running" && status !== "queued") return;
    const timer = setInterval(() => setElapsed(sinceSeconds(startedAt)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, status]);

  if (status === "failed" || status === "interrupted") {
    return (
      <div className="flex items-center gap-2 py-1 pl-5 pr-6" style={{ boxShadow: "inset 2px 0 0 var(--color-danger)" }}>
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-danger">@{agentId}</span>
        <span className="text-[12px] text-text-3">
          {status === "failed" ? `run failed${reason ? ` — ${reason.replace(/_/g, " ")}` : ""}` : "run interrupted — requeued"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 py-1 pl-4 pr-6" style={{ boxShadow: `inset 2px 0 0 ${hue}` }}>
      <span className="presence-live inline-block h-2 w-2 rounded-full" style={{ background: hue }} />
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: hue }}>@{agentId}</span>
      <span className="text-[12px] text-text-3">{status === "queued" ? "queued" : "working"}</span>
      <span className="tnum font-mono text-[11px] text-text-3">{elapsed}s</span>
    </div>
  );
}

function sinceSeconds(iso: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
}

export function PendingRow({ body, failed }: { body: string; failed?: boolean }) {
  return (
    <div className="flex gap-3 py-0.5 pl-4 pr-4">
      <div className="w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        {failed && <span className="font-mono text-[10px] text-danger">failed — not on record</span>}
        <p className={`whitespace-pre-wrap break-words text-[14px] leading-[21px] ${failed ? "text-text-3 line-through" : "text-text-2"}`}>
          {body}
        </p>
      </div>
    </div>
  );
}
