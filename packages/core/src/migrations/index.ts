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
  {
    version: 6,
    name: "approvals_projection",
    sql: `
      CREATE TABLE approvals (
        approval_id   TEXT PRIMARY KEY,
        company_id    TEXT NOT NULL,
        run_id        TEXT NOT NULL,
        agent_id      TEXT NOT NULL,
        tool          TEXT NOT NULL,
        input_summary TEXT NOT NULL,
        payload_hash  TEXT NOT NULL,
        rule          TEXT NOT NULL,
        status        TEXT NOT NULL CHECK (status IN
          ('pending','allowed','denied','consumed','expired')),
        note          TEXT,
        expires_at    TEXT NOT NULL,
        requested_at  TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX ix_approvals_status ON approvals (company_id, status, requested_at);
      CREATE INDEX ix_approvals_hash   ON approvals (company_id, payload_hash, status);
    `,
  },
  {
    version: 7,
    name: "ledger_projections",
    sql: `
      CREATE TABLE ledger_accounts (
        account_id   TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL,
        name         TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN
          ('asset','liability','equity','revenue','expense')),
        currency     TEXT NOT NULL,
        external_ref TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE TABLE ledger_entries (
        entry_id   TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        memo       TEXT NOT NULL,
        source_kind TEXT,
        source_ref  TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE ledger_lines (
        entry_id     TEXT NOT NULL,
        line_no      INTEGER NOT NULL,
        company_id   TEXT NOT NULL,
        account_id   TEXT NOT NULL,
        direction    TEXT NOT NULL CHECK (direction IN ('debit','credit')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        currency     TEXT NOT NULL,
        PRIMARY KEY (entry_id, line_no)
      );
      CREATE INDEX ix_ledger_lines_account ON ledger_lines (company_id, account_id);
      CREATE TABLE external_txns (
        source       TEXT NOT NULL,
        external_id  TEXT NOT NULL,
        company_id   TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency     TEXT NOT NULL,
        occurred_at  TEXT NOT NULL,
        description  TEXT NOT NULL,
        matched_entry_id TEXT,
        PRIMARY KEY (source, external_id)
      );
      CREATE TABLE payment_proposals (
        proposal_id  TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency     TEXT NOT NULL,
        memo         TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN
          ('proposed','sent','confirmed','rejected')),
        proposed_by  TEXT NOT NULL,
        confirmed_external_id TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
    `,
  },
];
