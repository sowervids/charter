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
