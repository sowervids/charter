# ADR 0004 — Web stack (Phase 1)

**Status:** accepted · 2026-07-03

## Decision

`apps/web` is Vite + React + Tailwind v4, deliberately lean:

| Dep | Why |
|---|---|
| `react` / `react-dom` | the UI |
| `cmdk` | the `Cmd+K` palette (ships Phase 0 of the UI per the interface plan) |
| `lucide-react` | icons — sizes 14/16/18, stroke 1.5 only (UI rule 10) |
| `@fontsource/ibm-plex-{sans,mono,serif}` | the Book of Record type system, bundled — no CDN, works offline, $0 |
| `tailwindcss` + `@tailwindcss/vite` | tokens live in one `@theme` block in `globals.css` |
| `@vitejs/plugin-react`, `vite` (dev) | build |

**Deliberately omitted for now:** react-router (a ~40-line internal view switch covers 3 screens), TanStack Query (the store is a single SSE-fed reducer; server cache invalidation doesn't exist when every change arrives as an event), shadcn/Radix (nothing in Phase 1 needs a floating primitive beyond cmdk's own dialog; Radix pieces arrive with the Inspector/Approvals in later phases), virtualization (timeline fetch is capped at 200 events; revisit at the 5k-message performance gate).

Each omission is a "duplicate twice before extracting" call — add the dependency when the second real need appears, with an ADR update.
