import { useCallback, useEffect, useState } from "react";
import { Landmark, Plus, RefreshCw } from "lucide-react";
import { getToken } from "../lib/api.js";
import { useStore } from "../lib/store.js";
import { Dialog } from "./Dialog.js";

interface Balance {
  account_id: string;
  name: string;
  account_type: string;
  currency: string;
  balance_cents: number;
}
interface Unmatched {
  source: string;
  external_id: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  description: string;
}
interface Proposal {
  proposal_id: string;
  counterparty: string;
  amount_cents: number;
  currency: string;
  memo: string;
  status: string;
  proposed_by: string;
}

async function ledgerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${getToken()}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function TreasuryView() {
  const { state } = useStore();
  const [data, setData] = useState<{
    balances: Balance[];
    rawSumCents: number;
    unmatched: Unmatched[];
    proposals: Proposal[];
  } | null>(null);
  const [error, setError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [proposing, setProposing] = useState(false);

  const refresh = useCallback(() => {
    ledgerFetch<NonNullable<typeof data>>("/api/ledger/summary")
      .then(setData)
      .catch(() => setError(true));
  }, []);

  useEffect(refresh, [refresh, state.lastSeq]);

  const sync = async () => {
    setSyncing(true);
    try {
      await ledgerFetch("/api/ledger/sync", { method: "POST" });
    } finally {
      setSyncing(false);
      refresh();
    }
  };

  const act = async (path: string, body?: unknown) => {
    await ledgerFetch(path, {
      method: "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    refresh();
  };

  const assets = data?.balances.filter((b) => b.account_type === "asset") ?? [];

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-1 px-6">
        <h1 className="text-[13px] font-semibold">Treasury</h1>
        <span className="tnum font-mono text-[11px] text-text-3">
          mirror mode · books balance {data ? (data.rawSumCents === 0 ? "✓" : "BROKEN") : "…"}
        </span>
        <button
          type="button"
          onClick={() => setProposing(true)}
          className="ml-auto flex items-center gap-1.5 rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1 text-[12px] text-text-2 transition-colors duration-(--motion-fast) hover:border-line-2 hover:text-text-1"
        >
          <Plus size={13} strokeWidth={1.5} /> New proposal
        </button>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1 text-[12px] text-text-2 transition-colors duration-(--motion-fast) hover:border-line-2 hover:text-text-1 disabled:opacity-40"
        >
          <RefreshCw size={13} strokeWidth={1.5} className={syncing ? "animate-spin" : ""} />
          Sync banks
        </button>
      </header>
      {proposing && (
        <ProposalDialog
          onClose={() => setProposing(false)}
          onSubmit={async (counterparty, amount_cents, memo) => {
            await act("/api/ledger/proposals", { counterparty, amount_cents, memo });
            setProposing(false);
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <p className="py-8 text-[13px] text-text-3">Couldn't load the books.</p>
        )}
        {!error && data === null && (
          <div className="flex gap-3" aria-hidden>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 w-44 rounded-md bg-bg-2" />
            ))}
          </div>
        )}
        {data !== null && (
          <>
            {data.balances.length === 0 && (
              <div className="flex flex-col items-start gap-2 py-10">
                <Landmark size={18} strokeWidth={1.5} className="text-text-3" />
                <p className="text-[14px] text-text-1">No money has moved.</p>
                <p className="max-w-md text-[12px] text-text-3">
                  Hit “Sync banks” to pull transactions (mock bank until real
                  keys land in var/secrets.env). Every cent will land here with
                  a trace.
                </p>
              </div>
            )}

            {data.balances.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {assets.map((b) => (
                  <div key={b.account_id} className="rounded-md border border-line-1 bg-bg-1 px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
                      {b.name}
                    </div>
                    <div className="tnum mt-1 font-mono text-[16px] leading-[22px] text-text-1">
                      {usd(b.balance_cents)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.proposals.length > 0 && (
              <Section title="Payment proposals">
                {data.proposals.map((p) => (
                  <div
                    key={p.proposal_id}
                    className="mb-2 flex items-center gap-3 rounded-md border border-line-1 bg-bg-1 px-4 py-2.5"
                  >
                    <span className="tnum font-mono text-[14px] text-text-1">
                      {usd(p.amount_cents)}
                    </span>
                    <span className="text-[13px] text-text-1">{p.counterparty}</span>
                    <span className="truncate text-[12px] text-text-3">{p.memo}</span>
                    <span className="font-mono text-[10px] text-text-3">
                      by {p.proposed_by}
                    </span>
                    <span
                      className={`ml-auto font-mono text-[10px] uppercase ${
                        p.status === "confirmed"
                          ? "text-ok"
                          : p.status === "rejected"
                            ? "text-danger"
                            : p.status === "sent"
                              ? "text-info"
                              : "text-warn"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.status === "proposed" && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void act(`/api/ledger/proposals/${p.proposal_id}/reject`)
                          }
                          className="rounded-sm border border-danger/50 px-2 py-0.5 text-[11px] text-danger hover:bg-danger/10"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void act(`/api/ledger/proposals/${p.proposal_id}/mark-sent`)
                          }
                          className="rounded-sm bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-ink"
                          title="Execute in your real bank UI, then mark sent — the next sync verifies it"
                        >
                          I sent it
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {data.unmatched.length > 0 && (
              <Section title={`Reconciliation queue · ${data.unmatched.length}`}>
                {data.unmatched.map((t) => (
                  <div
                    key={`${t.source}:${t.external_id}`}
                    className="mb-1.5 flex items-center gap-3 rounded-sm border border-line-1 px-3 py-2"
                  >
                    <span className="tnum font-mono text-[11px] text-text-3">
                      {t.occurred_at}
                    </span>
                    <span className="truncate font-mono text-[12px] text-text-1">
                      {t.description}
                    </span>
                    <span
                      className={`tnum ml-auto font-mono text-[13px] ${
                        t.amount_cents < 0 ? "text-danger" : "text-ok"
                      }`}
                    >
                      {usd(t.amount_cents)}
                    </span>
                    {(
                      [
                        ["revenue", "acct_revenue"],
                        ["expense", "acct_expense_general"],
                      ] as const
                    ).map(([label, account]) => (
                      <button
                        key={account}
                        type="button"
                        onClick={() =>
                          void act("/api/ledger/categorize", {
                            source: t.source,
                            external_id: t.external_id,
                            account_id: account,
                          })
                        }
                        className="rounded-sm border border-line-1 px-2 py-0.5 font-mono text-[10px] text-text-2 hover:border-line-2 hover:text-text-1"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ProposalDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (counterparty: string, amountCents: number, memo: string) => void;
}) {
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const cents = Math.round(Number(amount) * 100);
  const valid = counterparty.trim() && cents > 0 && memo.trim();
  return (
    <Dialog
      title="Propose a payment"
      onClose={onClose}
      onSubmit={() => valid && onSubmit(counterparty.trim(), cents, memo.trim())}
      submitLabel="Propose"
      submitDisabled={!valid}
    >
      <div className="mb-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">Counterparty</div>
        <input autoFocus value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Vercel Inc" className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
      </div>
      <div className="mb-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">Amount (USD)</div>
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="20.00" className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 font-mono text-[13px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
      </div>
      <div className="mb-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">Memo</div>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Hosting, July" className="w-full rounded-sm border border-line-1 bg-bg-2 px-2.5 py-1.5 text-[12px] text-text-1 has-[:focus]:border-accent-dim placeholder:text-text-3" />
      </div>
      <p className="font-mono text-[10px] text-text-3">Proposals are drafts. You execute in your real bank, then “I sent it” — the next sync verifies it.</p>
    </Dialog>
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
    <section className="mt-6">
      <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
        {title}
      </h2>
      {children}
    </section>
  );
}
