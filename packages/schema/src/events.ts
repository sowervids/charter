import { z } from "zod";

/** ---------- Envelope pieces ---------- */

export const ActorKind = z.enum(["human", "agent", "system", "integration"]);
export type ActorKind = z.infer<typeof ActorKind>;

export const Actor = z.object({
  kind: ActorKind,
  id: z.string().min(1),
  on_behalf_of: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  invocation_id: z.string().min(1).optional(),
});
export type Actor = z.infer<typeof Actor>;

export const Ref = z.object({
  rel: z.string().min(1),
  id: z.string().min(1),
});
export type Ref = z.infer<typeof Ref>;

export const Visibility = z.enum(["company", "agent_trace", "system"]);
export type Visibility = z.infer<typeof Visibility>;

/** ---------- Streams ---------- */

export const SYSTEM_STREAM = "system";

export function channelStream(channelId: string): string {
  return `channel:${channelId}`;
}

/** ---------- Event payload registry ----------
 * The single authority on what event types exist and what their payloads
 * look like. Adding a feature starts here (see CLAUDE.md "the groove").
 * Payload changes are additive-only; breaking changes are a new type name
 * plus an upcaster (ADR 0002).
 */
export const EVENT_PAYLOADS = {
  "company.created": z.object({
    name: z.string().min(1),
  }),
  "devlog.note": z.object({
    note: z.string().min(1),
    tags: z.array(z.string().min(1)).optional(),
  }),
  "channel.created": z.object({
    /** URL-safe channel id, also the stream suffix: channel:<id> */
    channel_id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits, hyphens"),
    name: z.string().min(1).max(80),
    topic: z.string().max(500).optional(),
  }),
  "message.posted": z.object({
    body: z.string().min(1).max(20_000),
  }),

  /** ---- Tasks (stream: task:<id>; comments are message.posted on it) ---- */
  "task.created": z.object({
    task_id: z.string().min(1),
    title: z.string().min(1).max(200),
    body: z.string().max(20_000).optional(),
    assignee_id: z.string().optional(),
    assignee_kind: z.enum(["human", "agent"]).optional(),
    origin_event_id: z.string().optional(),
  }),
  "task.assigned": z.object({
    task_id: z.string().min(1),
    assignee_id: z.string().min(1),
    assignee_kind: z.enum(["human", "agent"]),
  }),
  "task.status_changed": z.object({
    task_id: z.string().min(1),
    status: z.enum(["triage", "todo", "doing", "review", "done", "dropped"]),
  }),
  "task.pr_opened": z.object({
    task_id: z.string().min(1),
    pr_number: z.number().int().positive(),
    pr_url: z.string().min(1),
    branch: z.string().min(1),
  }),

  /** ---- Ledger (stream: ledger) — double-entry, mirror mode ---- */
  "ledger.account_opened": z.object({
    account_id: z.string().min(1),
    name: z.string().min(1).max(120),
    account_type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
    currency: z.string().length(3),
    external_ref: z.string().optional(),
  }),
  "ledger.entry_posted": z
    .object({
      entry_id: z.string().min(1),
      entry_date: z.string().min(10),
      memo: z.string().min(1).max(500),
      lines: z
        .array(
          z.object({
            account_id: z.string().min(1),
            direction: z.enum(["debit", "credit"]),
            amount_cents: z.number().int().positive(),
            currency: z.string().length(3),
          }),
        )
        .min(2),
      source: z
        .object({ kind: z.enum(["import", "manual", "proposal"]), ref: z.string() })
        .optional(),
    })
    .refine(
      (entry) => {
        const byCurrency = new Map<string, number>();
        for (const line of entry.lines) {
          const delta = line.direction === "debit" ? line.amount_cents : -line.amount_cents;
          byCurrency.set(line.currency, (byCurrency.get(line.currency) ?? 0) + delta);
        }
        return [...byCurrency.values()].every((v) => v === 0);
      },
      { message: "unbalanced entry: Σdebits must equal Σcredits per currency" },
    ),
  "ledger.external_txn_observed": z.object({
    source: z.enum(["stripe", "mercury", "mock"]),
    external_id: z.string().min(1),
    amount_cents: z.number().int(), // signed: + inflow, − outflow
    currency: z.string().length(3),
    occurred_at: z.string().min(10),
    description: z.string().max(500),
  }),
  "ledger.txn_matched": z.object({
    source: z.enum(["stripe", "mercury", "mock"]),
    external_id: z.string().min(1),
    entry_id: z.string().min(1),
  }),
  "ledger.payment_proposed": z.object({
    proposal_id: z.string().min(1),
    counterparty: z.string().min(1).max(200),
    amount_cents: z.number().int().positive(),
    currency: z.string().length(3),
    memo: z.string().min(1).max(500),
  }),
  "ledger.payment_marked_sent": z.object({
    proposal_id: z.string().min(1),
  }),
  "ledger.payment_rejected": z.object({
    proposal_id: z.string().min(1),
    note: z.string().max(500).optional(),
  }),
  "ledger.payment_confirmed": z.object({
    proposal_id: z.string().min(1),
    source: z.enum(["stripe", "mercury", "mock"]),
    external_id: z.string().min(1),
  }),

  /** ---- Approvals (stream: approval:<id>) ---- */
  "approval.requested": z.object({
    approval_id: z.string().min(1),
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    tool: z.string().min(1),
    input_summary: z.string().max(2000),
    /** sha256(canonicalJson({tool, input})) — approvals are payload-scoped */
    payload_hash: z.string().length(64),
    rule: z.string().min(1),
    expires_at: z.string().min(1),
  }),
  "approval.resolved": z.object({
    approval_id: z.string().min(1),
    decision: z.enum(["allow", "deny"]),
    note: z.string().max(2000).optional(),
  }),
  "approval.consumed": z.object({
    approval_id: z.string().min(1),
  }),

  /** ---- Agent run journal (stream: agent:<id>) ---- */
  "agent.run_queued": z.object({
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    channel_id: z.string().min(1),
    trigger_event_id: z.string().min(1),
    priority: z.enum(["p0", "p1", "p2"]),
    /** additive (v2): task-execution runs — omitted means chat */
    kind: z.enum(["chat", "task"]).optional(),
    task_id: z.string().optional(),
    /** additive (v3): approval-resume continuations — resumes the original
     *  run's session with `note` as the prompt */
    continuation_of: z.string().optional(),
    note: z.string().max(2000).optional(),
  }),
  "agent.run_started": z.object({
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    channel_id: z.string().min(1),
    session_id: z.string().min(1),
    model: z.string().min(1),
    resumed: z.boolean(),
  }),
  "agent.run_step": z.object({
    run_id: z.string().min(1),
    kind: z.enum(["text", "tool_use", "tool_result"]),
    name: z.string().optional(),
    preview: z.string().max(2000).optional(),
  }),
  "agent.run_completed": z.object({
    run_id: z.string().min(1),
    num_turns: z.number().int().nonnegative(),
    duration_ms: z.number().int().nonnegative(),
    reply_event_id: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional(),
        cost_usd: z.number().nonnegative().optional(),
      })
      .optional(),
  }),
  "agent.run_failed": z.object({
    run_id: z.string().min(1),
    reason: z.enum(["rate_limit", "timeout", "spawn_error", "runtime_error"]),
    detail: z.string().max(2000).optional(),
  }),
  "agent.run_interrupted": z.object({
    run_id: z.string().min(1),
  }),
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[];

