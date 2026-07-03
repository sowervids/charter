import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newTaskId } from "@charter/schema";
import {
  EventLog,
  ensureProjections,
  migrate,
  openDb,
  type Db,
} from "@charter/core";
import { FakeRuntime } from "../src/runtime-fake.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { AgentConfig } from "../src/types.js";

const COMPANY = "co_test";

function ship(): AgentConfig {
  return {
    id: "ship",
    name: "Ship",
    role: "Engineering",
    model: "sonnet",
    max_turns: 60,
    daily_runs: 30,
    max_wall_ms: 60_000,
    charter: "You build things.",
  };
}

function tempRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "charter-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "test@test");
  git("config", "user.name", "test");
  writeFileSync(join(repo, "README.md"), "hello\n");
  git("add", "-A");
  git("commit", "-m", "init");
  return repo;
}

async function drain(orchestrator: Orchestrator, db: Db): Promise<void> {
  for (let i = 0; i < 200; i++) {
    orchestrator.pump();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const open = db
      .prepare(
        "SELECT COUNT(*) AS n FROM agent_runs WHERE status IN ('queued','running')",
      )
      .get() as { n: number };
    if (open.n === 0) return;
  }
  throw new Error("runs never drained");
}

describe("task runs", () => {
  it("agent-assigned task → worktree run → PR events → review status", async () => {
    const db = openDb(":memory:");
    migrate(db);
    ensureProjections(db);
    const log = new EventLog(db);
    const repoRoot = tempRepo();

    const runtime = new FakeRuntime((job) => [
      { kind: "started", sessionId: job.sessionId, model: "sonnet" },
      { kind: "step", step: "tool_use", name: "Edit" },
      {
        kind: "result",
        ok: true,
        text: "Implemented and checked.\nhttps://github.com/sowervids/charter/pull/42",
        numTurns: 12,
        usage: { cost_usd: 0.03 },
      },
    ]);

    const orchestrator = new Orchestrator({
      db,
      log,
      companyId: COMPANY,
      companyName: "Test Co",
      registry: new Map([["ship", ship()]]),
      runtime,
      agentsHome: mkdtempSync(join(tmpdir(), "charter-agents-")),
      repoRoot,
    });
    orchestrator.start();

    const taskId = newTaskId();
    log.append({
      company_id: COMPANY,
      stream: `task:${taskId}`,
      type: "task.created",
      actor: { kind: "human", id: "founder" },
      payload: {
        task_id: taskId,
        title: "Add a thing",
        body: "Acceptance: the thing exists.",
        assignee_id: "ship",
        assignee_kind: "agent",
      },
    });

    await drain(orchestrator, db);
    orchestrator.stop();

    // The job ran in a WORKTREE, not the live checkout.
    expect(runtime.jobs[0]?.cwd).toContain("charter-worktrees");
    expect(runtime.jobs[0]?.cwd).not.toBe(repoRoot);
    expect(runtime.jobs[0]?.allowedTools).toContain("Bash(gh pr create*)");
    expect(runtime.jobs[0]?.prompt).toContain("CH-1: Add a thing");

    // Task journal: doing → PR opened → review.
    const task = db
      .prepare("SELECT status, pr_number, pr_url, branch FROM tasks WHERE task_id = ?")
      .get(taskId) as {
      status: string;
      pr_number: number;
      pr_url: string;
      branch: string;
    };
    expect(task.status).toBe("review");
    expect(task.pr_number).toBe(42);
    expect(task.branch).toBe("agent/ship/task-1");

    const types = log.read({ stream: `task:${taskId}` }).map((e) => e.type);
    expect(types).toEqual([
      "task.created",
      "task.status_changed", // doing
      "message.posted", // the agent's report
      "task.pr_opened",
      "task.status_changed", // review
    ]);
  });

  it("no PR in output → task returns to todo", async () => {
    const db = openDb(":memory:");
    migrate(db);
    ensureProjections(db);
    const log = new EventLog(db);

    const orchestrator = new Orchestrator({
      db,
      log,
      companyId: COMPANY,
      companyName: "Test Co",
      registry: new Map([["ship", ship()]]),
      runtime: new FakeRuntime((job) => [
        { kind: "started", sessionId: job.sessionId, model: "sonnet" },
        {
          kind: "result",
          ok: true,
          text: "SPLIT-REQUIRED: this needs two PRs — schema first, then UI.",
          numTurns: 3,
        },
      ]),
      agentsHome: mkdtempSync(join(tmpdir(), "charter-agents-")),
      repoRoot: tempRepo(),
    });
    orchestrator.start();

    const taskId = newTaskId();
    log.append({
      company_id: COMPANY,
      stream: `task:${taskId}`,
      type: "task.created",
      actor: { kind: "human", id: "founder" },
      payload: {
        task_id: taskId,
        title: "Too big",
        assignee_id: "ship",
        assignee_kind: "agent",
      },
    });
    await drain(orchestrator, db);
    orchestrator.stop();

    const task = db
      .prepare("SELECT status, pr_number FROM tasks WHERE task_id = ?")
      .get(taskId) as { status: string; pr_number: number | null };
    expect(task.status).toBe("todo");
    expect(task.pr_number).toBeNull();
  });
});
