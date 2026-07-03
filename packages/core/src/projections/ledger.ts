import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const ledgerProjector: Projector = {
  name: "ledger",
  version: 1,
  types: [
    "ledger.account_opened",
    "ledger.entry_posted",
    "ledger.external_txn_observed",
    "ledger.txn_matched",
    "ledger.payment_proposed",
    "ledger.payment_marked_sent",
    "ledger.payment_rejected",
    "ledger.payment_confirmed",
  ],
  apply(db, event) {
    switch (event.type) {
      case "ledger.account_opened": {
        const p = event.payload as EventPayload<"ledger.account_opened">;
        db.prepare(
          `INSERT INTO ledger_accounts
             (account_id, company_id, name, account_type, currency, external_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (account_id) DO NOTHING`,
        ).run(
          p.account_id,
          event.company_id,
          p.name,
          p.account_type,
          p.currency,
          p.external_ref ?? null,
          event.created_at,
        );
        break;
      }
      case "ledger.entry_posted": {
        const p = event.payload as EventPayload<"ledger.entry_posted">;
        const inserted = db
          .prepare(
            `INSERT INTO ledger_entries
               (entry_id, company_id, entry_date, memo, source_kind, source_ref, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (entry_id) DO NOTHING`,
          )
          .run(
            p.entry_id,
            event.company_id,
            p.entry_date,
            p.memo,
            p.source?.kind ?? null,
            p.source?.ref ?? null,
            event.created_at,
          );
        if (inserted.changes === 0) break;
        const insertLine = db.prepare(
          `INSERT INTO ledger_lines
             (entry_id, line_no, company_id, account_id, direction, amount_cents, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        p.lines.forEach((line, i) => {
          insertLine.run(
            p.entry_id,
            i,
            event.company_id,
            line.account_id,
            line.direction,
            line.amount_cents,
            line.currency,
          );
        });
        break;
      }
      case "ledger.external_txn_observed": {
        const p = event.payload as EventPayload<"ledger.external_txn_observed">;
        db.prepare(
          `INSERT INTO external_txns
             (source, external_id, company_id, amount_cents, currency,
              occurred_at, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (source, external_id) DO NOTHING`,
        ).run(
          p.source,
          p.external_id,
          event.company_id,
          p.amount_cents,
          p.currency,
          p.occurred_at,
          p.description,
        );
        break;
      }
      case "ledger.txn_matched": {
        const p = event.payload as EventPayload<"ledger.txn_matched">;
        db.prepare(
          `UPDATE external_txns SET matched_entry_id = ?
            WHERE source = ? AND external_id = ? AND matched_entry_id IS NULL`,
        ).run(p.entry_id, p.source, p.external_id);
        break;
      }
      case "ledger.payment_proposed": {
        const p = event.payload as EventPayload<"ledger.payment_proposed">;
        db.prepare(
          `INSERT INTO payment_proposals
             (proposal_id, company_id, counterparty, amount_cents, currency,
              memo, status, proposed_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)
           ON CONFLICT (proposal_id) DO NOTHING`,
        ).run(
          p.proposal_id,
          event.company_id,
          p.counterparty,
          p.amount_cents,
          p.currency,
          p.memo,
          `${event.actor.kind}:${event.actor.id}`,
          event.created_at,
          event.created_at,
        );
        break;
      }
      case "ledger.payment_marked_sent": {
        const p = event.payload as EventPayload<"ledger.payment_marked_sent">;
        db.prepare(
          `UPDATE payment_proposals SET status = 'sent', updated_at = ?
            WHERE proposal_id = ? AND status = 'proposed'`,
        ).run(event.created_at, p.proposal_id);
        break;
      }
      case "ledger.payment_rejected": {
        const p = event.payload as EventPayload<"ledger.payment_rejected">;
        db.prepare(
          `UPDATE payment_proposals SET status = 'rejected', updated_at = ?
            WHERE proposal_id = ? AND status IN ('proposed','sent')`,
        ).run(event.created_at, p.proposal_id);
        break;
      }
      case "ledger.payment_confirmed": {
        const p = event.payload as EventPayload<"ledger.payment_confirmed">;
        db.prepare(
          `UPDATE payment_proposals
              SET status = 'confirmed', confirmed_external_id = ?, updated_at = ?
            WHERE proposal_id = ? AND status = 'sent'`,
        ).run(p.external_id, event.created_at, p.proposal_id);
        break;
      }
    }
  },
  truncate(db) {
    db.exec(`
      DELETE FROM ledger_lines;
      DELETE FROM ledger_entries;
      DELETE FROM ledger_accounts;
      DELETE FROM external_txns;
      DELETE FROM payment_proposals;
    `);
  },
};
