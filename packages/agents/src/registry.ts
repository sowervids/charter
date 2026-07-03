import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types.js";

interface AgentFile {
  name: string;
  role: string;
  model?: string;
  max_turns?: number;
  daily_runs?: number;
  max_wall_ms?: number;
}

/** Load the roster from company/agents/<id>/{agent.json,charter.md}. */
export function loadRegistry(root: string): Map<string, AgentConfig> {
  const agentsDir = join(root, "company", "agents");
  const registry = new Map<string, AgentConfig>();
  if (!existsSync(agentsDir)) return registry;

  for (const id of readdirSync(agentsDir)) {
    const dir = join(agentsDir, id);
    const configPath = join(dir, "agent.json");
    const charterPath = join(dir, "charter.md");
    if (!existsSync(configPath) || !existsSync(charterPath)) continue;
    const file = JSON.parse(readFileSync(configPath, "utf8")) as AgentFile;
    registry.set(id, {
      id,
      name: file.name,
      role: file.role,
      model: file.model ?? "sonnet",
      max_turns: file.max_turns ?? 8,
      daily_runs: file.daily_runs ?? 30,
      max_wall_ms: file.max_wall_ms ?? 5 * 60_000,
      charter: readFileSync(charterPath, "utf8"),
    });
  }
  return registry;
}

/** @mention extraction: only ids that exist in the registry count. */
export function extractMentions(
  body: string,
  registry: Map<string, AgentConfig>,
): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/@([a-z0-9][a-z0-9-]*)/g)) {
    const id = match[1];
    if (id !== undefined && registry.has(id)) found.add(id);
  }
  return [...found];
}
