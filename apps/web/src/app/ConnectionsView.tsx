import { useEffect, useState } from "react";
import { Banknote, Cpu, GitBranch, Plug } from "lucide-react";
import { getToken } from "../lib/api.js";

interface Connection {
  id: string;
  name: string;
  kind: "runtime" | "code" | "bank";
  status: "connected" | "degraded" | "not_configured";
  detail: string;
}

const ICON = { runtime: Cpu, code: GitBranch, bank: Banknote } as const;

export function ConnectionsView() {
  const [connections, setConnections] = useState<Connection[] | null>(null);

  useEffect(() => {
    void fetch("/api/connections", {
      headers: { authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((d: { connections: Connection[] }) => setConnections(d.connections))
      .catch(() => setConnections([]));
  }, []);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <h1 className="text-[13px] font-semibold">Connections</h1>
        <span className="tnum font-mono text-[11px] text-text-3">
          what agents can reach
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <p className="mb-4 max-w-xl text-[12px] leading-relaxed text-text-3">
          Agents can only touch what's connected here. Credentials live in
          <span className="font-mono text-text-2"> var/secrets.env</span> (never
          in git, never visible to an agent's shell). Bank connections are
          read-only mirrors — Keelson never holds or moves money.
        </p>
        <div className="space-y-2">
          {connections === null &&
            [1, 2, 3].map((i) => <div key={i} className="h-16 rounded-md bg-bg-2" />)}
          {connections?.map((c) => {
            const Icon = ICON[c.kind];
            return (
              <div key={c.id} className="flex items-center gap-3 rounded-md border border-line-1 bg-bg-1 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-2 text-text-2">
                  <Icon size={16} strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text-1">{c.name}</div>
                  <div className="truncate text-[11px] text-text-3">{c.detail}</div>
                </div>
                <StatusPill status={c.status} />
              </div>
            );
          })}
          {connections?.length === 0 && (
            <div className="flex flex-col items-start gap-2 py-8">
              <Plug size={18} strokeWidth={1.5} className="text-text-3" />
              <p className="text-[13px] text-text-2">Nothing is connected.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StatusPill({ status }: { status: Connection["status"] }) {
  const map = {
    connected: ["Connected", "var(--color-ok)"],
    degraded: ["Degraded", "var(--color-warn)"],
    not_configured: ["Not set up", "var(--color-text-3)"],
  } as const;
  const [label, color] = map[status];
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em]" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
