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
  {
    version: 3,
    name: "channels_projection",
    sql: `
      CREATE TABLE channels (
        channel_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        name       TEXT NOT NULL,
        topic      TEXT,
        created_at TEXT NOT NULL,
        event_id   TEXT NOT NULL,
        PRIMARY KEY (company_id, channel_id)
      );
    `,
  },
  {
    version: 4,
    name: "agent_runs_projection",
    sql: `
      CREATE TABLE agent_runs (
        run_id           TEXT PRIMARY KEY,
        company_id       TEXT NOT NULL,
        agent_id         TEXT NOT NULL,
        channel_id       TEXT NOT NULL,
        trigger_event_id TEXT NOT NULL,
        priority         TEXT NOT NULL,
        status           TEXT NOT NULL CHECK (status IN
          ('queued','running','completed','failed','interrupted')),
        session_id       TEXT,
        model            TEXT,
        reason           TEXT,
        duration_ms      INTEGER,
        num_turns        INTEGER,
        input_tokens     INTEGER,
        output_tokens    INTEGER,
        cost_usd         REAL,
        queued_at        TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX ix_agent_runs_status ON agent_runs (company_id, status);
      CREATE INDEX ix_agent_runs_agent  ON agent_runs (company_id, agent_id, queued_at);
    `,
  },
  {
    version: 5,
    name: "tasks_projection_and_run_kinds",
    sql: `
      CREATE TABLE tasks (
        task_id         TEXT PRIMARY KEY,
        task_num        INTEGER NOT NULL UNIQUE,
        company_id      TEXT NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT,
        status          TEXT NOT NULL DEFAULT 'triage' CHECK (status IN
          ('triage','todo','doing','review','done','dropped')),
        assignee_id     TEXT,
        assignee_kind   TEXT CHECK (assignee_kind IN ('human','agent')),
        origin_event_id TEXT,
        pr_number       INTEGER,
        pr_url          TEXT,
        branch          TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX ix_tasks_status ON tasks (company_id, status, task_num);

      ALTER TABLE agent_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
      ALTER TABLE agent_runs ADD COLUMN task_id TEXT;
    `,
  },
];
