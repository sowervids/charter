import { readFileSync } from "node:fs";
import type { BankSource, BankTxn } from "./types.js";

/** Reads fixtures/bank/mock-txns.json — the $0 stand-in until real
 *  Stripe/Mercury keys are connected. Re-read every sync, so appending a
 *  fixture row simulates a new bank transaction. */
export class MockBankSource implements BankSource {
  readonly source = "mock" as const;
  constructor(private readonly fixturePath: string) {}

  fetchTxns(): Promise<BankTxn[]> {
    const rows = JSON.parse(readFileSync(this.fixturePath, "utf8")) as Array<
      Omit<BankTxn, "source">
    >;
    return Promise.resolve(rows.map((row) => ({ ...row, source: "mock" })));
  }
}
