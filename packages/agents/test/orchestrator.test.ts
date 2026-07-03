import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { channelStream } from "@charter/schema";
import {
  EventLog,
  ensureProjections,
  migrate,
  openDb,
  type Db,
} from "@charter/core";
import { FakeRuntime, replyScript } from "../src/runtime-fake.js";
import { Orchestrator } from "../src/orchestrator.js";
import type { AgentConfig, AgentJob, RuntimeEvent } from "../src/types.js";

const COMPANY = "co_test";

function scout(): AgentConfig {
  return {
    id: "scout",
    name: "Scout",
    role: "Research",
    model: "sonnet",
    max_turns: 8,
    daily_runs: 30,
    max_wall_ms: 60_000,
    charter: "You research things.",
  };
}

function setup(script: (job: AgentJob) => RuntimeEvent[]) {
  const db: Db = openDb(":memory:");
  migrate(db);
  ensureProjections(db);
  const log = new EventLog(db);
  const runtime = new FakeRuntime(script);
  const orchestrator = new Orchestrator({
    db,
    log,
    companyId: COMPANY,
    companyName: "Test Co",
    registry: new Map([["scout", scout()]]),
    runtime,
    agentsHome: mkdtempSync(join(tmpdir(), "charter-agents-")),
  });
  return { db, log, runtime, orchestrator };
}

function mention(log: EventLog, body: string) {
  return log.append({
    company_id: COMPANY,
    stream: channelStream("general"),
    type: "message.posted",
    actor: { kind: "human", id: "founder" },
    payload: { body },
  });
}

async function drain(orchestrator: Orchestrator, db: Db): Promise<void> {
  for (let i = 0; i < 100; i++) {
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

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("mention → run → agent reply in-channel, fully journaled", async () => {
    const { db, log, runtime, orchestrator } = setup(
      replyScript("On it. Three findings…"),
    );
    orchestrator.start();
    const trigger = mention(log, "hey @scout what's in this repo?");
    await drain(orchestrator, db);
    orchestrator.stop();

    // The reply is in the channel, attributed to the agent, linked to trigger.
    const timeline = log.read({ stream: channelStream("general") });
    const reply = timeline.at(-1)!;
    expect(reply.type).toBe("message.posted");
    expect(reply.actor.kind).toBe("agent");
    expect(reply.actor.id).toBe("scout");
    expect(reply.actor.on_behalf_of).toBe("founder");
    expect(reply.refs).toEqual([{ rel: "reply_to", id: trigger.id }]);

    // The run journal is complete: queued → started → step → completed.
    const journal = log
      .read({ stream: "agent:scout" })
      .map((e) => e.type);
    expect(journal).toEqual([
      "agent.run_queued",
      "agent.run_started",
      "agent.run_step",
      "agent.run_completed",
    ]);

    // Shadow cost ledger captured usage.
    const run = db
      .prepare("SELECT * FROM agent_runs WHERE status = 'completed'")
      .get() as { cost_usd: number; num_turns: number };
    expect(run.cost_usd).toBeCloseTo(0.001);

    // The prompt carried charter + channel context.
    expect(runtime.jobs[0]?.prompt).toContain("You research things.");
    expect(runtime.jobs[0]?.prompt).toContain("what's in this repo?");
  });

  it("ignores mentions from agents (no chain reactions in v1)", async () => {
    const { db, log, orchestrator } = setup(replyScript("nope"));
    orchestrator.start();
    log.append({
      company_id: COMPANY,
      stream: channelStream("general"),
      type: "message.posted",
      actor: { kind: "agent", id: "scout" },
      payload: { body: "pinging @scout myself" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    orchestrator.stop();
    const runs = db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get() as {
      n: number;
    };
    expect(runs.n).toBe(0);
  });

  it("journals failures and does not post a reply", async () => {
    const { db, log, orchestrator } = setup(() => [
      { kind: "started", sessionId: "s", model: "sonnet" },
      { kind: "result", ok: false, reason: "runtime_error", detail: "boom" },
    ]);
    orchestrator.start();
    mention(log, "@scout do a thing");
    await drain(orchestrator, db);
    orchestrator.stop();

    const failed = db
      .prepare("SELECT reason FROM agent_runs WHERE status = 'failed'")
      .all();
    expect(failed).toHaveLength(1);
    const messages = log
      .read({ stream: channelStream("general") })
      .filter((e) => e.actor.kind === "agent");
    expect(messages).toHaveLength(0);
  });

  it("rate-limited runs are requeued, never dropped", async () => {
    let calls = 0;
    const { db, log, orchestrator } = setup((job) => {
      calls += 1;
      return calls === 1
        ? [{ kind: "result", ok: false, reason: "rate_limit" }]
        : replyScript("recovered")(job);
    });
    orchestrator.start();
    mention(log, "@scout hello");
    orchestrator.pump();
    await new Promise((resolve) => setTimeout(resolve, 30));
    orchestrator.pump(); // backoff is open — the requeued run must NOT admit
    await new Promise((resolve) => setTimeout(resolve, 10));
    orchestrator.stop();

    // First run failed as rate_limit; a fresh run was queued for the same
    // trigger and is waiting out the governor's backoff.
    const rows = db
      .prepare("SELECT status FROM agent_runs ORDER BY queued_at")
      .all() as Array<{ status: string }>;
    expect(rows.map((r) => r.status)).toEqual(["failed", "queued"]);
    expect(orchestrator.status().backoffUntil).not.toBeNull();
  });

  it("recovers interrupted runs on restart", async () => {
    const { db, log, orchestrator } = setup(replyScript("hi"));
    // Simulate a run that died mid-flight in a previous process: journal
    // queued + started with no terminal event.
    const trigger = mention(log, "@scout are you alive?");
    log.append({
      company_id: COMPANY,
      stream: "agent:scout",
      type: "agent.run_queued",
      actor: { kind: "system", id: "charterd" },
      payload: {
        run_id: "run_STALE",
        agent_id: "scout",
        channel_id: "general",
        trigger_event_id: trigger.id,
        priority: "p0",
      },
    });
    log.append({
      company_id: COMPANY,
      stream: "agent:scout",
      type: "agent.run_started",
      actor: { kind: "system", id: "charterd" },
      payload: {
        run_id: "run_STALE",
        agent_id: "scout",
        channel_id: "general",
        session_id: "dead-session",
        model: "sonnet",
        resumed: false,
      },
    });

    orchestrator.start(); // recovery happens here
    await drain(orchestrator, db);
    orchestrator.stop();

    const stale = db
      .prepare("SELECT status FROM agent_runs WHERE run_id = 'run_STALE'")
      .get() as { status: string };
    expect(stale.status).toBe("interrupted");
    const completed = db
      .prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE status = 'completed'")
      .get() as { n: number };
    expect(completed.n).toBe(1);
  });

  it("resumes the same session for the same agent+channel", async () => {
    const { db, log, runtime, orchestrator } = setup(replyScript("again"));
    orchestrator.start();
    mention(log, "@scout first");
    await drain(orchestrator, db);
    mention(log, "@scout second");
    await drain(orchestrator, db);
    orchestrator.stop();

    expect(runtime.jobs).toHaveLength(2);
    expect(runtime.jobs[0]?.resume).toBe(false);
    expect(runtime.jobs[1]?.resume).toBe(true);
    expect(runtime.jobs[1]?.sessionId).toBe(runtime.jobs[0]?.sessionId);
  });
});
