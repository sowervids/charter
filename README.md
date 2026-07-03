# Charter

**The operating system companies are born on.**

Charter is a local-first company OS where humans and AI agents are the same kind of member. Everything that happens — every message, task, agent action, and ledger entry — is an immutable event in one append-only log. Chat, the task board, the approval queue, and the books are projections of that log.

Charter's first company is the company building Charter. From Phase 3 onward, its own development runs on its own board, with agents doing the work through policy-gated, human-approved actions.

## Status

Phase 0 — the spine: event log, hash chain, projections, CLI.

## Structure

```
packages/schema    shared contract: Zod schemas for every event, policy, DTO
packages/core      event log: append, hash chain, projections, migrations, rebuild
apps/cli           charter command: init, note, append, tail, rebuild, verify
company/           versioned company config (agents, policies — later phases)
var/               runtime state (SQLite db, logs) — gitignored
```

## Development

```sh
pnpm install
pnpm check          # lint + build + test + dependency boundaries
pnpm charter init   # create the company + database
pnpm charter note "hello"
pnpm charter tail   # live-stream the event log
```

See `CLAUDE.md` for the engineering rules and `docs/adr/` for architecture decisions.
