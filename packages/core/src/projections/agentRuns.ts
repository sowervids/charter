import type { EventPayload } from "@charter/schema";
import type { Projector } from "./types.js";

export const agentRunsProjector: Projector = {
  name: "agent_runs",
  version: 1,
  types: [
    "agent.run_queued",
    "agent.run_started",
    "agent.run_completed",
    "agent.run_failed",
    "agent.run_interrupted",
  ],
  apply(db, event) {
    switch (event.type) {
      case "agent.run_queued": {
        const p = event.payload as EventPayload<"agent.run_queued">;
        db.prepare(
          `INSERT INTO agent_runs
             (run_id, company_id, agent_id, channel_id, trigger_event_id,
              priority, status, queued_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
           ON CONFLICT (run_id) DO NOTHING`,
        ).run(
          p.run_id,
          event.company_id,
          p.agent_id,
          p.channel_id,
          p.trigger_event_id,
          p.priority,
          event.created_at,
          event.created_at,
        );
        break;
      }
      case "agent.run_started": {
        const p = event.payload as EventPayload<"agent.run_started">;
        db.prepare(
          `UPDATE agent_runs SET status = 'running', session_id = ?,
             model = ?, updated_at = ? WHERE run_id = ?`,
        ).run(p.session_id, p.model, event.created_at, p.run_id);
        break;
      }
      case "agent.run_completed": {
        const p = event.payload as EventPayload<"agent.run_completed">;
        db.prepare(
          `UPDATE agent_runs SET status = 'completed', duration_ms = ?,
             num_turns = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?,
             updated_at = ? WHERE run_id = ?`,
        ).run(
          p.duration_ms,
          p.num_turns,
          p.usage?.input_tokens ?? null,
          p.usage?.output_tokens ?? null,
          p.usage?.cost_usd ?? null,
          event.created_at,
          p.run_id,
        );
        break;
      }
      case "agent.run_failed": {
        const p = event.payload as EventPayload<"agent.run_failed">;
        db.prepare(
          `UPDATE agent_runs SET status = 'failed', reason = ?,
             updated_at = ? WHERE run_id = ?`,
        ).run(p.reason, event.created_at, p.run_id);
        break;
      }
      case "agent.run_interrupted": {
        const p = event.payload as EventPayload<"agent.run_interrupted">;
        db.prepare(
          `UPDATE agent_runs SET status = 'interrupted', updated_at = ?
           WHERE run_id = ?`,
        ).run(event.created_at, p.run_id);
        break;
      }
    }
  },
  truncate(db) {
    db.exec("DELETE FROM agent_runs");
  },
};
