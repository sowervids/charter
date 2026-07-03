# Charter — Engineering Constitution

Charter is a local-first company OS. The append-only event log is the ONLY source of truth; every surface (chat, tasks, approvals, ledger) is a rebuildable projection. Agents are first-class members whose every consequential action is policy-gated and journaled.

## Commands

```sh
pnpm check                 # lint + build + test + dependency boundaries — run before ANY PR
pnpm charter init          # create company + db (var/charter.db)
pnpm charter note "..."    # append a devlog.note event
pnpm charter tail          # live-stream the event log
pnpm charter rebuild       # rebuild projections from the log
pnpm charter verify        # verify the hash chain
```

## Module boundaries (CI-enforced by dependency-cruiser — do not fight them)

```
schema  → imports NO workspace package (it is the contract)
core    → imports only schema
policy  → imports only schema
ledger / agents / integrations → import core+schema, NEVER each other
mcp     → imports only schema (dumb HTTP proxy to charterd)
apps/server → composes everything
apps/web    → talks HTTP + SSE only; may import schema types
```

If you need a cross-package import that violates this, the design is wrong — open a task instead.

## Engineering rules

1. **Events are immutable.** Never mutate or delete a row in `events`. A correction is a new event. New meaning ⇒ new event type or new versioned type name, never a repurposed field.
2. **Every event schema change ships in the same PR as its upcaster + a frozen fixture** in `fixtures/events/`. CI replays the full fixture corpus; history must never become unreadable.
3. **Projections are pure functions of the log.** No wall-clock reads, no network, no randomness inside a projector. The clock is read once, at append.
4. **All DB writes go through `packages/core`.** If you are importing `better-sqlite3` anywhere else, stop (CI will fail you anyway).
5. **All model/runtime invocation goes through the AgentRuntime seam** (`packages/agents`). Never spawn `claude` from feature code.
6. **No new runtime dependencies without an ADR** in `docs/adr/`. Prefer the standard library.
7. **No abstractions for single call sites.** Duplicate twice before extracting.
8. **Files >400 lines and functions >60 lines are a smell** — split before merging.
9. **Agent-facing rule: PRs ≤ ~200 changed LOC.** If the task needs more, comment on the task proposing a split and stop.
10. **Fail loudly at boundaries** (append, spawn, network). Never swallow errors. Every agent-run failure must produce an `agent.run_failed` event.
11. **Run `pnpm check` before opening any PR.** Never open a red PR.
12. **Secrets never enter agent workspaces.** Stripe/Mercury keys live only in charterd's environment (`var/secrets.env`, chmod 600).

## UI rules (apply to apps/web from Phase 1)

1. **Tokens only.** Colors, spacing, radii, durations come from the `@theme` variables in `globals.css`. A hex literal outside `globals.css` is a bug. No arbitrary Tailwind values (`p-[13px]`), no palette colors (`bg-zinc-800`).
2. **Three states minimum.** Every data-loading view ships loading, empty (with a next action), and error states in the same PR.
3. **Skeletons mirror layout; spinners are last resort.** Skeletons appear after 150ms, persist ≥300ms.
4. **Type ramp only** (7 variants; data numerals always mono + `tabular-nums`).
5. **Motion: `transform`/`opacity` only, 120–200ms, tokens, `prefers-reduced-motion` respected.** The agent presence ring is the only ambient animation.
6. **Keyboard complete.** Every interactive element Tab-reachable with the accent focus ring; every new action registered in the `Cmd+K` palette in the same PR.
7. **Optimistic by default.** User mutations render immediately; reconciliation must produce zero visual jump.
8. **Provenance is mandatory.** Agent-generated content renders through `<Provenance>`/`<ArtifactFrame>` — never visually indistinguishable from human input.
9. **One component, everywhere.** Identical objects (approval, task chip, budget meter) use the identical component in every container. New components get a `/dev/gallery` entry in the same PR.
10. **Icons: Lucide only, sizes 14/16/18, stroke 1.5**, colored only by semantic state tokens.

## Adding a new feature — the groove

Every feature follows one shape: **new event type(s) in `schema` → projector in `core` → (later) MCP tool in the server → UI projection**. If a feature doesn't fit this shape, question the feature.
