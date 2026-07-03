import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pause, Play, UserPlus } from "lucide-react";
import type { CommittedEvent } from "@charter/schema";
import { api, type AgentDetail, type AgentSummary } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { agentHueVar } from "../lib/identity.js";
import { Avatar } from "./Avatar.js";
import { Dialog } from "./Dialog.js";
import { EventRow } from "./EventRow.js";

function usd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function PeopleView() {
  const { state, navigate } = useStore();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [hiring, setHiring] = useState(false);

  const refresh = useCallback(() => {
    void api.agents().then(({ agents }) => setAgents(agents)).catch(() => setAgents([]));
  }, []);
  useEffect(refresh, [refresh, state.lastSeq]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <h1 className="text-[13px] font-semibold">People &amp; Agents</h1>
        <span className="tnum font-mono text-[11px] text-text-3">
          1 human · {agents?.length ?? "…"} agents
        </span>
        <button
          type="button"
          onClick={() => setHiring(true)}
          className="ml-auto flex items-center gap-1.5 rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1 text-[12px] text-text-2 hover:border-line-2 hover:text-text-1"
        >
          <UserPlus size={14} strokeWidth={1.5} /> Hire an agent
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          <MemberCard
            id="founder"
            name="Founder"
            role="Founder"
            kind="human"
            onClick={() => undefined}
          />
          {agents?.map((a) => (
            <MemberCard
              key={a.id}
              id={a.id}
              name={a.name}
              role={a.role}
              kind="agent"
              agent={a}
              live={Object.values(state.runs).some(
                (r) => r.agentId === a.id && (r.status === "running" || r.status === "queued"),
              )}
              onClick={() => navigate({ kind: "agent", agentId: a.id })}
            />
          ))}
        </div>
      </div>

      {hiring && <HireDialog onClose={() => setHiring(false)} onHired={(id) => { setHiring(false); navigate({ kind: "agent", agentId: id }); }} />}
    </>
  );
}

