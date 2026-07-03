import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { channelStream, newRunId, type CommittedEvent } from "@charter/schema";
import type { Db, EventLog } from "@charter/core";
import { Governor } from "./governor.js";
import { buildPrompt } from "./prompt.js";
import { extractMentions } from "./registry.js";
import type { AgentConfig, AgentRuntime } from "./types.js";

const CONTEXT_EVENTS = 30;
const PUMP_MS = 250;

export interface OrchestratorOptions {
  db: Db;
  log: EventLog;
  companyId: string;
  companyName: string;
  registry: Map<string, AgentConfig>;
  runtime: AgentRuntime;
  agentsHome: string;
  concurrency?: number;
}

interface RunRow {
  run_id: string;
  agent_id: string;
  channel_id: string;
  trigger_event_id: string;
  status: string;
  session_id: string | null;
}

export class Orchestrator {
  private readonly governor: Governor;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: OrchestratorOptions) {
    this.governor = new Governor({ concurrency: opts.concurrency ?? 1 });
  }

  start(): void {
    this.recover();
    this.unsubscribe = this.opts.log.onCommit((event) => {
      this.maybeTrigger(event);
    });
    this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
    this.pumpTimer.unref();
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.pumpTimer) clearInterval(this.pumpTimer);
  }

  status(): ReturnType<Governor["status"]> {
    return this.governor.status();
  }

  /** Mentions by HUMANS trigger runs (agent-originated mentions wait for the
   *  hop-counted delegation model in a later phase — no loops by construction). */
  private maybeTrigger(event: CommittedEvent): void {
    if (event.type !== "message.posted") return;
    if (event.actor.kind !== "human") return;
    const channelId = event.stream.startsWith("channel:")
      ? event.stream.slice(8)
      : null;
    if (channelId === null) return;
    const body = (event.payload as { body: string }).body;
    for (const agentId of extractMentions(body, this.opts.registry)) {
      this.createRun(agentId, channelId, event.id, "p0");
    }
  }

  createRun(
    agentId: string,
    channelId: string,
    triggerEventId: string,
    priority: "p0" | "p1" | "p2",
  ): string {
    const runId = newRunId();
    this.opts.log.append({
      company_id: this.opts.companyId,
      stream: `agent:${agentId}`,
      type: "agent.run_queued",
      actor: { kind: "system", id: "charterd" },
      payload: {
        run_id: runId,
        agent_id: agentId,
        channel_id: channelId,
        trigger_event_id: triggerEventId,
        priority,
      },
      refs: [{ rel: "trigger", id: triggerEventId }],
    });
    this.governor.enqueue({
      runId,
      agentId,
      priority,
      enqueuedAt: Date.now(),
    });
    return runId;
  }

  /** Daemon restart: anything queued/running is journaled as interrupted and
   *  re-queued fresh. Nothing is ever only in memory. */
  private recover(): void {
    const stale = this.opts.db
      .prepare(
        `SELECT run_id, agent_id, channel_id, trigger_event_id, status, session_id
           FROM agent_runs
          WHERE company_id = ? AND status IN ('queued', 'running')`,
      )
      .all(this.opts.companyId) as RunRow[];
    for (const run of stale) {
      this.opts.log.append({
        company_id: this.opts.companyId,
        stream: `agent:${run.agent_id}`,
        type: "agent.run_interrupted",
        actor: { kind: "system", id: "charterd" },
        payload: { run_id: run.run_id },
      });
      this.createRun(
        run.agent_id,
        run.channel_id,
        run.trigger_event_id,
        "p0",
      );
    }
  }

  pump(): void {
    for (;;) {
      const entry = this.governor.next();
      if (entry === null) return;
      void this.execute(entry.runId).catch(() => {
        // execute() journals its own failures; this catch is the backstop
        // so an unexpected throw can't kill the pump loop.
      });
    }
  }

  private runRow(runId: string): RunRow | undefined {
    return this.opts.db
      .prepare(
        `SELECT run_id, agent_id, channel_id, trigger_event_id, status, session_id
           FROM agent_runs WHERE run_id = ?`,
      )
      .get(runId) as RunRow | undefined;
  }

  private async execute(runId: string): Promise<void> {
    const { opts } = this;
    let rateLimited = false;
    try {
      const run = this.runRow(runId);
      if (run === undefined || run.status !== "queued") return;
      const agent = opts.registry.get(run.agent_id);
      if (agent === undefined) {
        this.fail(runId, run.agent_id, "runtime_error", "agent not in registry");
        return;
      }

      // Daily cap — the per-agent slice of the shared Max quota.
      const today = new Date().toISOString().slice(0, 10);
      const { n } = opts.db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_runs
            WHERE company_id = ? AND agent_id = ? AND status != 'queued'
              AND queued_at >= ?`,
        )
        .get(opts.companyId, run.agent_id, today) as { n: number };
      if (n >= agent.daily_runs) {
        this.fail(runId, run.agent_id, "rate_limit", "daily run cap reached");
        return;
      }

      // Workspace: stable per-agent cwd — this is what scopes --resume.
      const cwd = join(opts.agentsHome, agent.id);
      mkdirSync(cwd, { recursive: true });
      writeFileSync(join(cwd, "CLAUDE.md"), agent.charter, "utf8");

      // Session: resume the last session for this agent+channel, else mint.
      const prior = opts.db
        .prepare(
          `SELECT session_id FROM agent_runs
            WHERE company_id = ? AND agent_id = ? AND channel_id = ?
              AND status = 'completed' AND session_id IS NOT NULL
            ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(opts.companyId, agent.id, run.channel_id) as
        | { session_id: string }
        | undefined;
      const sessionId = prior?.session_id ?? randomUUID();
      const resume = prior !== undefined;

      const trigger = opts.log.getById(run.trigger_event_id) ?? undefined;
      const timeline = opts.log.tail({
        stream: channelStream(run.channel_id),
        companyId: opts.companyId,
        limit: CONTEXT_EVENTS,
      });
      if (trigger === undefined) {
        this.fail(runId, agent.id, "runtime_error", "trigger event missing");
        return;
      }

      const job = {
        runId,
        agent,
        channelId: run.channel_id,
        triggerEventId: run.trigger_event_id,
        prompt: buildPrompt({
          agent,
          companyName: opts.companyName,
          channelId: run.channel_id,
          timeline,
          trigger,
        }),
        cwd,
        sessionId,
        resume,
      };

      const startedAt = Date.now();
      let terminal = false;
      for await (const event of opts.runtime.invoke(job)) {
        if (event.kind === "started") {
          opts.log.append({
            company_id: opts.companyId,
            stream: `agent:${agent.id}`,
            type: "agent.run_started",
            actor: { kind: "system", id: "charterd" },
            payload: {
              run_id: runId,
              agent_id: agent.id,
              channel_id: run.channel_id,
              session_id: sessionId,
              model: event.model,
              resumed: resume,
            },
          });
        } else if (event.kind === "step") {
          opts.log.append({
            company_id: opts.companyId,
            stream: `agent:${agent.id}`,
            type: "agent.run_step",
            actor: { kind: "agent", id: agent.id, invocation_id: runId },
            payload: {
              run_id: runId,
              kind: event.step,
              ...(event.name !== undefined ? { name: event.name } : {}),
              ...(event.preview !== undefined ? { preview: event.preview } : {}),
            },
            visibility: "agent_trace",
          });
        } else if (event.kind === "result") {
          terminal = true;
          if (event.ok) {
            const reply = opts.log.append({
              company_id: opts.companyId,
              stream: channelStream(run.channel_id),
              type: "message.posted",
              actor: {
                kind: "agent",
                id: agent.id,
                session_id: sessionId,
                invocation_id: runId,
                on_behalf_of: trigger.actor.id,
              },
              payload: { body: event.text || "(empty reply)" },
              refs: [{ rel: "reply_to", id: trigger.id }],
            });
            opts.log.append({
              company_id: opts.companyId,
              stream: `agent:${agent.id}`,
              type: "agent.run_completed",
              actor: { kind: "system", id: "charterd" },
              payload: {
                run_id: runId,
                num_turns: event.numTurns,
                duration_ms: Date.now() - startedAt,
                reply_event_id: reply.id,
                ...(event.usage ? { usage: event.usage } : {}),
              },
            });
          } else {
            rateLimited = event.reason === "rate_limit";
            this.fail(runId, agent.id, event.reason, event.detail);
          }
        }
      }
      if (!terminal) {
        this.fail(runId, agent.id, "runtime_error", "runtime ended without result");
      }
    } catch (error) {
      const run = this.runRow(runId);
      this.fail(
        runId,
        run?.agent_id ?? "unknown",
        "runtime_error",
        String(error).slice(0, 500),
      );
    } finally {
      this.governor.finished({ rateLimited });
      if (rateLimited) {
        // Queue, never drop: the run failed as rate_limit; requeue a fresh
        // run for the same trigger once backoff clears.
        const run = this.runRow(runId);
        if (run) {
          this.createRun(
            run.agent_id,
            run.channel_id,
            run.trigger_event_id,
            "p0",
          );
        }
      }
    }
  }

  private fail(
    runId: string,
    agentId: string,
    reason: "rate_limit" | "timeout" | "spawn_error" | "runtime_error",
    detail?: string,
  ): void {
    this.opts.log.append({
      company_id: this.opts.companyId,
      stream: `agent:${agentId}`,
      type: "agent.run_failed",
      actor: { kind: "system", id: "charterd" },
      payload: {
        run_id: runId,
        reason,
        ...(detail !== undefined ? { detail: detail.slice(0, 2000) } : {}),
      },
    });
  }
}
