/**
 * Per-member identity: a stable hue per agent (the human/agent premise made
 * visible) and display helpers. Hues are applied via inline CSS variables,
 * not dynamic Tailwind classes, so nothing is purged.
 */
const AGENT_HUES = 8;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 1..8 for this agent id, stable across the app. */
export function agentHueIndex(id: string): number {
  return (hashId(id) % AGENT_HUES) + 1;
}

/** CSS value for the agent's hue, e.g. "var(--color-agent-3)". */
export function agentHueVar(id: string): string {
  return `var(--color-agent-${agentHueIndex(id)})`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export interface Identity {
  id: string;
  name: string;
  kind: "human" | "agent" | "system" | "integration";
}
