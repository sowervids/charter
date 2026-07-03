import type { Projector } from "./types.js";

export const agentStateProjector: Projector = {
  name: "agent_state",
  version: 1,
  types: ["agent.hired", "agent.paused", "agent.resumed"],
  apply(db, event) {
    const agentId = (event.payload as { agent_id: string }).agent_id;
    const upsert = (paused: number) =>
      db
        .prepare(
          `INSERT INTO agent_state (agent_id, company_id, paused, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (company_id, agent_id)
           DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`,
        )
        .run(agentId, event.company_id, paused, event.created_at);
    switch (event.type) {
      case "agent.hired":
        upsert(0);
        break;
      case "agent.paused":
        upsert(1);
        break;
      case "agent.resumed":
        upsert(0);
        break;
    }
  },
  truncate(db) {
    db.exec("DELETE FROM agent_state");
  },
};
