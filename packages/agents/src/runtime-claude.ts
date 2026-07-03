import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentJob, AgentRuntime, RuntimeEvent } from "./types.js";

/**
 * The sanctioned $0 runtime: headless `claude -p` under the founder's Max
 * subscription (keychain OAuth). NEVER pass --bare — bare mode skips the
 * keychain and would silently break subscription auth (verified against
 * docs; see the approved plan, "Verified runtime facts").
 *
 * All flags are explicit; we never rely on CLI defaults (risk #1: substrate
 * drift). The prompt arrives via stdin (no arg-length or quoting issues).
 */
export class ClaudeCliRuntime implements AgentRuntime {
  constructor(private readonly claudeBin = "claude") {}

  async *invoke(job: AgentJob): AsyncIterable<RuntimeEvent> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      job.agent.model,
      "--max-turns",
      String(job.agent.max_turns),
      "--permission-mode",
      "dontAsk",
      "--strict-mcp-config",
      ...(job.allowedTools && job.allowedTools.length > 0
        ? ["--allowedTools", ...job.allowedTools]
        : []),
      ...(job.resume
        ? ["--resume", job.sessionId]
        : ["--session-id", job.sessionId]),
    ];

    let child;
    try {
      child = spawn(this.claudeBin, args, {
        cwd: job.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "charter" },
      });
    } catch (error) {
      yield {
        kind: "result",
        ok: false,
        reason: "spawn_error",
        detail: String(error),
      };
      return;
    }

    child.stdin.write(job.prompt);
    child.stdin.end();

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    const killTimer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, job.maxWallMs ?? job.agent.max_wall_ms);

    let sawRateLimit = false;
    let gotResult = false;
    let timedOut = false;
    killTimer.unref();

    try {
      const lines = createInterface({ input: child.stdout });
      for await (const line of lines) {
        if (line.trim().length === 0) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue; // non-JSON noise on stdout — ignore, never crash the run
        }

        const type = parsed["type"];
        if (type === "system") {
          const subtype = parsed["subtype"];
          if (subtype === "init") {
            yield {
              kind: "started",
              sessionId: String(parsed["session_id"] ?? job.sessionId),
              model: String(parsed["model"] ?? job.agent.model),
            };
          } else if (subtype === "api_retry") {
            if (parsed["error"] === "rate_limit") sawRateLimit = true;
          }
        } else if (type === "assistant") {
          const message = parsed["message"] as
            | { content?: Array<Record<string, unknown>> }
            | undefined;
          for (const block of message?.content ?? []) {
            if (block["type"] === "text") {
              yield {
                kind: "step",
                step: "text",
                preview: String(block["text"] ?? "").slice(0, 200),
              };
            } else if (block["type"] === "tool_use") {
              yield {
                kind: "step",
                step: "tool_use",
                name: String(block["name"] ?? "unknown"),
              };
            }
          }
        } else if (type === "result") {
          gotResult = true;
          const isError = parsed["is_error"] === true;
          const usageRaw = parsed["usage"] as
            | { input_tokens?: number; output_tokens?: number }
            | undefined;
          if (!isError) {
            yield {
              kind: "result",
              ok: true,
              text: String(parsed["result"] ?? ""),
              numTurns: Number(parsed["num_turns"] ?? 0),
              usage: {
                ...(usageRaw?.input_tokens !== undefined
                  ? { input_tokens: usageRaw.input_tokens }
                  : {}),
                ...(usageRaw?.output_tokens !== undefined
                  ? { output_tokens: usageRaw.output_tokens }
                  : {}),
                ...(typeof parsed["total_cost_usd"] === "number"
                  ? { cost_usd: parsed["total_cost_usd"] }
                  : {}),
              },
            };
          } else {
            const detail = String(parsed["result"] ?? parsed["subtype"] ?? "");
            yield {
              kind: "result",
              ok: false,
              reason:
                sawRateLimit || /rate.?limit|429|overloaded/i.test(detail)
                  ? "rate_limit"
                  : "runtime_error",
              detail: detail.slice(0, 2000),
            };
          }
        }
      }

      const exitCode: number | null = await new Promise((resolve) => {
        child.once("close", resolve);
        if (child.exitCode !== null) resolve(child.exitCode);
      });

      if (!gotResult) {
        timedOut = child.killed;
        yield {
          kind: "result",
          ok: false,
          reason: timedOut
            ? "timeout"
            : sawRateLimit
              ? "rate_limit"
              : "spawn_error",
          detail: `exit ${exitCode}; stderr: ${stderr.slice(-500)}`,
        };
      }
    } finally {
      clearTimeout(killTimer);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}
