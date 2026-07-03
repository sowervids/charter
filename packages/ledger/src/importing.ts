import type { EventPayload } from "@charter/schema";
import { ACCOUNTS, ensureAccount, postEntry, type LedgerCtx } from "./domain.js";

export type ExternalTxnInput = Omit<
  EventPayload<"ledger.external_txn_observed">,
  never
>;

/** Idempotent by (source, external_id): re-delivery and reordering are no-ops. */
export function observeTxns(ctx: LedgerCtx, txns: ExternalTxnInput[]): number {
  let fresh = 0;
  for (const txn of txns) {
    const seen = ctx.db
      .prepare(
        "SELECT 1 FROM external_txns WHERE source = ? AND external_id = ?",
      )
      .get(txn.source, txn.external_id);
    if (seen) continue;
    ctx.log.append({
      company_id: ctx.companyId,
      stream: "ledger",
      type: "ledger.external_txn_observed",
      actor: { kind: "integration", id: `${txn.source}-sync` },
      payload: txn,
    });
    fresh += 1;
  }
  return fresh;
}

interface UnmatchedRow {
  source: "stripe" | "mercury" | "mock";
  external_id: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  description: string;
}

function match(ctx: LedgerCtx, txn: UnmatchedRow, entryId: string): void {
  ctx.log.append({
    company_id: ctx.companyId,
    stream: "ledger",
    type: "ledger.txn_matched",
    actor: { kind: "system", id: "charterd" },
    payload: {
      source: txn.source,
      external_id: txn.external_id,
      entry_id: entryId,
    },
  });
}

/**
 * The reconciler. Confident rules auto-post; everything else stays in the
 * queue for a human category call. Sent payment-proposals are matched by
 * amount + recency — that's what turns "I sent it" into verified state.
 */
export function reconcile(ctx: LedgerCtx): {
  posted: number;
  confirmedProposals: number;
  queued: number;
} {
  const unmatched = ctx.db
    .prepare(
      `SELECT source, external_id, amount_cents, currency, occurred_at, description
         FROM external_txns
        WHERE company_id = ? AND matched_entry_id IS NULL
        ORDER BY occurred_at`,
    )
    .all(ctx.companyId) as UnmatchedRow[];

  let posted = 0;
  let confirmedProposals = 0;
  let queued = 0;

  for (const txn of unmatched) {
    const cash = ACCOUNTS.cash(txn.source);
    ensureAccount(ctx, {
      account_id: cash,
      name: `Cash (${txn.source})`,
      account_type: "asset",
      currency: txn.currency,
    });

    // 1) Outflow matching a SENT payment proposal → confirm + post.
    if (txn.amount_cents < 0) {
      const proposal = ctx.db
        .prepare(
          `SELECT proposal_id, counterparty, memo FROM payment_proposals
            WHERE company_id = ? AND status = 'sent'
              AND amount_cents = ? AND currency = ?
            ORDER BY updated_at LIMIT 1`,
        )
        .get(ctx.companyId, -txn.amount_cents, txn.currency) as
        | { proposal_id: string; counterparty: string; memo: string }
        | undefined;
      if (proposal !== undefined) {
        ensureAccount(ctx, {
          account_id: ACCOUNTS.expenseGeneral,
          name: "Expenses (general)",
          account_type: "expense",
        });
        const entryId = postEntry(ctx, {
          entry_date: txn.occurred_at,
          memo: `${proposal.counterparty} — ${proposal.memo}`,
          lines: [
            {
              account_id: ACCOUNTS.expenseGeneral,
              direction: "debit",
              amount_cents: -txn.amount_cents,
              currency: txn.currency,
            },
            {
              account_id: cash,
              direction: "credit",
              amount_cents: -txn.amount_cents,
              currency: txn.currency,
            },
          ],
          source: { kind: "proposal", ref: proposal.proposal_id },
        });
        match(ctx, txn, entryId);
        ctx.log.append({
          company_id: ctx.companyId,
          stream: "ledger",
          type: "ledger.payment_confirmed",
          actor: { kind: "system", id: "charterd" },
          payload: {
            proposal_id: proposal.proposal_id,
            source: txn.source,
            external_id: txn.external_id,
          },
        });
        posted += 1;
        confirmedProposals += 1;
        continue;
      }
    }

    // 2) Confident description rules.
    if (txn.amount_cents > 0 && /stripe payout/i.test(txn.description)) {
      ensureAccount(ctx, {
        account_id: ACCOUNTS.stripeBalance,
        name: "Stripe balance",
        account_type: "asset",
      });
      const entryId = postEntry(ctx, {
        entry_date: txn.occurred_at,
        memo: txn.description,
        lines: [
          { account_id: cash, direction: "debit", amount_cents: txn.amount_cents, currency: txn.currency },
          { account_id: ACCOUNTS.stripeBalance, direction: "credit", amount_cents: txn.amount_cents, currency: txn.currency },
        ],
        source: { kind: "import", ref: `${txn.source}:${txn.external_id}` },
      });
      match(ctx, txn, entryId);
      posted += 1;
      continue;
    }
    if (txn.amount_cents < 0 && /fee/i.test(txn.description)) {
      ensureAccount(ctx, {
        account_id: ACCOUNTS.fees,
        name: "Payment processing fees",
        account_type: "expense",
      });
      const entryId = postEntry(ctx, {
        entry_date: txn.occurred_at,
        memo: txn.description,
        lines: [
          { account_id: ACCOUNTS.fees, direction: "debit", amount_cents: -txn.amount_cents, currency: txn.currency },
          { account_id: cash, direction: "credit", amount_cents: -txn.amount_cents, currency: txn.currency },
        ],
        source: { kind: "import", ref: `${txn.source}:${txn.external_id}` },
      });
      match(ctx, txn, entryId);
      posted += 1;
      continue;
    }

    queued += 1; // human category call in the Treasury queue
  }
  return { posted, confirmedProposals, queued };
}

