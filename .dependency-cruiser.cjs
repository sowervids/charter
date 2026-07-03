/**
 * Module boundary contract (see docs/adr/0003-module-boundaries.md).
 * These rules are the mechanical enforcement of the architecture —
 * a violation fails CI, no exceptions.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "schema-imports-no-workspace-packages",
      comment: "@charter/schema is the shared contract; it depends on nothing in the workspace",
      severity: "error",
      from: { path: "^packages/schema" },
      to: { path: "^(packages/(?!schema)|apps/)" },
    },
    {
      name: "core-imports-only-schema",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^(packages/(?!schema|core)|apps/)" },
    },
    {
      name: "domain-packages-never-import-each-other",
      comment: "policy/ledger/agents/integrations compose only inside apps/server",
      severity: "error",
      from: { path: "^packages/(policy|ledger|agents|integrations)" },
      to: {
        path: "^packages/(policy|ledger|agents|integrations)",
        pathNot: "^packages/$1",
      },
    },
    {
      name: "mcp-is-a-dumb-proxy",
      comment: "the moment mcp touches core/db, policy enforcement forks into two codepaths",
      severity: "error",
      from: { path: "^packages/mcp" },
      to: { path: "^(packages/(?!schema|mcp)|apps/)" },
    },
    {
      name: "only-core-touches-sqlite",
      comment: "one write path, forever",
      severity: "error",
      from: { pathNot: "^packages/core" },
      to: { path: "node_modules/better-sqlite3" },
    },
    {
      name: "web-never-imports-server-internals",
      severity: "error",
      from: { path: "^apps/web" },
      to: { path: "^(apps/(server|cli)|packages/(?!schema))" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    exclude: { path: "\\.(test|spec)\\.ts$" },
  },
};
