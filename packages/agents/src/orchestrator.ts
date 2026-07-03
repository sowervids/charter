import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { channelStream, newRunId, type CommittedEvent } from "@charter/schema";
import type { Db, EventLog } from "@charter/core";
import { Governor } from "./governor.js";
import { buildPrompt } from "./prompt.js";
import { extractMentions } from "./registry.js";
import { writeHookSettings } from "./hooks.js";
import {
  buildTaskPrompt,
  branchName,
  diffStat,
  extractPrUrl,
  prepareWorktree,
  taskAllowedTools,
  type TaskRow,
} from "./taskwork.js";
import type { AgentConfig, AgentJob, AgentRuntime } from "./types.js";

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
  /** Repo root — required for task runs (worktrees live beside it). */
  repoRoot?: string;
  /** charterd's PreToolUse hook endpoint (with token). When set, every
   *  workspace gets the hook — the policy engine's reach into local tools. */
  hookUrl?: string;
  concurrency?: number;
}

interface RunRow {
  run_id: string;
  agent_id: string;
  channel_id: string;
  trigger_event_id: string;
  status: string;
  session_id: string | null;
  kind: "chat" | "task";
  task_id: string | null;
}

interface PreparedJob {
  job: AgentJob;
  onSuccess: (text: string) => string | undefined;
}

export class Orchestrator {
  private readonly governor: Governor;
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** runId → continuation info (also recoverable from run_queued payloads) */
  private readonly continuations = new Map<string, { of: string; note: string }>();

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

  /** Mentions by HUMANS trigger chat runs; agent-assigned tasks trigger task
   *  runs. Agent-originated mentions wait for the hop-counted delegation
   *  model in a later phase — no loops by construction. */
  private maybeTrigger(event: CommittedEvent): void {
    if (event.type === "message.posted" && event.actor.kind === "human") {
      const channelId = event.stream.startsWith("channel:")
        ? event.stream.slice(8)
        : null;
      if (channelId === null) return;
      const body = (event.payload as { body: string }).body;
      for (const agentId of extractMentions(body, this.opts.registry)) {
        this.createRun(agentId, channelId, event.id, "p0");
      }
      return;
    }
    if (event.type === "task.created" || event.type === "task.assigned") {
      const p = event.payload as {
        task_id: string;
        assignee_id?: string;
        assignee_kind?: string;
      };
      if (
        p.assignee_kind === "agent" &&
        p.assignee_id !== undefined &&
        this.opts.registry.has(p.assignee_id)
      ) {
        this.createRun(p.assignee_id, "devlog", event.id, "p1", {
          kind: "task",
          taskId: p.task_id,
        });
      }
      return;
    }
    // Approval resolved → resume the held run's session so it can retry
    // (approved) or adjust (denied). This is the "park costs zero prompts,
    // resume on decision" model.
    if (event.type === "approval.resolved") {
      const p = event.payload as {
        approval_id: string;
        decision: "allow" | "deny";
        note?: string;
      };
      const approval = this.opts.db
        .prepare("SELECT run_id FROM approvals WHERE approval_id = ?")
        .get(p.approval_id) as { run_id: string } | undefined;
      if (approval === undefined) return;
      const original = this.runRow(approval.run_id);
      if (original === undefined) return;
      const note =
        p.decision === "allow"
          ? `Approval ${p.approval_id} was GRANTED${p.note ? ` ("${p.note}")` : ""}. Retry the exact held action now, then continue the work to completion.`
          : `Approval ${p.approval_id} was DENIED${p.note ? ` ("${p.note}")` : ""}. Do not retry that action. Adjust your approach and continue, or finish with what you have.`;
      this.createRun(
        original.agent_id,
        original.channel_id,
        event.id,
        "p0",
        {
          kind: original.kind,
          ...(original.task_id !== null ? { taskId: original.task_id } : {}),
          continuationOf: original.run_id,
          note,
        },
      );
    }
  }

