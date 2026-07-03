#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";
import { buildServer } from "./server.js";
import { findRoot, openServerContext } from "./env.js";

const PORT = Number(process.env["CHARTER_PORT"] ?? 4614);

const root = findRoot();
if (root === null) {
  console.error(
    "Not inside a Charter company (no company/company.json). Run `charter init` first.",
  );
  process.exit(1);
}

const ctx = openServerContext(root);

// Bank sources: real ones activate when keys exist in var/secrets.env;
// the mock source stands in until then ($0 mirror mode).
const { MockBankSource, StripeSource, MercurySource } = await import(
  "@charter/integrations"
);
const { registerLedger } = await import("./ledgerRoutes.js");
const secretsPath = join(root, "var", "secrets.env");
const secrets: Record<string, string> = {};
if (existsSync(secretsPath)) {
  for (const line of readFileSync(secretsPath, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("#")) {
      secrets[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
}
const bankSources = [
  ...(secrets["STRIPE_API_KEY"] ? [new StripeSource(secrets["STRIPE_API_KEY"])] : []),
  ...(secrets["MERCURY_API_TOKEN"]
    ? [new MercurySource(secrets["MERCURY_API_TOKEN"])]
    : []),
  ...(existsSync(join(root, "fixtures", "bank", "mock-txns.json"))
    ? [new MockBankSource(join(root, "fixtures", "bank", "mock-txns.json"))]
    : []),
];

const { loadRegistry } = await import("@charter/agents");
const registry = loadRegistry(root);
const app = buildServer(ctx, {
  roster: [...registry.values()].map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    kind: "agent" as const,
  })),
});

// Serve the built web app when it exists (production mode). In dev, Vite
// serves the UI and proxies /api here.
const webDist = join(root, "apps", "web", "dist");
if (existsSync(webDist)) {
  const { default: fastifyStatic } = await import("@fastify/static");
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.sendFile("index.html");
  });
}

registerLedger(app, ctx, bankSources);

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(
  `${styleText("bold", "charterd")} — ${ctx.company.name} (${ctx.company.id})`,
);
console.log(
  `  ${styleText("cyan", `http://127.0.0.1:${PORT}/?token=${ctx.token}`)}`,
);
console.log(styleText("dim", `  ${ctx.log.lastSeq()} events in the log`));

// The agent orchestrator lives inside charterd: mentions trigger runs,
// runs journal to the same log the UI streams from.
if (process.env["CHARTER_AGENTS"] !== "0") {
  const { ClaudeCliRuntime, Orchestrator } = await import("@charter/agents");
  if (registry.size > 0) {
    const orchestrator = new Orchestrator({
      db: ctx.db,
      log: ctx.log,
      companyId: ctx.company.id,
      companyName: ctx.company.name,
      registry,
      runtime: new ClaudeCliRuntime(),
      agentsHome: join(root, "agents-home"),
      repoRoot: root,
      hookUrl: `http://127.0.0.1:${PORT}/hooks/pretooluse?token=${ctx.token}`,
    });
    orchestrator.start();
    console.log(
      styleText(
        "dim",
        `  agents on duty: ${[...registry.keys()].map((id) => `@${id}`).join(", ")}`,
      ),
    );
  }
}
