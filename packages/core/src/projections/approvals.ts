import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const approvalsProjector: Projector = {
  name: "approvals",
  version: 1,
  types: ["approval.requested", "approval.resolved", "approval.consumed"],
  apply(db, event) {
    switch (event.type) {
      case "approval.requested": {
        const p = event.payload as EventPayload<"approval.requested">;
        db.prepare(
          `INSERT INTO approvals (approval_id, company_id, run_id, agent_id,
             tool, input_summary, payload_hash, rule, status, expires_at,
             requested_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
           ON CONFLICT (approval_id) DO NOTHING`,
        ).run(
          p.approval_id,
          event.company_id,
          p.run_id,
          p.agent_id,
          p.tool,
          p.input_summary,
          p.payload_hash,
          p.rule,
          p.expires_at,
          event.created_at,
          event.created_at,
        );
        break;
      }
      case "approval.resolved": {
        const p = event.payload as EventPayload<"approval.resolved">;
        db.prepare(
          `UPDATE approvals SET status = ?, note = ?, updated_at = ?
           WHERE approval_id = ? AND status = 'pending'`,
        ).run(
          p.decision === "allow" ? "allowed" : "denied",
          p.note ?? null,
          event.created_at,
          p.approval_id,
        );
        break;
      }
      case "approval.consumed": {
        const p = event.payload as EventPayload<"approval.consumed">;
        db.prepare(
          `UPDATE approvals SET status = 'consumed', updated_at = ?
           WHERE approval_id = ? AND status = 'allowed'`,
        ).run(event.created_at, p.approval_id);
        break;
      }
    }
  },
  truncate(db) {
    db.exec("DELETE FROM approvals");
  },
};
