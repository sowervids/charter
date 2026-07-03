export interface BankTxn {
  source: "stripe" | "mercury" | "mock";
  external_id: string;
  /** signed cents: + inflow, − outflow */
  amount_cents: number;
  currency: string;
  occurred_at: string;
  description: string;
}

/** A read-only puller. Sources never touch the DB — charterd feeds their
 *  output to @charter/ledger. Credentials live ONLY in charterd's env. */
export interface BankSource {
  readonly source: BankTxn["source"];
  fetchTxns(): Promise<BankTxn[]>;
}
