import {
  newEntryId,
  type EventPayload,
} from "@charter/schema";
import type { Db, EventLog } from "@charter/core";

export interface LedgerCtx {
  db: Db;
  log: EventLog;
  companyId: string;
}

export type EntryInput = Omit<EventPayload<"ledger.entry_posted">, "entry_id">;

/** Standard chart-of-accounts ids — opened lazily, deterministic ids so
 *  events stay idempotent across replays and re-imports. */
export const ACCOUNTS = {
  cash: (source: string) => `acct_cash_${source}`,
  stripeBalance: "acct_stripe_balance",
  fees: "acct_fees",
  revenue: "acct_revenue",
  expenseGeneral: "acct_expense_general",
  opening: "acct_opening_balance",
} as const;

export function ensureAccount(
  ctx: LedgerCtx,
  account: {
    account_id: string;
    name: string;
    account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
    currency?: string;
    external_ref?: string;
  },
): void {
  const exists = ctx.db
    .prepare("SELECT 1 FROM ledger_accounts WHERE account_id = ?")
    .get(account.account_id);
  if (exists) return;
  ctx.log.append({
    company_id: ctx.companyId,
    stream: "ledger",
    type: "ledger.account_opened",
    actor: { kind: "system", id: "charterd" },
    payload: {
      account_id: account.account_id,
      name: account.name,
      account_type: account.account_type,
      currency: account.currency ?? "USD",
      ...(account.external_ref ? { external_ref: account.external_ref } : {}),
    },
  });
}

/** Post a balanced entry (the schema refinement rejects unbalanced ones —
 *  a malformed entry cannot enter the log). Returns the entry id. */
export function postEntry(ctx: LedgerCtx, entry: EntryInput): string {
  const entry_id = newEntryId();
  ctx.log.append({
    company_id: ctx.companyId,
    stream: "ledger",
    type: "ledger.entry_posted",
    actor: { kind: "system", id: "charterd" },
    payload: { entry_id, ...entry },
  });
  return entry_id;
}

export interface BalanceRow {
  account_id: string;
  name: string;
  account_type: string;
  currency: string;
  balance_cents: number;
}

/**
 * Trial balance. Sign convention: assets/expenses are debit-positive,
 * liabilities/equity/revenue credit-positive. The invariant — the raw
 * debit-minus-credit sum across ALL accounts is zero — is re-checked here
 * on every call; a nonzero sum means the projection is corrupt.
 */
export function trialBalance(ctx: LedgerCtx): {
  rows: BalanceRow[];
  rawSumCents: number;
} {
  const rows = ctx.db
    .prepare(
      `SELECT a.account_id, a.name, a.account_type, a.currency,
              COALESCE(SUM(CASE WHEN l.direction = 'debit'
                THEN l.amount_cents ELSE -l.amount_cents END), 0) AS raw_cents
         FROM ledger_accounts a
         LEFT JOIN ledger_lines l
           ON l.account_id = a.account_id AND l.company_id = a.company_id
        WHERE a.company_id = ?
        GROUP BY a.account_id
        ORDER BY a.account_type, a.name`,
    )
    .all(ctx.companyId) as Array<BalanceRow & { raw_cents: number }>;

  let rawSum = 0;
  const shaped = rows.map((row) => {
    rawSum += row.raw_cents;
    const creditPositive =
      row.account_type === "liability" ||
      row.account_type === "equity" ||
      row.account_type === "revenue";
    return {
      account_id: row.account_id,
      name: row.name,
      account_type: row.account_type,
      currency: row.currency,
      balance_cents: creditPositive ? -row.raw_cents : row.raw_cents,
    };
  });
  return { rows: shaped, rawSumCents: rawSum };
}
