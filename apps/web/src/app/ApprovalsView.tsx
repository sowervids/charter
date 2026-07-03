import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api, type ApprovalInfo } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { agentHueVar } from "../lib/identity.js";

/**
 * The control room. Approving authorizes EXACTLY the shown payload, once —
 * hash-scoped, single-use. Notes are per-card. J/K move; A/D resolve.
 */
export function ApprovalsView() {
  const { state, navigate } = useStore();
  const [pending, setPending] = useState<ApprovalInfo[] | null>(null);
  const [recent, setRecent] = useState<ApprovalInfo[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState(0);

  const refresh = useCallback(() => {
    void api.approvals("pending").then(({ approvals }) => setPending(approvals));
    void Promise.all([
      api.approvals("allowed"),
      api.approvals("denied"),
      api.approvals("consumed"),
    ]).then((results) =>
      setRecent(
        results
          .flatMap((r) => r.approvals)
          .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
          .slice(0, 20),
      ),
    );
  }, []);
  useEffect(refresh, [refresh, state.lastSeq]);

  const resolve = useCallback(
    async (approval: ApprovalInfo, decision: "allow" | "deny") => {
      await api.resolveApproval(approval.approval_id, decision, notes[approval.approval_id]?.trim() || undefined);
      setNotes((n) => {
        const { [approval.approval_id]: _drop, ...rest } = n;
        return rest;
      });
      refresh();
    },
    [notes, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!pending || pending.length === 0) return;
      const cur = pending[Math.min(focus, pending.length - 1)];
      if (!cur) return;
      if (e.key === "j" || e.key === "ArrowDown") setFocus((f) => Math.min(f + 1, pending.length - 1));
      else if (e.key === "k" || e.key === "ArrowUp") setFocus((f) => Math.max(f - 1, 0));
      else if (e.key === "a") void resolve(cur, "allow");
      else if (e.key === "d") void resolve(cur, "deny");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, focus, resolve]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <h1 className="text-[13px] font-semibold">Approvals</h1>
        <span className="tnum font-mono text-[11px] text-text-3">{pending?.length ?? "…"} waiting</span>
        {pending && pending.length > 0 && (
          <span className="ml-auto font-mono text-[10px] text-text-3">
            <kbd className="text-text-2">J/K</kbd> move · <kbd className="text-text-2">A</kbd> approve · <kbd className="text-text-2">D</kbd> deny
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {pending === null && [1, 2].map((i) => <div key={i} className="mb-3 h-28 rounded-md bg-bg-2" />)}

        {pending !== null && pending.length === 0 && (
          <div className="flex flex-col items-start gap-2 py-10">
            <ShieldCheck size={18} strokeWidth={1.5} className="text-ok" />
            <p className="text-[14px] text-text-1">Nothing needs you.</p>
            <p className="max-w-md text-[12px] text-text-3">
              Agents act freely inside their policies; anything gated lands here
              and the agent stands down until you decide.
            </p>
          </div>
        )}

        {pending?.map((approval, i) => (
          <div
            key={approval.approval_id}
            className={`mb-3 rounded-md border bg-bg-1 transition-colors duration-(--motion-fast) ${
              i === focus ? "border-accent-dim" : "border-warn/30"
            }`}
          >
            <div className="flex items-baseline gap-2 border-b border-line-1 px-4 py-2.5">
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: agentHueVar(approval.agent_id) }}>
                @{approval.agent_id}
              </span>
              <span className="text-[13px] text-text-1">
                wants to run <span className="font-semibold">{approval.tool}</span>
              </span>
              <button
                type="button"
                onClick={() => navigate({ kind: "trace", runId: approval.run_id })}
                className="font-mono text-[10px] text-text-3 hover:text-text-1 hover:underline"
              >
                why?
              </button>
              <span className="tnum ml-auto font-mono text-[10px] text-text-3">{approval.requested_at.slice(11, 19)}</span>
            </div>
            <pre className="overflow-x-auto border-b border-line-1 bg-bg-2 px-4 py-3 font-mono text-[12px] leading-[18px] text-text-1">
              {approval.input_summary}
            </pre>
            <div className="flex items-center gap-2 border-b border-line-1 px-4 py-2 font-mono text-[10px] text-text-3">
              rule <span className="text-warn">{approval.rule}</span>
              <span className="ml-auto">sha256 {approval.payload_hash.slice(0, 12)}… · single-use</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <input
                value={notes[approval.approval_id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [approval.approval_id]: e.target.value }))}
                onFocus={() => setFocus(i)}
                placeholder="note to the agent (optional)"
                className="flex-1 rounded-sm border border-line-1 bg-bg-2 px-2 py-1 text-[12px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3"
              />
              <button type="button" onClick={() => void resolve(approval, "deny")} className="rounded-sm border border-danger/50 px-3 py-1 text-[12px] text-danger hover:bg-danger/10">
                Deny
              </button>
              <button type="button" onClick={() => void resolve(approval, "allow")} className="rounded-sm bg-accent px-3 py-1 text-[12px] font-medium text-accent-ink">
                Approve
              </button>
            </div>
          </div>
        ))}

        {recent.length > 0 && (
          <>
            <h2 className="mb-2 mt-8 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">Resolved recently</h2>
            {recent.map((approval) => (
              <div key={approval.approval_id} className="mb-1 flex items-baseline gap-2 rounded-sm px-2 py-1.5 hover:bg-bg-1">
                <span className={`font-mono text-[10px] uppercase ${approval.status === "denied" ? "text-danger" : "text-ok"}`}>{approval.status}</span>
                <span className="font-mono text-[11px]" style={{ color: agentHueVar(approval.agent_id) }}>@{approval.agent_id}</span>
                <span className="truncate font-mono text-[11px] text-text-2">{approval.input_summary}</span>
                {approval.note && <span className="truncate text-[11px] text-text-3">“{approval.note}”</span>}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
