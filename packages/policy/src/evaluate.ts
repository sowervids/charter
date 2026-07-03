import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@charter/schema";

/**
 * The policy document (company/agents/<id>/policy.json). Pure data, versioned
 * with the agent config in git — policy changes are PR-reviewable.
 *
 * Evaluation order is fixed and non-negotiable:
 *   explicit deny  >  approval_required (hold)  >  explicit allow  >  DENY.
 * Deny-by-default is the property the tests guarantee.
 */
export const PolicyDoc = z.object({
  version: z.number().int().positive(),
  rules: z.object({
    deny: z.array(z.string().min(1)).default([]),
    approval_required: z.array(z.string().min(1)).default([]),
    allow: z.array(z.string().min(1)).default([]),
  }),
});
export type PolicyDoc = z.infer<typeof PolicyDoc>;

export interface Action {
  /** Claude Code tool name: "Bash", "Edit", "Write", "Read", … */
  tool: string;
  /** The tool input; for Bash, input.command is what patterns match. */
  input: Record<string, unknown>;
}

export interface Decision {
  decision: "allow" | "deny" | "hold";
  /** The pattern that decided (absent for default-deny). */
  rule?: string;
}

/**
 * Pattern grammar (mirrors Claude Code permission rules):
 *   "Bash(git push*)"  — tool Bash, command prefix "git push"
 *   "Bash"             — any Bash command
 *   "Edit" / "Write"   — the whole tool
 *   "*"                — any tool (only meaningful in deny, and scary there)
 */
function matches(pattern: string, action: Action): boolean {
  if (pattern === "*") return true;
  const inner = /^([A-Za-z_]+)\((.*)\)$/.exec(pattern);
  if (inner === null) {
    return pattern === action.tool;
  }
  const [, tool, argPattern] = inner;
  if (tool !== action.tool) return false;
  const subject =
    action.tool === "Bash"
      ? String(action.input["command"] ?? "")
      : String(action.input["file_path"] ?? action.input["path"] ?? "");
  if (argPattern === undefined) return false;
  if (argPattern.endsWith("*")) {
    return subject.startsWith(argPattern.slice(0, -1));
  }
  return subject === argPattern;
}

export function evaluate(policy: PolicyDoc, action: Action): Decision {
  for (const rule of policy.rules.deny) {
    if (matches(rule, action)) return { decision: "deny", rule };
  }
  for (const rule of policy.rules.approval_required) {
    if (matches(rule, action)) return { decision: "hold", rule };
  }
  for (const rule of policy.rules.allow) {
    if (matches(rule, action)) return { decision: "allow", rule };
  }
  return { decision: "deny" }; // the default that makes everything else safe
}

/** Approvals are scoped to EXACTLY this action — a changed payload needs a
 *  fresh approval. */
export function actionHash(action: Action): string {
  return createHash("sha256")
    .update(canonicalJson({ tool: action.tool, input: action.input }))
    .digest("hex");
}

export function describeAction(action: Action): string {
  if (action.tool === "Bash") {
    return String(action.input["command"] ?? "(no command)").slice(0, 500);
  }
  const path = action.input["file_path"] ?? action.input["path"];
  return `${action.tool}${path !== undefined ? ` ${String(path)}` : ""}`.slice(0, 500);
}