  createRun(
    agentId: string,
    channelId: string,
    triggerEventId: string,
    priority: "p0" | "p1" | "p2",
    options?: {
      kind: "chat" | "task";
      taskId?: string;
      continuationOf?: string;
      note?: string;
    },
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
        ...(options?.kind !== undefined ? { kind: options.kind } : {}),
        ...(options?.taskId !== undefined ? { task_id: options.taskId } : {}),
        ...(options?.continuationOf !== undefined
          ? { continuation_of: options.continuationOf }
          : {}),
        ...(options?.note !== undefined ? { note: options.note } : {}),
      },
      refs: [{ rel: "trigger", id: triggerEventId }],
    });
    if (options?.continuationOf !== undefined) {
      this.continuations.set(runId, {
        of: options.continuationOf,
        note: options.note ?? "Continue.",
      });
    }
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
        `SELECT run_id, agent_id, channel_id, trigger_event_id, status,
                session_id, kind, task_id
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
      this.createRun(run.agent_id, run.channel_id, run.trigger_event_id, "p0", {
        kind: run.kind,
        ...(run.task_id !== null ? { taskId: run.task_id } : {}),
      });
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
        `SELECT run_id, agent_id, channel_id, trigger_event_id, status,
                session_id, kind, task_id
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

      const continuation = this.continuations.get(runId);
      this.continuations.delete(runId);
      const prep = continuation
        ? this.prepareContinuationJob(run, agent, continuation)
        : run.kind === "task"
          ? this.prepareTaskJob(run, agent)
          : this.prepareChatJob(run, agent);
      if (prep === null) return; // failure already journaled
      const { job, onSuccess } = prep;

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
              session_id: job.sessionId,
              model: event.model,
              resumed: job.resume,
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
            const replyEventId = onSuccess(event.text);
            opts.log.append({
              company_id: opts.companyId,
              stream: `agent:${agent.id}`,
              type: "agent.run_completed",
              actor: { kind: "system", id: "charterd" },
              payload: {
                run_id: runId,
                num_turns: event.numTurns,
                duration_ms: Date.now() - startedAt,
                ...(replyEventId !== undefined
                  ? { reply_event_id: replyEventId }
                  : {}),
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

  /** Resume a held run's session after its approval resolved. */
  private prepareContinuationJob(
    run: RunRow,
    agent: AgentConfig,
    continuation: { of: string; note: string },
  ): PreparedJob | null {
    const { opts } = this;
    const original = this.runRow(continuation.of);
    if (original === undefined || original.session_id === null) {
      this.fail(run.run_id, agent.id, "runtime_error", "continuation target lost");
      return null;
    }

    if (original.kind === "task" && original.task_id !== null) {
      const task = opts.db
        .prepare(
          `SELECT task_id, task_num, title, body, status, assignee_id
             FROM tasks WHERE task_id = ?`,
        )
        .get(original.task_id) as TaskRow | undefined;
      if (task === undefined || opts.repoRoot === undefined) {
        this.fail(run.run_id, agent.id, "runtime_error", "task context lost");
        return null;
      }
      const worktree = prepareWorktree(opts.repoRoot, agent, task.task_num);
      if (opts.hookUrl !== undefined) {
        writeHookSettings({ dir: worktree, hookUrl: opts.hookUrl, local: true });
      }
      return {
        job: {
          runId: run.run_id,
          agent,
          channelId: run.channel_id,
          triggerEventId: run.trigger_event_id,
          prompt: continuation.note,
          cwd: worktree,
          sessionId: original.session_id,
          resume: true,
          allowedTools: taskAllowedTools(),
          maxWallMs: Math.max(agent.max_wall_ms, 20 * 60_000),
        },
        onSuccess: this.taskOnSuccess(task, agent, run, worktree, original.session_id),
      };
    }

    const cwd = join(opts.agentsHome, agent.id);
    mkdirSync(cwd, { recursive: true });
    return {
      job: {
        runId: run.run_id,
        agent,
        channelId: run.channel_id,
        triggerEventId: run.trigger_event_id,
        prompt: continuation.note,
        cwd,
        sessionId: original.session_id,
        resume: true,
      },
      onSuccess: (text) => {
        const reply = opts.log.append({
          company_id: opts.companyId,
          stream: channelStream(run.channel_id),
          type: "message.posted",
          actor: {
            kind: "agent",
            id: agent.id,
            session_id: original.session_id ?? undefined,
            invocation_id: run.run_id,
          },
          payload: { body: text || "(empty reply)" },
        });
        return reply.id;
      },
    };
  }

  private prepareChatJob(run: RunRow, agent: AgentConfig): PreparedJob | null {
    const { opts } = this;
    const cwd = join(opts.agentsHome, agent.id);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "CLAUDE.md"), agent.charter, "utf8");
    if (opts.hookUrl !== undefined) {
      writeHookSettings({ dir: cwd, hookUrl: opts.hookUrl, local: false });
    }

    const prior = opts.db
      .prepare(
        `SELECT session_id FROM agent_runs
          WHERE company_id = ? AND agent_id = ? AND channel_id = ?
            AND kind = 'chat' AND status = 'completed' AND session_id IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(opts.companyId, agent.id, run.channel_id) as
      | { session_id: string }
      | undefined;
    const sessionId = prior?.session_id ?? randomUUID();

    const trigger = opts.log.getById(run.trigger_event_id);
    if (trigger === null) {
      this.fail(run.run_id, agent.id, "runtime_error", "trigger event missing");
      return null;
    }
    const timeline = opts.log.tail({
      stream: channelStream(run.channel_id),
      companyId: opts.companyId,
      limit: CONTEXT_EVENTS,
    });

    return {
      job: {
        runId: run.run_id,
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
        resume: prior !== undefined,
      },
      onSuccess: (text) => {
        const reply = opts.log.append({
          company_id: opts.companyId,
          stream: channelStream(run.channel_id),
          type: "message.posted",
          actor: {
            kind: "agent",
            id: agent.id,
            session_id: sessionId,
            invocation_id: run.run_id,
            on_behalf_of: trigger.actor.id,
          },
          payload: { body: text || "(empty reply)" },
          refs: [{ rel: "reply_to", id: trigger.id }],
        });
        return reply.id;
      },
    };
  }

  private prepareTaskJob(run: RunRow, agent: AgentConfig): PreparedJob | null {
    const { opts } = this;
    if (opts.repoRoot === undefined) {
      this.fail(run.run_id, agent.id, "runtime_error", "no repoRoot configured");
      return null;
    }
    if (run.task_id === null) {
      this.fail(run.run_id, agent.id, "runtime_error", "task run without task_id");
      return null;
    }
    const task = opts.db
      .prepare(
        `SELECT task_id, task_num, title, body, status, assignee_id
           FROM tasks WHERE task_id = ? AND company_id = ?`,
      )
      .get(run.task_id, opts.companyId) as TaskRow | undefined;
    if (task === undefined) {
      this.fail(run.run_id, agent.id, "runtime_error", "task not found");
      return null;
    }

    let worktree: string;
    try {
      worktree = prepareWorktree(opts.repoRoot, agent, task.task_num);
    } catch (error) {
      this.fail(run.run_id, agent.id, "spawn_error", `worktree: ${String(error)}`);
      return null;
    }
    if (opts.hookUrl !== undefined) {
      writeHookSettings({ dir: worktree, hookUrl: opts.hookUrl, local: true });
    }
    const branch = branchName(agent, task.task_num);
    const taskStream = `task:${task.task_id}`;
    const sessionId = randomUUID();

    this.opts.log.append({
      company_id: opts.companyId,
      stream: taskStream,
      type: "task.status_changed",
      actor: { kind: "system", id: "charterd" },
      payload: { task_id: task.task_id, status: "doing" },
    });

    return {
      job: {
        runId: run.run_id,
        agent,
        channelId: run.channel_id,
        triggerEventId: run.trigger_event_id,
        prompt: buildTaskPrompt({
          agent,
          companyName: opts.companyName,
          task,
          branch,
        }),
        cwd: worktree,
        sessionId,
        resume: false,
        allowedTools: taskAllowedTools(),
        maxWallMs: Math.max(agent.max_wall_ms, 20 * 60_000),
      },
      onSuccess: this.taskOnSuccess(task, agent, run, worktree, sessionId),
    };
  }

  /** Shared task-run epilogue: journal the report, PR events, status. */
  private taskOnSuccess(
    task: TaskRow,
    agent: AgentConfig,
    run: RunRow,
    worktree: string,
    sessionId: string,
  ): (text: string) => string {
    const { opts } = this;
    const taskStream = `task:${task.task_id}`;
    const branch = branchName(agent, task.task_num);
    return (text) => {
      const comment = opts.log.append({
        company_id: opts.companyId,
        stream: taskStream,
        type: "message.posted",
        actor: {
          kind: "agent",
          id: agent.id,
          session_id: sessionId,
          invocation_id: run.run_id,
        },
        payload: { body: text || "(no output)" },
      });
      const pr = extractPrUrl(text);
      if (pr !== null) {
        opts.log.append({
          company_id: opts.companyId,
          stream: taskStream,
          type: "task.pr_opened",
          actor: { kind: "agent", id: agent.id, invocation_id: run.run_id },
          payload: {
            task_id: task.task_id,
            pr_number: pr.number,
            pr_url: pr.url,
            branch,
          },
        });
        let oversized = false;
        try {
          const stat = diffStat(worktree);
          oversized = stat.insertions + stat.deletions > 200;
        } catch {
          /* worktree gone — skip the advisory check */
        }
        if (oversized) {
          opts.log.append({
            company_id: opts.companyId,
            stream: taskStream,
            type: "message.posted",
            actor: { kind: "system", id: "charterd" },
            payload: {
              body: "⚠ Diff exceeds the ~200-line guardrail. Review extra carefully or ask for a split.",
            },
          });
        }
      }
      const held = opts.db
        .prepare(
          `SELECT COUNT(*) AS n FROM approvals
            WHERE run_id = ? AND status = 'pending'`,
        )
        .get(run.run_id) as { n: number };
      opts.log.append({
        company_id: opts.companyId,
        stream: taskStream,
        type: "task.status_changed",
        actor: { kind: "system", id: "charterd" },
        payload: {
          task_id: task.task_id,
          // Held runs stay `doing` — they resume when the approval resolves.
          status: pr !== null ? "review" : held.n > 0 ? "doing" : "todo",
        },
      });
      return comment.id;
    };
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
