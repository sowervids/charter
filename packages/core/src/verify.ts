import type { Db } from "./db.js";
import { GENESIS_HASH, hashEvent } from "./hash.js";
import type { EventRow } from "./rows.js";

export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBadSeq?: number;
  reason?: string;
}

const CHUNK = 1000;

/** Walk the hash chain per company, recomputing every link. */
export function verify(db: Db): VerifyResult {
  const page = db.prepare(
    "SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?",
  );
  const prevByCompany = new Map<string, string>();
  let checked = 0;
  let after = 0;

  for (;;) {
    const rows = page.all(after, CHUNK) as EventRow[];
    if (rows.length === 0) break;
    for (const row of rows) {
      after = row.seq;
      const expectedPrev = prevByCompany.get(row.company_id) ?? GENESIS_HASH;
      if (row.hash_prev !== expectedPrev) {
        return {
          ok: false,
          checked,
          firstBadSeq: row.seq,
          reason: `hash_prev mismatch (chain broken before this event)`,
        };
      }
      const recomputed = hashEvent(
        {
          id: row.id,
          company_id: row.company_id,
          stream: row.stream,
          stream_seq: row.stream_seq,
          type: row.type,
          actor_kind: row.actor_kind,
          actor_id: row.actor_id,
          on_behalf_of: row.on_behalf_of,
          session_id: row.session_id,
          invocation_id: row.invocation_id,
          payload: JSON.parse(row.payload),
          refs: JSON.parse(row.refs),
          visibility: row.visibility,
          created_at: row.created_at,
        },
        row.hash_prev,
      );
      if (recomputed !== row.hash_self) {
        return {
          ok: false,
          checked,
          firstBadSeq: row.seq,
          reason: `hash_self mismatch (event content was altered)`,
        };
      }
      prevByCompany.set(row.company_id, row.hash_self);
      checked += 1;
    }
  }
  return { ok: true, checked };
}
