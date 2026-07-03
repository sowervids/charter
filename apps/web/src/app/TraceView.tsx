import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { CommittedEvent } from "@charter/schema";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { EventRow } from "./EventRow.js";

/**
 * "Why did it do this?" — the full causal chain of one run, straight from
 * the log: trigger → queued → started → every step → approvals → outcome.
 */
export function TraceView({ runId }: { runId: string }) {
  const { navigate } = useStore();
  const [data, setData] = useState<{
    run: Record<string, unknown>;
    trigger: CommittedEvent | null;
    events: CommittedEvent[];
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    api
      .trace(runId)
      .then(setData)
      .catch(() => setError(true));
  }, [runId]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <button
          type="button"
          onClick={() => window.history.back()}
          aria-label="Back"
          className="rounded-sm p-1 text-text-3 hover:bg-bg-2 hover:text-text-1"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
        </button>
        <h1 className="text-[13px] font-semibold">Run trace</h1>
        <span className="tnum font-mono text-[11px] text-text-3">{runId}</span>
      </header>

      <div className="flex-1 overflow-y-auto pb-8">
        {error && (
          <div className="px-6 py-8 text-[13px] text-text-3">
            Run not found — it may predate the trace index.{" "}
            <button
              type="button"
              className="text-info hover:underline"
              onClick={() => navigate({ kind: "log" })}
            >
              Open the raw log instead.
            </button>
          </div>
        )}
        {!error && data === null && (
          <div className="px-6 py-6" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="mb-3 h-10 rounded-sm bg-bg-2" />
            ))}
          </div>
        )}
        {data !== null && (
          <>
            <RunSummary run={data.run} />
            {data.trigger && (
              <Section title="Trigger — what set this off">
                <EventRow event={data.trigger} />
              </Section>
            )}
            <Section title="The run, step by step (from the journal)">
              {data.events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </Section>
          </>
        )}
      </div>
    </>
  );
}

function RunSummary({ run }: { run: Record<string, unknown> }) {
  const fields: Array<[string, unknown]> = [
    ["agent", run["agent_id"]],
    ["kind", run["kind"]],
    ["status", run["status"]],
    ["model", run["model"]],
    ["turns", run["num_turns"]],
    ["duration", run["duration_ms"] != null ? `${Number(run["duration_ms"]) / 1000}s` : null],
    ["cost", run["cost_usd"] != null ? `$${Number(run["cost_usd"]).toFixed(4)}` : null],
  ];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line-1 px-6 py-3">
      {fields
        .filter(([, v]) => v != null)
        .map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
              {label}
            </span>
            <span className="tnum font-mono text-[12px] text-text-1">
              {String(value)}
            </span>
          </div>
        ))}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <h2 className="mb-1 px-6 font-mono text-[10px] uppercase tracking-[0.08em] text-accent">
        {title}
      </h2>
      {children}
    </section>
  );
}
