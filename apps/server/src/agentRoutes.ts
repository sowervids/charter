import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AgentConfig } from "@charter/agents";
import type { RosterEntry } from "./server.js";
import type { ServerContext } from "./env.js";

export interface AgentDeps {
  registry: Map<string, AgentConfig>;
  root: string;
  /** Re-read company/agents/* into the shared registry Map (hot reload). */
  reload: () => void;
}

/** Live roster: the founder + every agent in the current registry. */
export function computeRoster(
  ctx: ServerContext,
  registry: Map<string, AgentConfig>,
): RosterEntry[] {
  const paused = new Set(
    (
      ctx.db
        .prepare(
          "SELECT agent_id FROM agent_state WHERE company_id = ? AND paused = 1",
        )
        .all(ctx.company.id) as Array<{ agent_id: string }>
    ).map((r) => r.agent_id),
  );
  return [
    { id: "founder", name: "Founder", role: "Founder", kind: "human" },
    ...[...registry.values()].map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      kind: "agent" as const,
      paused: paused.has(a.id),
    })),
  ];
}

const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const DEFAULT_POLICY = {
  version: 1,
  rules: {
    deny: ["Bash(rm *)", "Bash(sudo *)", "Bash(curl *)", "Bash(wget *)"],
    approval_required: [],
    allow: ["Read", "Glob", "Grep"],
  },
};

export function registerAgents(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: AgentDeps,
): void {
  const { registry, root, reload } = deps;

  function budget(agentId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const row = ctx.db
      .prepare(
        `SELECT
           COUNT(*) AS runs_total,
           SUM(CASE WHEN queued_at >= ? AND status != 'queued' THEN 1 ELSE 0 END) AS runs_today,
           COALESCE(SUM(cost_usd), 0) AS cost_usd,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM agent_runs WHERE company_id = ? AND agent_id = ?`,
      )
      .get(today, ctx.company.id, agentId) as {
      runs_total: number;
      runs_today: number;
      cost_usd: number;
      failed: number;
    };
    return row;
  }

  function isPaused(agentId: string): boolean {
    const row = ctx.db
      .prepare(
        "SELECT paused FROM agent_state WHERE company_id = ? AND agent_id = ?",
      )
      .get(ctx.company.id, agentId) as { paused: number } | undefined;
    return row?.paused === 1;
  }

  app.get("/api/agents", () => ({
    agents: [...registry.values()].map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      model: a.model,
      paused: isPaused(a.id),
      ...budget(a.id),
    })),
  }));

  app.get("/api/agents/:id", (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = registry.get(id);
    if (agent === undefined) return reply.code(404).send({ error: "no such agent" });
    const dir = join(root, "company", "agents", id);
    const policyPath = join(dir, "policy.json");
    const policy = existsSync(policyPath)
      ? (JSON.parse(readFileSync(policyPath, "utf8")) as unknown)
      : null;
    const activity = ctx.log
      .read({ stream: `agent:${id}`, companyId: ctx.company.id, limit: 200 })
      .slice(-60)
      .reverse();
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        model: agent.model,
        max_turns: agent.max_turns,
        daily_runs: agent.daily_runs,
        paused: isPaused(id),
      },
      charter: agent.charter,
      policy,
      budget: budget(id),
      activity,
    };
  });

  const setPaused = (id: string, paused: boolean, reply: import("fastify").FastifyReply) => {
    if (!registry.has(id)) return reply.code(404).send({ error: "no such agent" });
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: `agent:${id}`,
      type: paused ? "agent.paused" : "agent.resumed",
      actor: { kind: "human", id: "founder" },
      payload: { agent_id: id },
    });
    return { event };
  };

  app.post("/api/agents/:id/pause", (request, reply) =>
    setPaused((request.params as { id: string }).id, true, reply),
  );
  app.post("/api/agents/:id/resume", (request, reply) =>
    setPaused((request.params as { id: string }).id, false, reply),
  );

  // Hire: write the agent's files, hot-reload the shared registry, journal it.
  app.post("/api/agents", (request, reply) => {
    const body = request.body as {
      id?: unknown;
      name?: unknown;
      role?: unknown;
      charter?: unknown;
      model?: unknown;
    };
    if (
      typeof body.id !== "string" ||
      !AGENT_ID_RE.test(body.id) ||
      typeof body.name !== "string" ||
      typeof body.role !== "string" ||
      typeof body.charter !== "string" ||
      body.charter.trim().length === 0
    ) {
      return reply
        .code(400)
        .send({ error: "id (slug), name, role, charter required" });
    }
    if (registry.has(body.id)) {
      return reply.code(409).send({ error: `@${body.id} already exists` });
    }
    const model = typeof body.model === "string" ? body.model : "sonnet";
    const dir = join(root, "company", "agents", body.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "agent.json"),
      JSON.stringify(
        {
          name: body.name,
          role: body.role,
          model,
          max_turns: 12,
          daily_runs: 20,
          max_wall_ms: 300000,
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(join(dir, "charter.md"), `${body.charter.trim()}\n`);
    writeFileSync(join(dir, "policy.json"), JSON.stringify(DEFAULT_POLICY, null, 2) + "\n");
    reload();

    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: `agent:${body.id}`,
      type: "agent.hired",
      actor: { kind: "human", id: "founder" },
      payload: { agent_id: body.id, name: body.name, role: body.role, model },
    });
    return { event, agent_id: body.id };
  });
}
