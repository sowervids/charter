import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { newProposalId } from "@charter/schema";
import {
  EventLog,
  ensureProjections,
  migrate,
  openDb,
} from "@charter/core";
import {
  ACCOUNTS,
  ensureAccount,
  postEntry,
  trialBalance,
  type LedgerCtx,
} from "../src/domain.js";
import { categorize, observeTxns, reconcile } from "../src/importing.js";

const COMPANY = "co_test";

function freshCtx(): LedgerCtx {
  const db = openDb(":memory:");
  migrate(db);
  ensureProjections(db);
  return { db, log: new EventLog(db), companyId: COMPANY };
}

function openBasicAccounts(ctx: LedgerCtx): void {
  ensureAccount(ctx, { account_id: "acct_a", name: "A", account_type: "asset" });
  ensureAccount(ctx, { account_id: "acct_b", name: "B", account_type: "expense" });
  ensureAccount(ctx, { account_id: "acct_c", name: "C", account_type: "revenue" });
}

describe("ledger invariants (properties)", () => {
  it("unbalanced entries CANNOT enter the log", () => {
    const ctx = freshCtx();
    openBasicAccounts(ctx);
    expect(() =>
      postEntry(ctx, {
        entry_date: "2026-07-03",
        memo: "bad",
        lines: [
          { account_id: "acct_a", direction: "debit", amount_cents: 100, currency: "USD" },
          { account_id: "acct_b", direction: "credit", amount_cents: 99, currency: "USD" },
        ],
      }),
    ).toThrow(/unbalanced/);
  });

  it("Σ(debits−credits) is zero across ALL accounts after ANY entry sequence", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amount: fc.integer({ min: 1, max: 1_000_000 }),
            from: fc.constantFrom("acct_a", "acct_b"),
            to: fc.constantFrom("acct_b", "acct_c"),
          }),
          { maxLength: 40 },
        ),
        (transfers) => {
          const ctx = freshCtx();
          openBasicAccounts(ctx);
          for (const t of transfers) {
            postEntry(ctx, {
              entry_date: "2026-07-03",
              memo: "t",
              lines: [
                { account_id: t.to, direction: "debit", amount_cents: t.amount, currency: "USD" },
                { account_id: t.from, direction: "credit", amount_cents: t.amount, currency: "USD" },
              ],
            });
          }
          expect(trialBalance(ctx).rawSumCents).toBe(0);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("import is idempotent under re-delivery and reordering", () => {
    const txns = [
      { source: "mock" as const, external_id: "t1", amount_cents: 5000, currency: "USD", occurred_at: "2026-07-01", description: "STRIPE PAYOUT" },
      { source: "mock" as const, external_id: "t2", amount_cents: -150, currency: "USD", occurred_at: "2026-07-01", description: "STRIPE FEE" },
      { source: "mock" as const, external_id: "t3", amount_cents: -999, currency: "USD", occurred_at: "2026-07-02", description: "MYSTERY" },
    ];
    const ctx = freshCtx();
    expect(observeTxns(ctx, txns)).toBe(3);
    reconcile(ctx);
    const snapshot = JSON.stringify(
      ctx.db.prepare("SELECT * FROM external_txns ORDER BY external_id").all(),
    );
    const entries = (
      ctx.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }
    ).n;

    // Re-deliver reversed, reconcile again: nothing changes.
    expect(observeTxns(ctx, [...txns].reverse())).toBe(0);
    reconcile(ctx);
    expect(
      JSON.stringify(
        ctx.db.prepare("SELECT * FROM external_txns ORDER BY external_id").all(),
      ),
    ).toBe(snapshot);
    expect(
      (ctx.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries").get() as { n: number }).n,
    ).toBe(entries);
  });

  it("reconcile auto-posts payouts+fees, queues the unknown, never double-matches", () => {
    const ctx = freshCtx();
    observeTxns(ctx, [
      { source: "mock", external_id: "p1", amount_cents: 5000, currency: "USD", occurred_at: "2026-07-01", description: "STRIPE PAYOUT X" },
      { source: "mock", external_id: "f1", amount_cents: -145, currency: "USD", occurred_at: "2026-07-01", description: "STRIPE FEE X" },
      { source: "mock", external_id: "u1", amount_cents: -2300, currency: "USD", occurred_at: "2026-07-02", description: "AWS" },
    ]);
    const first = reconcile(ctx);
    expect(first).toEqual({ posted: 2, confirmedProposals: 0, queued: 1 });
    expect(reconcile(ctx)).toEqual({ posted: 0, confirmedProposals: 0, queued: 1 });

    // Human categorizes the AWS charge; queue drains; balance still holds.
    ensureAccount(ctx, { account_id: ACCOUNTS.expenseGeneral, name: "Expenses", account_type: "expense" });
    expect(categorize(ctx, { source: "mock", external_id: "u1" }, ACCOUNTS.expenseGeneral)).toBeTruthy();
    expect(reconcile(ctx).queued).toBe(0);
    expect(trialBalance(ctx).rawSumCents).toBe(0);
  });

  it("sent proposals are confirmed by a matching outflow — the full loop", () => {
    const ctx = freshCtx();
    const proposalId = newProposalId();
    ctx.log.append({
      company_id: COMPANY,
      stream: "ledger",
      type: "ledger.payment_proposed",
      actor: { kind: "agent", id: "ship" },
      payload: { proposal_id: proposalId, counterparty: "Vercel", amount_cents: 2000, currency: "USD", memo: "hosting" },
    });
    ctx.log.append({
      company_id: COMPANY,
      stream: "ledger",
      type: "ledger.payment_marked_sent",
      actor: { kind: "human", id: "founder" },
      payload: { proposal_id: proposalId },
    });
    observeTxns(ctx, [
      { source: "mock", external_id: "out1", amount_cents: -2000, currency: "USD", occurred_at: "2026-07-03", description: "VERCEL" },
    ]);
    const result = reconcile(ctx);
    expect(result.confirmedProposals).toBe(1);
    const proposal = ctx.db
      .prepare("SELECT status, confirmed_external_id FROM payment_proposals WHERE proposal_id = ?")
      .get(proposalId) as { status: string; confirmed_external_id: string };
    expect(proposal.status).toBe("confirmed");
    expect(proposal.confirmed_external_id).toBe("out1");
    expect(trialBalance(ctx).rawSumCents).toBe(0);
  });
});
