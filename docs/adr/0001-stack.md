# ADR 0001 — Stack

**Status:** accepted · 2026-07-02

## Decision

TypeScript everywhere, Node ≥22, pnpm workspaces. SQLite via `better-sqlite3` as the event store. No ORM, no migration framework, no build tooling beyond `tsc`.

Approved runtime dependencies:

| Dep | Where | Why |
|---|---|---|
| `zod` | schema | runtime validation of every event payload at append |
| `ulid` | schema | sortable event IDs |
| `better-sqlite3` | core ONLY | synchronous API makes "append + project in one transaction" trivially correct; WAL survives kill -9 |
| `commander` | cli | argument parsing |

Dev: `vitest`, `fast-check` (property tests are the crown jewels), `eslint`/`typescript-eslint`, `dependency-cruiser` (mechanical boundary enforcement).

## Why SQLite over local Postgres

Single-writer topology is the design, not a limitation — all writes flow through one process for policy + hash-chain reasons anyway. Zero ops on a founder's Mac. Backup is a file copy. If Charter is ever hosted, the event log replays into Postgres; the rebuild machinery doubles as the migration path.

## Why one language

The whole integration surface is JS-native (MCP SDK, NDJSON stream parsing, SSE, React). Agents dogfooding on this repo hold one mental model.
