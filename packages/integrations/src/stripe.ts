import type { BankSource, BankTxn } from "./types.js";

/**
 * Stripe balance transactions, read-only (use a RESTRICTED key with only
 * balance-transaction read scope). Activated by STRIPE_API_KEY in
 * var/secrets.env — never present in any agent workspace.
 */
export class StripeSource implements BankSource {
  readonly source = "stripe" as const;
  constructor(private readonly apiKey: string) {}

  async fetchTxns(): Promise<BankTxn[]> {
    const response = await fetch(
      "https://api.stripe.com/v1/balance_transactions?limit=100",
      { headers: { authorization: `Bearer ${this.apiKey}` } },
    );
    if (!response.ok) {
      throw new Error(`stripe: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as {
      data: Array<{
        id: string;
        net: number;
        currency: string;
        created: number;
        description: string | null;
        type: string;
      }>;
    };
    return body.data.map((txn) => ({
      source: "stripe",
      external_id: txn.id,
      amount_cents: txn.net,
      currency: txn.currency.toUpperCase(),
      occurred_at: new Date(txn.created * 1000).toISOString().slice(0, 10),
      description: txn.description ?? txn.type,
    }));
  }
}
