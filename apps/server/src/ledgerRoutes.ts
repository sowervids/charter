import type { FastifyInstance } from "fastify";
import { newProposalId } from "@charter/schema";
import {
  categorize,
  observeTxns,
  reconcile,
  trialBalance,
  type LedgerCtx,
} from "@charter/ledger";
import type { BankSource } from "@charter/integrations";
import type { ServerContext } from "./env.js";

export function registerLedger(
  app: FastifyInstance,
  ctx: ServerContext,
  sources: BankSource[],
): void {
  const ledgerCtx: LedgerCtx = {
    db: ctx.db,
    log: ctx.log,
    companyId: ctx.company.id,
  };

  async function sync(): Promise<{
    observed: number;
    posted: number;
    confirmedProposals: number;
    queued: number;
  }> {
    let observed = 0;
    for (const source of sources) {
      try {
        observed += observeTxns(ledgerCtx, await source.fetchTxns());
      } catch (error) {
        ctx.log.append({
          company_id: ctx.company.id,
          stream: "ledger",
          type: "devlog.note",
          actor: { kind: "integration", id: `${source.source}-sync` },
          payload: { note: `sync failed: ${String(error).slice(0, 300)}`, tags: ["ledger", "sync-error"] },
        });
      }
    }
    return { observed, ...reconcile(ledgerCtx) };
  }

  app.get("/api/ledger/summary", () => {
    const { rows, rawSumCents } = trialBalance(ledgerCtx);
    const unmatched = ctx.db
      .prepare(
        `SELECT source, external_id, amount_cents, currency, occurred_at, description
           FROM external_txns
          WHERE company_id = ? AND matched_entry_id IS NULL
          ORDER BY occurred_at DESC`,
      )
      .all(ctx.company.id);
    const proposals = ctx.db
      .prepare(
        `SELECT * FROM payment_proposals WHERE company_id = ?
          ORDER BY created_at DESC LIMIT 50`,
      )
      .all(ctx.company.id);
    return { balances: rows, rawSumCents, unmatched, proposals };
  });

  app.get("/api/ledger/entries", () => {
    const entries = ctx.db
      .prepare(
        `SELECT e.entry_id, e.entry_date, e.memo, e.source_kind, e.source_ref,
                json_group_array(json_object(
                  'account_id', l.account_id, 'direction', l.direction,
                  'amount_cents', l.amount_cents, 'currency', l.currency)) AS lines
           FROM ledger_entries e
           JOIN ledger_lines l ON l.entry_id = e.entry_id
          WHERE e.company_id = ?
          GROUP BY e.entry_id
          ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 200`,
      )
      .all(ctx.company.id) as Array<Record<string, unknown>>;
    return {
      entries: entries.map((e) => ({
        ...e,
        lines: JSON.parse(String(e["lines"])) as unknown,
      })),
    };
  });

  app.post("/api/ledger/sync", async () => ({ result: await sync() }));

  app.post("/api/ledger/categorize", (request, reply) => {
    const body = request.body as {
      source?: unknown;
      external_id?: unknown;
      account_id?: unknown;
    };
    if (
      typeof body.source !== "string" ||
      typeof body.external_id !== "string" ||
      typeof body.account_id !== "string"
    ) {
      return reply.code(400).send({ error: "source, external_id, account_id required" });
    }
    const entryId = categorize(
      ledgerCtx,
      {
        source: body.source as "stripe" | "mercury" | "mock",
        external_id: body.external_id,
      },
      body.account_id,
    );
    if (entryId === null) {
      return reply.code(404).send({ error: "txn not found or already matched" });
    }
    return { entry_id: entryId };
  });

  app.post("/api/ledger/proposals", (request, reply) => {
    const body = request.body as {
      counterparty?: unknown;
      amount_cents?: unknown;
      memo?: unknown;
    };
    if (
      typeof body.counterparty !== "string" ||
      typeof body.amount_cents !== "number" ||
      body.amount_cents <= 0 ||
      typeof body.memo !== "string"
    ) {
      return reply
        .code(400)
        .send({ error: "counterparty, positive amount_cents, memo required" });
    }
    const proposalId = newProposalId();
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: "ledger",
      type: "ledger.payment_proposed",
      actor: { kind: "human", id: "founder" },
      payload: {
        proposal_id: proposalId,
        counterparty: body.counterparty,
        amount_cents: Math.round(body.amount_cents),
        currency: "USD",
        memo: body.memo,
      },
    });
    return { event, proposal_id: proposalId };
  });

  app.post("/api/ledger/proposals/:id/:action", (request, reply) => {
    const { id, action } = request.params as { id: string; action: string };
    if (action !== "mark-sent" && action !== "reject") {
      return reply.code(400).send({ error: "action must be mark-sent|reject" });
    }
    const row = ctx.db
      .prepare("SELECT status FROM payment_proposals WHERE proposal_id = ?")
      .get(id) as { status: string } | undefined;
    if (row === undefined) return reply.code(404).send({ error: "not found" });
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: "ledger",
      type:
        action === "mark-sent"
          ? "ledger.payment_marked_sent"
          : "ledger.payment_rejected",
      actor: { kind: "human", id: "founder" },
      payload: { proposal_id: id },
    });
    return { event };
  });

  // Mirror-mode cadence: bank sync every 6h + on demand.
  const timer = setInterval(() => void sync(), 6 * 60 * 60_000);
  timer.unref();
}
