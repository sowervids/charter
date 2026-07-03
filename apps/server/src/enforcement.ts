import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { newApprovalId } from "@charter/schema";
import {
  PolicyDoc,
  actionHash,
  describeAction,
  evaluate,
  type Action,
} from "@charter/policy";
import type { ServerContext } from "./env.js";

const APPROVAL_TTL_MS = 72 * 60 * 60_000;

interface HookBody {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

function hookResponse(
  decision: "allow" | "deny",
  reason: string,
): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export function loadPolicy(root: string, agentId: string): PolicyDoc | null {
  const path = join(root, "company", "agents", agentId, "policy.json");
  if (!existsSync(path)) return null;
  return PolicyDoc.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * The policy engine's reach into local tools. Claude Code POSTs every
 * Bash/Edit/Write here before executing (PreToolUse HTTP hook).
 *
 * Fail-open for UNKNOWN sessions (the founder's own interactive claude runs
 * must never be broken by charterd); fail-CLOSED for known agent sessions.
 */
export function registerEnforcement(
  app: FastifyInstance,
  ctx: ServerContext,
): void {
  app.post("/hooks/pretooluse", (request) => {
    const query = request.query as { token?: string };
    if (query.token !== ctx.token) {
      return hookResponse("deny", "bad hook token");
    }
    const body = request.body as HookBody;
    const sessionId = body.session_id;
    const tool = body.tool_name;
    if (typeof sessionId !== "string" || typeof tool !== "string") {
      return hookResponse("allow", "malformed hook payload — not an agent session");
    }

    const run = ctx.db
      .prepare(
        `SELECT run_id, agent_id FROM agent_runs
          WHERE session_id = ? AND status = 'running'
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(sessionId) as { run_id: string; agent_id: string } | undefined;
    if (run === undefined) {
      return hookResponse("allow", "unknown session — not a charterd agent");
    }

    const action: Action = { tool, input: body.tool_input ?? {} };
    const policy = loadPolicy(ctx.root, run.agent_id);
    if (policy === null) {
      return hookResponse(
        "deny",
        `agent @${run.agent_id} has no policy.json — default deny`,
      );
    }

    // A granted, unconsumed approval for EXACTLY this payload lets it pass
    // once. Hash-scoped, single-use.
    const hash = actionHash(action);
    const granted = ctx.db
      .prepare(
        `SELECT approval_id FROM approvals
          WHERE company_id = ? AND agent_id = ? AND payload_hash = ?
            AND status = 'allowed' AND expires_at > ?
          ORDER BY requested_at LIMIT 1`,
      )
      .get(ctx.company.id, run.agent_id, hash, new Date().toISOString()) as
      | { approval_id: string }
      | undefined;
    if (granted !== undefined) {
      ctx.log.append({
        company_id: ctx.company.id,
        stream: `approval:${granted.approval_id}`,
        type: "approval.consumed",
        actor: { kind: "system", id: "charterd" },
        payload: { approval_id: granted.approval_id },
      });
      return hookResponse(
        "allow",
        `approved by founder (${granted.approval_id}, single-use)`,
      );
    }

    const verdict = evaluate(policy, action);
    if (verdict.decision === "allow") {
      return hookResponse("allow", `policy: ${verdict.rule ?? "allow"}`);
    }
    if (verdict.decision === "deny") {
      return hookResponse(
        "deny",
        `blocked by policy${verdict.rule ? ` rule "${verdict.rule}"` : " (default deny)"}`,
      );
    }

    // HOLD: journal the approval request; the agent is told to stand down.
    // Approval resolution re-invokes the session (orchestrator).
    const pending = ctx.db
      .prepare(
        `SELECT approval_id FROM approvals
          WHERE run_id = ? AND payload_hash = ? AND status = 'pending'`,
      )
      .get(run.run_id, hash) as { approval_id: string } | undefined;
    const approvalId = pending?.approval_id ?? newApprovalId();
    if (pending === undefined) {
      ctx.log.append({
        company_id: ctx.company.id,
        stream: `approval:${approvalId}`,
        type: "approval.requested",
        actor: { kind: "agent", id: run.agent_id, invocation_id: run.run_id },
        payload: {
          approval_id: approvalId,
          run_id: run.run_id,
          agent_id: run.agent_id,
          tool,
          input_summary: describeAction(action),
          payload_hash: hash,
          rule: verdict.rule ?? "approval_required",
          expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
        },
      });
    }
    return hookResponse(
      "deny",
      `HELD FOR APPROVAL (${approvalId}): "${describeAction(action)}" needs founder sign-off. ` +
        `Do NOT retry it. Finish your turn now, summarizing progress and noting the held action — ` +
        `you will be resumed automatically when the founder decides.`,
    );
  });

  app.get("/api/approvals", (request) => {
    const query = request.query as { status?: string };
    const status = query.status ?? "pending";
    const approvals = ctx.db
      .prepare(
        `SELECT * FROM approvals WHERE company_id = ? AND status = ?
          ORDER BY requested_at DESC LIMIT 100`,
      )
      .all(ctx.company.id, status);
    return { approvals };
  });

  app.post("/api/approvals/:id/resolve", (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { decision?: unknown; note?: unknown };
    if (body.decision !== "allow" && body.decision !== "deny") {
      return reply.code(400).send({ error: "decision must be allow|deny" });
    }
    const row = ctx.db
      .prepare("SELECT status FROM approvals WHERE approval_id = ?")
      .get(id) as { status: string } | undefined;
    if (row === undefined) return reply.code(404).send({ error: "not found" });
    if (row.status !== "pending") {
      return reply.code(409).send({ error: `already ${row.status}` });
    }
    const event = ctx.log.append({
      company_id: ctx.company.id,
      stream: `approval:${id}`,
      type: "approval.resolved",
      actor: { kind: "human", id: "founder" },
      payload: {
        approval_id: id,
        decision: body.decision,
        ...(typeof body.note === "string" && body.note.length > 0
          ? { note: body.note }
          : {}),
      },
    });
    return { event };
  });

  /** The "why did it do this?" query: every event of one run's causal chain. */
  app.get("/api/runs/:id/trace", (request, reply) => {
    const { id } = request.params as { id: string };
    const run = ctx.db
      .prepare("SELECT * FROM agent_runs WHERE run_id = ?")
      .get(id);
    if (run === undefined) return reply.code(404).send({ error: "not found" });
    const journal = ctx.log
      .read({ afterSeq: 0, companyId: ctx.company.id, limit: 100_000 })
      .filter((e) => {
        const p = e.payload as { run_id?: string };
        return (
          p.run_id === id ||
          e.actor.invocation_id === id ||
          (e.type.startsWith("approval.") &&
            (ctx.db
              .prepare(
                "SELECT 1 FROM approvals WHERE approval_id = ? AND run_id = ?",
              )
              .get((e.payload as { approval_id?: string }).approval_id ?? "", id) !==
              undefined))
        );
      });
    const trigger =
      journal.length > 0
        ? ctx.log.getById(
            (journal.find((e) => e.type === "agent.run_queued")?.payload as
              | { trigger_event_id?: string }
              | undefined)?.trigger_event_id ?? "",
          )
        : null;
    return { run, trigger, events: journal };
  });
}
