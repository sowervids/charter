import type { AgentJob, AgentRuntime, RuntimeEvent } from "./types.js";

export type FakeScript = (job: AgentJob) => RuntimeEvent[];

/** Deterministic runtime for tests — no processes, no network, no model. */
export class FakeRuntime implements AgentRuntime {
  public readonly jobs: AgentJob[] = [];
  constructor(private readonly script: FakeScript) {}

  async *invoke(job: AgentJob): AsyncIterable<RuntimeEvent> {
    this.jobs.push(job);
    for (const event of this.script(job)) {
      await Promise.resolve(); // yield the microtask, like a real stream
      yield event;
    }
  }
}

export function replyScript(text: string): FakeScript {
  return (job) => [
    { kind: "started", sessionId: job.sessionId, model: job.agent.model },
    { kind: "step", step: "text", preview: text.slice(0, 200) },
    {
      kind: "result",
      ok: true,
      text,
      numTurns: 1,
      usage: { input_tokens: 100, output_tokens: 20, cost_usd: 0.001 },
    },
  ];
}
