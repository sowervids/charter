# BUS-FACTOR.md — if the founder is unavailable

Everything that matters is in two places: **this repo** (public: github.com/sowervids/charter) and **`var/charter.db`** (the company's event log — the single source of truth; backups in `var/backups/` and Time Machine).

## Run it

```sh
pnpm install && pnpm build
pnpm charter doctor          # substrate health: node, claude, chain, daemon
node apps/server/dist/bin.js # prints http://127.0.0.1:4614/?token=…  → open it
```

Agents need a Claude subscription logged into the `claude` CLI on this machine. No other credentials are required to READ everything.

## Restore from backup

```sh
mkdir -p newroot/var newroot/company
cp company/company.json newroot/company/
cp var/backups/charter-<latest>.db newroot/var/charter.db
cd newroot && pnpm charter rebuild && pnpm charter verify
```

Drilled regularly by `scripts/chaos-drill.sh`; budget is 30 minutes, actual is seconds.

## Where the money stands

Treasury (`/treasury` in the UI) is a **mirror** — Charter never holds or moves money. Real accounts are the founder's own Stripe/Mercury; read-only keys live ONLY in `var/secrets.env` (chmod 600, never in git, never visible to agents). Every historical cent is in the `ledger_*` projections and reproducible from the event log alone (`pnpm charter rebuild`).

## What agents can and cannot do

Agents run under deny-by-default policies (`company/agents/*/policy.json`), enforced server-side via the PreToolUse hook. They cannot merge PRs, push to main, or move money — those need a human. Pause everything: kill charterd (`launchctl unload ~/Library/LaunchAgents/com.charter.charterd.plist` or kill the pid in `var/charterd.pid`).

**launchd caveat (macOS TCC):** the LaunchAgent hangs on first file access until `node` is granted Full Disk Access once (System Settings → Privacy & Security), because the repo lives under `~/Documents`. Until that grant, run the daemon manually: `node apps/server/dist/bin.js`.

## Decisions of record

The event log IS the journal: `pnpm charter tail -n 200 --stream channel:devlog`, or the Log view in the UI. Architecture decisions are in `docs/adr/`. The build plan that produced all of this: `~/.claude/plans/modular-shimmying-fiddle.md`.
