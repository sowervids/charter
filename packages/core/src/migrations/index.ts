/**
 * Migrations are plain SQL embedded as TS modules (ADR 0002).
 * Rules: events-table changes are additive only; projection tables may be
 * dropped/rebuilt freely via `charter rebuild`.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "events_spine",
    sql: `
      CREATE TABLE events (
        seq           INTEGER PRIMARY KEY AUTOINCREMENT,
        id            TEXT NOT NULL UNIQUE,
        company_id    TEXT NOT NULL,
        stream        TEXT NOT NULL,
        stream_seq    INTEGER NOT NULL,
        type          TEXT NOT NULL,
        actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('human','agent','system','integration')),
        actor_id      TEXT NOT NULL,
        on_behalf_of  TEXT,
        session_id    TEXT,
        invocation_id TEXT,
        payload       TEXT NOT NULL,
        refs          TEXT NOT NULL DEFAULT '[]',
        visibility    TEXT NOT NULL DEFAULT 'company'
                      CHECK (visibility IN ('company','agent_trace','system')),
        hash_prev     TEXT NOT NULL,
        hash_self     TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        UNIQUE (company_id, stream, stream_seq)
      );
      CREATE INDEX ix_events_stream      ON events (company_id, stream, seq);
      CREATE INDEX ix_events_type        ON events (company_id, type, seq);
      -- hash-chain tip lookup: last event per company must be an index seek,
      -- or append cost grows linearly with log size
      CREATE INDEX ix_events_company_seq ON events (company_id, seq);

      CREATE TABLE projection_state (
        name     TEXT PRIMARY KEY,
        version  INTEGER NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 2,
    name: "devlog_projection",
    sql: `
      CREATE TABLE devlog_notes (
        event_id   TEXT PRIMARY KEY,
        seq        INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        note       TEXT NOT NULL,
        tags       TEXT NOT NULL DEFAULT '[]'
      );
    `,
  },
];
