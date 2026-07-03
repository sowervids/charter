import {
  NewEvent,
  newEventId,
  parseEventPayload,
  type CommittedEvent,
} from "@charter/schema";
import type { Db } from "./db.js";
import { GENESIS_HASH, hashEvent } from "./hash.js";
import { PROJECTORS } from "./projections/registry.js";
import { rowToEvent, type EventRow } from "./rows.js";

export class ConcurrencyError extends Error {
  constructor(
    public readonly stream: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `Concurrency conflict on ${stream}: expected stream_seq ${expected}, next is ${actual}`,
    );
    this.name = "ConcurrencyError";
  }
}

export interface ReadOptions {
  afterSeq?: number;
  stream?: string;
  companyId?: string;
  limit?: number;
}

export class EventLog {
  private readonly listeners = new Set<(event: CommittedEvent) => void>();
  private readonly appendTx: (input: NewEvent) => CommittedEvent;

  constructor(private readonly db: Db) {
    const insert = db.prepare(`
      INSERT INTO events (
        id, company_id, stream, stream_seq, type,
        actor_kind, actor_id, on_behalf_of, session_id, invocation_id,
        payload, refs, visibility, hash_prev, hash_self, created_at
      ) VALUES (
        @id, @company_id, @stream, @stream_seq, @type,
        @actor_kind, @actor_id, @on_behalf_of, @session_id, @invocation_id,
        @payload, @refs, @visibility, @hash_prev, @hash_self, @created_at
      )
    `);
    const nextStreamSeq = db.prepare(
      `SELECT COALESCE(MAX(stream_seq), 0) + 1 AS next
         FROM events WHERE company_id = ? AND stream = ?`,
    );
    const lastHash = db.prepare(
      `SELECT hash_self FROM events WHERE company_id = ?
        ORDER BY seq DESC LIMIT 1`,
    );
    const touchState = db.prepare(
      `INSERT INTO projection_state (name, version, last_seq)
       VALUES (@name, @version, @last_seq)
       ON CONFLICT(name) DO UPDATE SET last_seq = excluded.last_seq`,
    );

    const tx = db.transaction((input: NewEvent): CommittedEvent => {
      const parsed = NewEvent.parse(input);
      const payload = parseEventPayload(parsed.type, parsed.payload);

      const { next } = nextStreamSeq.get(parsed.company_id, parsed.stream) as {
        next: number;
      };
      if (
        parsed.expected_stream_seq !== undefined &&
        parsed.expected_stream_seq !== next
      ) {
        throw new ConcurrencyError(
          parsed.stream,
          parsed.expected_stream_seq,
          next,
        );
      }

      const prev =
        (lastHash.get(parsed.company_id) as { hash_self: string } | undefined)
          ?.hash_self ?? GENESIS_HASH;

      const id = newEventId();
      const created_at = new Date().toISOString();
      const actor = parsed.actor;
      const hashable = {
        id,
        company_id: parsed.company_id,
        stream: parsed.stream,
        stream_seq: next,
        type: parsed.type,
        actor_kind: actor.kind,
        actor_id: actor.id,
        on_behalf_of: actor.on_behalf_of ?? null,
        session_id: actor.session_id ?? null,
        invocation_id: actor.invocation_id ?? null,
        payload,
        refs: parsed.refs,
        visibility: parsed.visibility,
        created_at,
      };
      const hash_self = hashEvent(hashable, prev);

      const info = insert.run({
        ...hashable,
        payload: JSON.stringify(payload),
        refs: JSON.stringify(parsed.refs),
        hash_prev: prev,
        hash_self,
      });

      const committed: CommittedEvent = {
        seq: Number(info.lastInsertRowid),
        id,
        company_id: parsed.company_id,
        stream: parsed.stream,
        stream_seq: next,
        type: parsed.type,
        actor,
        payload,
        refs: parsed.refs,
        visibility: parsed.visibility,
        hash_prev: prev,
        hash_self,
        created_at,
      };

      for (const projector of PROJECTORS) {
        if (!projector.types.includes(committed.type)) continue;
        projector.apply(this.db, committed);
        touchState.run({
          name: projector.name,
          version: projector.version,
          last_seq: committed.seq,
        });
      }

      return committed;
    });

    this.appendTx = (input) => tx.immediate(input);
  }

  append(input: NewEvent): CommittedEvent {
    const committed = this.appendTx(input);
    for (const listener of this.listeners) listener(committed);
    return committed;
  }

  read(options: ReadOptions = {}): CommittedEvent[] {
    const { afterSeq = 0, stream, companyId, limit = 1000 } = options;
    const clauses = ["seq > @afterSeq"];
    const params: Record<string, unknown> = { afterSeq, limit };
    if (stream !== undefined) {
      clauses.push("stream = @stream");
      params["stream"] = stream;
    }
    if (companyId !== undefined) {
      clauses.push("company_id = @companyId");
      params["companyId"] = companyId;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE ${clauses.join(" AND ")}
          ORDER BY seq LIMIT @limit`,
      )
      .all(params) as EventRow[];
    return rows.map(rowToEvent);
  }

  getById(id: string): CommittedEvent | null {
    const row = this.db
      .prepare("SELECT * FROM events WHERE id = ?")
      .get(id) as EventRow | undefined;
    return row === undefined ? null : rowToEvent(row);
  }

  /** Last N events of a stream, ascending. */
  tail(options: { stream: string; companyId: string; limit: number }): CommittedEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
          WHERE company_id = ? AND stream = ?
          ORDER BY seq DESC LIMIT ?`,
      )
      .all(options.companyId, options.stream, options.limit) as EventRow[];
    return rows.reverse().map(rowToEvent);
  }

  lastSeq(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events")
      .get() as { seq: number };
    return row.seq;
  }

  /** Post-commit, in-process notification. Returns an unsubscribe function. */
  onCommit(listener: (event: CommittedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
