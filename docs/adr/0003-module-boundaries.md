# ADR 0003 — Module boundaries

**Status:** accepted · 2026-07-02

## The contract

```
schema      the shared contract: Zod schemas + types for every event/policy/DTO.
            Imports NO workspace package.
core        event log: append, hash chain, projections, migrations, rebuild.
            Imports only schema. The ONLY package allowed to touch better-sqlite3.
policy      pure policy evaluation. Imports only schema.
ledger, agents, integrations
            domain packages. Import core + schema. NEVER each other —
            they compose only inside apps/server.
mcp         the stdio binary agent sessions consume. A dumb HTTP proxy to
            charterd. Imports only schema. The moment it touches the DB,
            policy enforcement forks into two codepaths.
apps/server charterd: composes everything. HTTP API, SSE, hook endpoints.
apps/web    browser client. HTTP + SSE only; may import schema types.
apps/cli    thin over core/server.
```

## Enforcement

Mechanical, not aspirational: `dependency-cruiser` rules in `.dependency-cruiser.cjs` run in CI (`pnpm depcruise`). An agent-authored PR that violates a boundary fails CI without human vigilance.

All cross-domain communication happens as **events through core** or **HTTP through charterd**. If a feature seems to require a forbidden import, the design is wrong — open a task.
