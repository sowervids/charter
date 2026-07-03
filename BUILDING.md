# Building Charter

## Prerequisites

- Node.js ≥ 22
- pnpm 11.9.0 (`npm i -g pnpm@11.9.0`)

## Install

```sh
pnpm install
```

## Check (lint + build + test + dep boundaries)

```sh
pnpm check
```

Run this before every PR. All must pass.

## Init the company

```sh
pnpm charter init          # creates company/company.json + var/charter.db
```

Only needed once per working directory.

## Run charterd (the server)

```sh
node apps/server/dist/bin.js
```

The server prints a URL with an auth token, e.g.:
`http://127.0.0.1:4614/?token=<token>`

Open that URL to use the UI. The port can be overridden with `CHARTER_PORT`.

## Dev workflow (UI hot-reload)

In one terminal, keep charterd running as above.
In a second terminal:

```sh
pnpm --filter @charter/web dev   # Vite on :5173, proxies /api to charterd
```

Then open `http://localhost:5173` instead.