/** Human categorization from the reconciliation queue. */
export function categorize(
  ctx: LedgerCtx,
  ref: { source: "stripe" | "mercury" | "mock"; external_id: string },
  accountId: string,
): string | null {
  const txn = ctx.db
    .prepare(
      `SELECT source, external_id, amount_cents, currency, occurred_at, description
         FROM external_txns
        WHERE company_id = ? AND source = ? AND external_id = ?
          AND matched_entry_id IS NULL`,
    )
    .get(ctx.companyId, ref.source, ref.external_id) as UnmatchedRow | undefined;
  if (txn === undefined) return null;
  // Standard chart targets open lazily; anything else must already exist.
  const standard: Record<string, { name: string; account_type: "revenue" | "expense" }> = {
    [ACCOUNTS.revenue]: { name: "Revenue", account_type: "revenue" },
    [ACCOUNTS.expenseGeneral]: { name: "Expenses (general)", account_type: "expense" },
    [ACCOUNTS.fees]: { name: "Payment processing fees", account_type: "expense" },
  };
  const known = standard[accountId];
  if (known !== undefined) {
    ensureAccount(ctx, { account_id: accountId, ...known });
  } else if (
    ctx.db.prepare("SELECT 1 FROM ledger_accounts WHERE account_id = ?").get(accountId) ===
    undefined
  ) {
    return null;
  }
  const cash = ACCOUNTS.cash(txn.source);
  const abs = Math.abs(txn.amount_cents);
  const inflow = txn.amount_cents > 0;
  const entryId = postEntry(ctx, {
    entry_date: txn.occurred_at,
    memo: txn.description,
    lines: inflow
      ? [
          { account_id: cash, direction: "debit", amount_cents: abs, currency: txn.currency },
          { account_id: accountId, direction: "credit", amount_cents: abs, currency: txn.currency },
        ]
      : [
          { account_id: accountId, direction: "debit", amount_cents: abs, currency: txn.currency },
          { account_id: cash, direction: "credit", amount_cents: abs, currency: txn.currency },
        ],
    source: { kind: "manual", ref: `${txn.source}:${txn.external_id}` },
  });
  match(ctx, txn, entryId);
  return entryId;
}