export type EventPayload<T extends EventType> = z.infer<
  (typeof EVENT_PAYLOADS)[T]
>;

export function isEventType(type: string): type is EventType {
  return type in EVENT_PAYLOADS;
}

/**
 * Validate a payload against the registry. Throws with a precise message on
 * unknown type or shape mismatch — malformed events must never enter the log.
 */
export function parseEventPayload(type: string, payload: unknown): unknown {
  if (!isEventType(type)) {
    throw new Error(
      `Unknown event type "${type}". Register it in @charter/schema EVENT_PAYLOADS first.`,
    );
  }
  const result = EVENT_PAYLOADS[type].safeParse(payload);
  if (!result.success) {
    throw new Error(
      `Invalid payload for "${type}": ${result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

/** ---------- Append input / committed event ---------- */

export const NewEvent = z.object({
  company_id: z.string().min(1),
  stream: z.string().min(1),
  type: z.string().min(1),
  actor: Actor,
  payload: z.unknown(),
  refs: z.array(Ref).default([]),
  visibility: Visibility.default("company"),
  /** Optimistic concurrency: reject if the stream has moved past this. */
  expected_stream_seq: z.number().int().positive().optional(),
});
export type NewEvent = z.input<typeof NewEvent>;

export interface CommittedEvent {
  seq: number;
  id: string;
  company_id: string;
  stream: string;
  stream_seq: number;
  type: string;
  actor: Actor;
  payload: unknown;
  refs: Ref[];
  visibility: Visibility;
  hash_prev: string;
  hash_self: string;
  created_at: string;
}
