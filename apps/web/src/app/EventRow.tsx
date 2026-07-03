import { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import type { CommittedEvent } from "@charter/schema";

/**
 * One event, rendered by type. The same component everywhere an event
 * appears (UI rule 9): channel timelines now, task activity and traces later.
 * Provenance (UI rule 8): agent-authored events get the 2px rail + mono
 * small-caps attribution; humans render plain.
 */
export function EventRow({
  event,
  onPromote,
  onTrace,
}: {
  event: CommittedEvent;
  onPromote?: (event: CommittedEvent) => void;
  onTrace?: (runId: string) => void;
}) {
  switch (event.type) {
    case "message.posted":
      return (
        <Row event={event} onPromote={onPromote} onTrace={onTrace}>
          <Body text={(event.payload as { body: string }).body} />
        </Row>
      );
    case "devlog.note": {
      const payload = event.payload as { note: string; tags?: string[] };
      return (
        <Row event={event} icon={<NotebookPen size={14} strokeWidth={1.5} className="text-text-3" />}>
          <Body text={payload.note} />
          {payload.tags && payload.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {payload.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm border border-line-1 px-1.5 font-mono text-[10px] leading-4 text-text-3"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </Row>
      );
    }
    case "task.created": {
      const payload = event.payload as { title: string };
      return (
        <SystemLine event={event}>
          task created: {payload.title} · by {event.actor.id}
        </SystemLine>
      );
    }
    case "task.status_changed": {
      const payload = event.payload as { status: string };
      return (
        <SystemLine event={event}>
          status → {payload.status}
        </SystemLine>
      );
    }
    case "task.assigned": {
      const payload = event.payload as { assignee_id: string };
      return (
        <SystemLine event={event}>assigned to @{payload.assignee_id}</SystemLine>
      );
    }
    case "task.pr_opened": {
      const payload = event.payload as { pr_url: string; pr_number: number };
      return (
        <SystemLine event={event}>
          <a
            href={payload.pr_url}
            target="_blank"
            rel="noreferrer"
            className="text-info hover:underline"
          >
            PR #{payload.pr_number} opened
          </a>
        </SystemLine>
      );
    }
    case "agent.run_step": {
      const payload = event.payload as {
        kind: string;
        name?: string;
        preview?: string;
      };
      return (
        <div className="flex gap-2 px-8 py-0.5 font-mono text-[11px] leading-[17px]">
          <span className="text-text-3">
            {payload.kind === "tool_use" ? "→" : "·"}
          </span>
          <span className="text-info">{payload.name ?? payload.kind}</span>
          {payload.preview && (
            <span className="truncate text-text-2">{payload.preview}</span>
          )}
        </div>
      );
    }
    case "agent.run_queued":
      return <SystemLine event={event}>run queued</SystemLine>;
    case "agent.run_started": {
      const payload = event.payload as { model: string; resumed: boolean };
      return (
        <SystemLine event={event}>
          run started · {payload.model}
          {payload.resumed ? " · resumed session" : ""}
        </SystemLine>
      );
    }
    case "agent.run_completed": {
      const payload = event.payload as {
        num_turns: number;
        duration_ms: number;
        usage?: { cost_usd?: number };
      };
      return (
        <SystemLine event={event}>
          run completed · {payload.num_turns} turns ·{" "}
          {(payload.duration_ms / 1000).toFixed(1)}s
          {payload.usage?.cost_usd !== undefined
            ? ` · $${payload.usage.cost_usd.toFixed(4)}`
            : ""}
        </SystemLine>
      );
    }
    case "agent.run_failed": {
      const payload = event.payload as { reason: string; detail?: string };
      return (
        <SystemLine event={event}>
          <span className="text-danger">
            run failed · {payload.reason.replace(/_/g, " ")}
          </span>
          {payload.detail ? ` — ${payload.detail.slice(0, 120)}` : ""}
        </SystemLine>
      );
    }
    case "agent.run_interrupted":
      return <SystemLine event={event}>run interrupted — requeued</SystemLine>;
    case "approval.requested": {
      const payload = event.payload as { input_summary: string; rule: string };
      return (
        <SystemLine event={event}>
          <span className="text-warn">held for approval</span> ·{" "}
          {payload.input_summary.slice(0, 80)} · rule {payload.rule}
        </SystemLine>
      );
    }
    case "approval.resolved": {
      const payload = event.payload as { decision: string; note?: string };
      return (
        <SystemLine event={event}>
          <span className={payload.decision === "allow" ? "text-ok" : "text-danger"}>
            {payload.decision === "allow" ? "approved" : "denied"} by {event.actor.id}
          </span>
          {payload.note ? ` — “${payload.note}”` : ""}
        </SystemLine>
      );
    }
    case "approval.consumed":
      return (
        <SystemLine event={event}>
          approval consumed (single-use) — action executed
        </SystemLine>
      );
    case "channel.created": {
      const payload = event.payload as { name: string };
      return (
        <SystemLine event={event}>
          #{payload.name} created by {event.actor.id}
        </SystemLine>
      );
    }
    case "company.created": {
      const payload = event.payload as { name: string };
      return (
        <SystemLine event={event}>
          {payload.name} founded by {event.actor.id}
        </SystemLine>
      );
    }
    default:
      return (
        <SystemLine event={event}>
          {event.type} · {event.actor.kind}:{event.actor.id}
        </SystemLine>
      );
  }
}

function Row({
  event,
  icon,
  onPromote,
  onTrace,
  children,
}: {
  event: CommittedEvent;
  icon?: React.ReactNode;
  onPromote?: (event: CommittedEvent) => void;
  onTrace?: (runId: string) => void;
  children: React.ReactNode;
}) {
  const isAgent = event.actor.kind === "agent";
  return (
    <div
      className={`group px-6 py-1.5 transition-colors duration-(--motion-fast) hover:bg-bg-1 ${
        isAgent ? "border-l-2 border-agent-1" : ""
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={
            isAgent
              ? "font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-agent-1"
              : "text-[13px] font-semibold text-text-1"
          }
        >
          {event.actor.id}
        </span>
        {icon}
        <time
          dateTime={event.created_at}
          className="tnum font-mono text-[10px] text-text-3 opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100"
        >
          {event.created_at.slice(11, 16)}
        </time>
        <span className="ml-auto flex gap-1">
          {isAgent && event.actor.invocation_id && onTrace && (
            <button
              type="button"
              onClick={() => onTrace(event.actor.invocation_id!)}
              className="rounded-sm border border-line-1 px-1.5 font-mono text-[10px] text-text-3 opacity-0 transition-opacity duration-(--motion-fast) hover:border-line-2 hover:text-text-1 group-hover:opacity-100"
            >
              why?
            </button>
          )}
          {onPromote && (
            <button
              type="button"
              onClick={() => onPromote(event)}
              className="rounded-sm border border-line-1 px-1.5 font-mono text-[10px] text-text-3 opacity-0 transition-opacity duration-(--motion-fast) hover:border-line-2 hover:text-text-1 group-hover:opacity-100"
            >
              → task
            </button>
          )}
        </span>
      </div>
      <div className="text-[14px] leading-[21px] text-text-1">{children}</div>
    </div>
  );
}

function Body({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words">{text}</p>;
}

function SystemLine({
  event,
  children,
}: {
  event: CommittedEvent;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-1">
      <span className="h-px flex-none w-4 bg-line-1" />
      <span className="font-mono text-[11px] text-text-3">
        {children}
        <time dateTime={event.created_at} className="tnum ml-2">
          {event.created_at.slice(11, 16)}
        </time>
      </span>
      <span className="h-px flex-1 bg-line-1" />
    </div>
  );
}

export function DayDivider({ date }: { date: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-bg-0/90 px-6 py-2 backdrop-blur-sm">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
        {date}
      </span>
      <span className="h-px flex-1 bg-line-1" />
    </div>
  );
}

/** WorkCard-lite: truthful waiting state — a counting timer, never a fake
 *  typing indicator. Transforms into the streamed message on completion. */
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
  useEffect(() => {
    if (status !== "running" && status !== "queued") return;
    const timer = setInterval(() => setElapsed(sinceSeconds(startedAt)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, status]);

  if (status === "failed" || status === "interrupted") {
    return (
      <div className="border-l-2 border-danger px-6 py-1.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-danger">
          {agentId}
        </span>
        <span className="ml-2 text-[12px] text-text-3">
          {status === "failed"
            ? `run failed${reason ? ` — ${reason.replace(/_/g, " ")}` : ""}`
            : "run interrupted — requeued"}
        </span>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-agent-1 px-6 py-1.5">
      <div className="flex items-baseline gap-2">
        <span
          className="inline-block h-2 w-2 self-center rounded-full bg-agent-1"
          style={{ animation: "presence-breathe 2s ease-in-out infinite" }}
        />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-agent-1">
          {agentId}
        </span>
        <span className="text-[12px] text-text-3">
          {status === "queued" ? "queued" : "working"}
        </span>
        <span className="tnum font-mono text-[11px] text-text-3">
          {elapsed}s
        </span>
      </div>
    </div>
  );
}

function sinceSeconds(iso: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
}

export function PendingRow({ body, failed }: { body: string; failed?: boolean }) {
  return (
    <div className="px-6 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold text-text-1">founder</span>
        {failed ? (
          <span className="font-mono text-[10px] text-danger">
            failed — not on record
          </span>
        ) : (
          <span className="tnum font-mono text-[10px] text-text-3">…</span>
        )}
      </div>
      <p
        className={`whitespace-pre-wrap break-words text-[14px] leading-[21px] ${
          failed ? "text-text-3 line-through" : "text-text-2"
        }`}
      >
        {body}
      </p>
    </div>
  );
}
