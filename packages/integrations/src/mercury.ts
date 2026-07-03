import type { BankSource, BankTxn } from "./types.js";

/**
 * Mercury transactions, read-only token. Activated by MERCURY_API_TOKEN in
 * var/secrets.env — never present in any agent workspace.
 */
export class MercurySource implements BankSource {
  readonly source = "mercury" as const;
  constructor(private readonly token: string) {}

  async fetchTxns(): Promise<BankTxn[]> {
    const headers = { authorization: `Bearer ${this.token}` };
    const accountsRes = await fetch("https://api.mercury.com/api/v1/accounts", {
      headers,
    });
    if (!accountsRes.ok) {
      throw new Error(`mercury: ${accountsRes.status}`);
    }
    const { accounts } = (await accountsRes.json()) as {
      accounts: Array<{ id: string }>;
    };
    const txns: BankTxn[] = [];
    for (const account of accounts) {
      const txRes = await fetch(
        `https://api.mercury.com/api/v1/account/${account.id}/transactions?limit=500`,
        { headers },
      );
      if (!txRes.ok) continue;
      const body = (await txRes.json()) as {
        transactions: Array<{
          id: string;
          amount: number;
          postedAt: string | null;
          createdAt: string;
          bankDescription: string | null;
          counterpartyName: string | null;
        }>;
      };
      for (const txn of body.transactions) {
        txns.push({
          source: "mercury",
          external_id: txn.id,
          amount_cents: Math.round(txn.amount * 100),
          currency: "USD",
          occurred_at: (txn.postedAt ?? txn.createdAt).slice(0, 10),
          description:
            txn.bankDescription ?? txn.counterpartyName ?? "mercury txn",
        });
      }
    }
    return txns;
  }
}
