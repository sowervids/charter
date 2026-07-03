export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  /** claude model alias — sonnet by default (rate-limit economics) */
  model: string;
  max_turns: number;
  daily_runs: number;
  /** wall-clock kill, ms */
  max_wall_ms: number;
  charter: string;
}

export interface AgentJob {
  runId: string;
  agent: AgentConfig;
  channelId: string;
  triggerEventId: string;
  prompt: string;
  cwd: string;
  sessionId: string;
  resume: boolean;
}

export type RuntimeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
};

export type RuntimeEvent =
  | { kind: "started"; sessionId: string; model: string }
  | {
      kind: "step";
      step: "text" | "tool_use" | "tool_result";
      name?: string;
      preview?: string;
    }
  | {
      kind: "result";
      ok: true;
      text: string;
      numTurns: number;
      usage?: RuntimeUsage;
    }
  | {
      kind: "result";
      ok: false;
      reason: "rate_limit" | "timeout" | "spawn_error" | "runtime_error";
      detail?: string;
    };

/**
 * THE seam (risk register #1): all model invocation goes through this
 * interface. ClaudeCliRuntime today; ApiRuntime / ManagedAgentsRuntime are
 * pre-scoped swap targets if subscription terms or economics shift.
 */
export interface AgentRuntime {
  invoke(job: AgentJob): AsyncIterable<RuntimeEvent>;
}
