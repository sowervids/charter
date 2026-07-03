import { createHash } from "node:crypto";
import { canonicalJson } from "@charter/schema";

export const GENESIS_HASH = "GENESIS";

export interface HashableEvent {
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
  payload: unknown;
  refs: unknown;
  visibility: string;
  created_at: string;
}

export function hashEvent(event: HashableEvent, hashPrev: string): string {
  return createHash("sha256")
    .update(canonicalJson(event))
    .update(hashPrev)
    .digest("hex");
}
