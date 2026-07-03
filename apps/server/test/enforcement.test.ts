import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { actionHash } from "@charter/policy";
import { buildServer } from "../src/server.js";
import { openServerContext, type ServerContext } from "../src/env.js";

let ctx: ServerContext;
let app: ReturnType<typeof buildServer>;
const SESSION = "11111111-2222-4333-8444-555555555555";

function hook(tool: string, input: Record<string, unknown>, session = SESSION) {
  return app.inject({
    method: "POST" as const,
    url: `/hooks/pretooluse?token=${ctx.token}`,
    payload: { session_id: session, tool_name: tool, tool_input: input },
  });
}

function decisionOf(res: { json: () => unknown }): { d: string; reason: string } {
  const body = res.json() as {
    hookSpecificOutput: {
      permissionDecision: string;
      permissionDecisionReason: string;
    };
  };
  return {
    d: body.hookSpecificOutput.permissionDecision,
    reason: body.hookSpecificOutput.permissionDecisionReason,
  };
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), "charter-enf-"));
  mkdirSync(join(root, "company", "agents", "ship"), { recursive: true });
  writeFileSync(
    join(root, "company", "company.json"),
    JSON.stringify({ id: "co_test", name: "Test Co" }),
  );
  writeFileSync(
    join(root, "company", "agents", "ship", "policy.json"),
    JSON.stringify({
      version: 1,
      rules: {
        deny: ["Bash(rm *)"],
        approval_required: ["Bash(gh pr create*)"],
        allow: ["Bash(git status*)", "Edit"],
      },
    }),
  );
  ctx = openServerContext(root);
  // A running agent run bound to the session, as the orchestrator would journal.
  ctx.log.append({
    company_id: "co_test",
    stream: "agent:ship",
    type: "agent.run_queued",
    actor: { kind: "system", id: "charterd" },
    payload: {
      run_id: "run_ENF",
      agent_id: "ship",
      channel_id: "devlog",
      trigger_event_id: "evt_x",
      priority: "p1",
      kind: "task",
    },
  });
  ctx.log.append({
    company_id: "co_test",
    stream: "agent:ship",
    type: "agent.run_started",
    actor: { kind: "system", id: "charterd" },
    payload: {
      run_id: "run_ENF",
      agent_id: "ship",
      channel_id: "devlog",
      session_id: SESSION,
      model: "sonnet",
      resumed: false,
    },
  });
  app = buildServer(ctx);
});

afterAll(async () => {
  await app.close();
});

describe("PreToolUse enforcement", () => {
  it("rejects hook calls with a bad token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/hooks/pretooluse?token=WRONG",
      payload: { session_id: SESSION, tool_name: "Bash", tool_input: {} },
    });
    expect(decisionOf(res).d).toBe("deny");
  });

  it("fails OPEN for unknown sessions (the founder's own claude)", async () => {
    const res = await hook("Bash", { command: "rm -rf /" }, "99999999-9999-4999-8999-999999999999");
    expect(decisionOf(res).d).toBe("allow");
    expect(decisionOf(res).reason).toContain("unknown session");
  });

  it("allows policy-allowed actions for agent sessions", async () => {
    const res = await hook("Bash", { command: "git status --short" });
    expect(decisionOf(res).d).toBe("allow");
  });

  it("BLOCKS forbidden actions and names the rule", async () => {
    const res = await hook("Bash", { command: "rm -rf var" });
    const { d, reason } = decisionOf(res);
    expect(d).toBe("deny");
    expect(reason).toContain('rule "Bash(rm *)"');
  });

  it("denies by default anything unlisted", async () => {
    const res = await hook("Bash", { command: "curl https://evil.example" });
    const { d, reason } = decisionOf(res);
    expect(d).toBe("deny");
    expect(reason).toContain("default deny");
  });

  it("holds gated actions: approval requested, retry still held, approve → single-use pass", async () => {
    const input = { command: "gh pr create --title x" };

    // First attempt: held, approval journaled.
    const first = await hook("Bash", input);
    expect(decisionOf(first).d).toBe("deny");
    expect(decisionOf(first).reason).toContain("HELD FOR APPROVAL");
    const approvals = ctx.db
      .prepare("SELECT * FROM approvals WHERE status = 'pending'")
      .all() as Array<{ approval_id: string; payload_hash: string }>;
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.payload_hash).toBe(
      actionHash({ tool: "Bash", input }),
    );

    // Second attempt while pending: still held, NO duplicate approval.
    const second = await hook("Bash", input);
    expect(decisionOf(second).d).toBe("deny");
    expect(
      (ctx.db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n,
    ).toBe(1);

    // Founder approves.
    const resolve = await app.inject({
      method: "POST",
      url: `/api/approvals/${approvals[0]!.approval_id}/resolve`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { decision: "allow", note: "ship it" },
    });
    expect(resolve.statusCode).toBe(200);

    // Retry passes exactly once…
    const third = await hook("Bash", input);
    expect(decisionOf(third).d).toBe("allow");
    expect(decisionOf(third).reason).toContain("single-use");

    // …and the approval is consumed: a fourth attempt is held again.
    const fourth = await hook("Bash", input);
    expect(decisionOf(fourth).d).toBe("deny");
    expect(decisionOf(fourth).reason).toContain("HELD FOR APPROVAL");
  });

  it("a granted approval does NOT cover a different payload", async () => {
    const input = { command: "gh pr create --title y" };
    const held = await hook("Bash", input);
    expect(decisionOf(held).reason).toContain("HELD FOR APPROVAL");
    const approval = ctx.db
      .prepare(
        "SELECT approval_id FROM approvals WHERE status = 'pending' ORDER BY requested_at DESC",
      )
      .get() as { approval_id: string };
    await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.approval_id}/resolve`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { decision: "allow" },
    });
    // Sneaky swap: approved "--title y", attempts "--title y --body pwned".
    const swapped = await hook("Bash", {
      command: "gh pr create --title y --body pwned",
    });
    expect(decisionOf(swapped).d).toBe("deny");
  });

  it("denied approvals never pass", async () => {
    const input = { command: "gh pr create --title z" };
    await hook("Bash", input);
    const approval = ctx.db
      .prepare(
        "SELECT approval_id FROM approvals WHERE status = 'pending' ORDER BY requested_at DESC",
      )
      .get() as { approval_id: string };
    await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.approval_id}/resolve`,
      headers: { authorization: `Bearer ${ctx.token}` },
      payload: { decision: "deny", note: "not yet" },
    });
    const retry = await hook("Bash", input);
    expect(decisionOf(retry).d).toBe("deny");
  });
});