function MemberCard({
  id,
  name,
  role,
  kind,
  agent,
  live,
  onClick,
}: {
  id: string;
  name: string;
  role: string;
  kind: "human" | "agent";
  agent?: AgentSummary;
  live?: boolean;
  onClick: () => void;
}) {
  const isAgent = kind === "agent";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col rounded-lg border border-line-1 bg-bg-1 p-3.5 text-left transition-colors duration-(--motion-fast) ${isAgent ? "hover:border-line-2 hover:bg-bg-2" : "cursor-default"}`}
    >
      <div className="flex items-center gap-2.5">
        <Avatar id={id} name={name} kind={kind} size={34} live={live} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-text-1" style={isAgent ? { color: agentHueVar(id) } : undefined}>
            {isAgent ? `@${id}` : name}
          </div>
          <div className="truncate text-[11px] text-text-3">{role}</div>
        </div>
        {agent?.paused && <span className="ml-auto self-start font-mono text-[9px] uppercase text-warn">paused</span>}
      </div>
      {agent && (
        <div className="mt-3 flex items-center gap-4 border-t border-line-1 pt-2.5 font-mono text-[10px] text-text-3">
          <Stat label="runs today" value={String(agent.runs_today ?? 0)} />
          <Stat label="spent" value={usd(agent.cost_usd)} />
          {agent.failed > 0 && <Stat label="failed" value={String(agent.failed)} tone="danger" />}
        </div>
      )}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <div className={`tnum text-[12px] ${tone === "danger" ? "text-danger" : "text-text-1"}`}>{value}</div>
      <div className="uppercase tracking-[0.06em]">{label}</div>
    </div>
  );
}

export function AgentDetailView({ agentId }: { agentId: string }) {
  const { state, navigate } = useStore();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [tab, setTab] = useState<"charter" | "policy" | "activity" | "budget">("charter");
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    void api.agent(agentId).then(setDetail).catch(() => setError(true));
  }, [agentId]);
  useEffect(refresh, [refresh, state.lastSeq]);

  if (error) {
    return <Centered>No agent named @{agentId}.</Centered>;
  }
  if (detail === null) {
    return <Centered>loading @{agentId}…</Centered>;
  }
  const hue = agentHueVar(agentId);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-5">
        <button type="button" onClick={() => navigate({ kind: "people" })} aria-label="Back" className="rounded-sm p-1 text-text-3 hover:bg-bg-2 hover:text-text-1">
          <ArrowLeft size={14} strokeWidth={1.5} />
        </button>
        <Avatar id={agentId} name={detail.agent.name} kind="agent" size={24} />
        <div>
          <div className="text-[13px] font-semibold" style={{ color: hue }}>@{agentId}</div>
        </div>
        <span className="font-mono text-[11px] text-text-3">{detail.agent.role} · {detail.agent.model}</span>
        <button
          type="button"
          onClick={async () => {
            await api.pauseAgent(agentId, !detail.agent.paused);
            refresh();
          }}
          className={`ml-auto flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] ${
            detail.agent.paused ? "border-ok/40 text-ok hover:bg-ok/10" : "border-line-1 text-text-2 hover:border-line-2 hover:text-text-1"
          }`}
        >
          {detail.agent.paused ? <><Play size={13} strokeWidth={1.5} /> Resume</> : <><Pause size={13} strokeWidth={1.5} /> Pause</>}
        </button>
      </header>

      <div className="flex gap-1 border-b border-line-1 px-5">
        {(["charter", "policy", "activity", "budget"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 py-2 text-[12px] capitalize transition-colors duration-(--motion-fast) ${
              tab === t ? "border-accent text-text-1" : "border-transparent text-text-3 hover:text-text-2"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "charter" && (
          <div className="mx-auto max-w-2xl px-8 py-8">
            <article className="whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-text-1">
              {detail.charter}
            </article>
          </div>
        )}
        {tab === "policy" && (
          <pre className="overflow-x-auto p-6 font-mono text-[12px] leading-[19px] text-text-2">
            {JSON.stringify(detail.policy, null, 2)}
          </pre>
        )}
        {tab === "activity" && (
          <div className="py-3">
            {detail.activity.length === 0 && <p className="px-6 py-6 text-[13px] text-text-3">No activity yet.</p>}
            {detail.activity.map((e: CommittedEvent) => (
              <EventRow key={e.id} event={e} roster={state.roster} onTrace={(runId) => navigate({ kind: "trace", runId })} />
            ))}
          </div>
        )}
        {tab === "budget" && (
          <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-4">
            <BudgetCard label="Runs (all time)" value={String(detail.budget.runs_total)} />
            <BudgetCard label="Runs today" value={`${detail.budget.runs_today} / ${detail.agent.daily_runs}`} />
            <BudgetCard label="Spent (shadow)" value={usd(detail.budget.cost_usd)} />
            <BudgetCard label="Failed" value={String(detail.budget.failed)} tone={detail.budget.failed > 0 ? "danger" : undefined} />
          </div>
        )}
      </div>
    </>
  );
}

function BudgetCard({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-md border border-line-1 bg-bg-1 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{label}</div>
      <div className={`tnum mt-1 font-mono text-[16px] ${tone === "danger" ? "text-danger" : "text-text-1"}`}>{value}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center font-mono text-[12px] text-text-3">{children}</div>;
}

function HireDialog({ onClose, onHired }: { onClose: () => void; onHired: (id: string) => void }) {
  const { toast } = useStore();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [role, setRole] = useState("");
  const [charter, setCharter] = useState("");
  const idSlug = (id || name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const submit = async () => {
    if (!idSlug || !name.trim() || !role.trim() || !charter.trim()) return;
    try {
      const { agent_id } = await api.hireAgent({ id: idSlug, name: name.trim(), role: role.trim(), charter: charter.trim() });
      onHired(agent_id);
    } catch {
      toast("Couldn't hire — that handle may already exist", "danger");
    }
  };

  return (
    <Dialog title="Hire an agent" onClose={onClose} onSubmit={() => void submit()} submitLabel="Hire" submitDisabled={!idSlug || !name.trim() || !role.trim() || !charter.trim()} width={520}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Operations" className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
        </Field>
        <Field label="Handle">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder={idSlug || "ops"} className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 font-mono text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
          <p className="mt-1 font-mono text-[10px] text-text-3">@{idSlug || "…"}</p>
        </Field>
      </div>
      <Field label="Role">
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Operations & scheduling" className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
      </Field>
      <Field label="Charter — its mandate & how it works">
        <textarea value={charter} onChange={(e) => setCharter(e.target.value)} rows={6} placeholder={"You are the operations agent at Keelson. Your job is…\n\nHow you work:\n- Be concrete and brief.\n- You are on the record."} className="w-full resize-none rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[12px] leading-[18px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
      </Field>
      <p className="font-mono text-[10px] text-text-3">Starts with a safe default policy (read-only + no shell writes). Tighten it in company/agents/{idSlug || "…"}/policy.json.</p>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">{label}</div>
      {children}
    </div>
  );
}
