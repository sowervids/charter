import type { Actor, CommittedEvent, Ref, Visibility } from "@charter/schema";

export interface EventRow {
  seq: number;
  id: string;
  company_id: string;
  stream: string;
  stream_seq: number;
  type: string;
  actor_kind: string;
  actor_id: string;
  on_behalf_of: string | null;
  session_id: string | null;
  invocation_id: string | null;
  payload: string;
  refs: string;
  visibility: string;
  hash_prev: string;
  hash_self: string;
  created_at: string;
}

export function rowToEvent(row: EventRow): CommittedEvent {
  const actor: Actor = {
    kind: row.actor_kind as Actor["kind"],
    id: row.actor_id,
    ...(row.on_behalf_of ? { on_behalf_of: row.on_behalf_of } : {}),
    ...(row.session_id ? { session_id: row.session_id } : {}),
    ...(row.invocation_id ? { invocation_id: row.invocation_id } : {}),
  };
  return {
    seq: row.seq,
    id: row.id,
    company_id: row.company_id,
    stream: row.stream,
    stream_seq: row.stream_seq,
    type: row.type,
    actor,
    payload: JSON.parse(row.payload) as unknown,
    refs: JSON.parse(row.refs) as Ref[],
    visibility: row.visibility as Visibility,
    hash_prev: row.hash_prev,
    hash_self: row.hash_self,
    created_at: row.created_at,
  };
}
