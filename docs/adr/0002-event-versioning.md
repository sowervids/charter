# ADR 0002 — Event immutability and versioning

**Status:** accepted · 2026-07-02

## Rules

1. The `events` table is append-only. No UPDATE, no DELETE, ever. Corrections are new events.
2. The **envelope** (seq, id, company_id, stream, stream_seq, type, actor, payload, refs, visibility, hash chain, created_at) is forever. Semantics live in `type` + `payload`, not in new envelope columns.
3. Payload changes are **additive only** (new optional field). A breaking change is a **new type name** (e.g. `task.created_v2`) plus an upcaster — a pure function `oldShape → newShape` applied at read time.
4. Every event type ever emitted has a frozen sample in `fixtures/events/`. CI replays the whole corpus through current schemas/upcasters. This test is the guarantee that months of history never become unreadable.
5. Projections are disposable: `charter rebuild` truncates and replays. Read-model mistakes are cheap; only the envelope and emitted payloads are permanent.
6. The hash chain (`hash_prev`/`hash_self`, per company) makes the log tamper-evident. `charter verify` walks it.

## Migration files

Plain SQL, embedded as TypeScript modules in `packages/core/src/migrations/` (deviation from "plain .sql files on disk": embedding avoids a copy-files build step and keeps `dist` self-contained; the SQL itself remains plain strings).
