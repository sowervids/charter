import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfig } from "./types.js";

export interface TaskRow {
  task_id: string;
  task_num: number;
  title: string;
  body: string | null;
  status: string;
  assignee_id: string | null;
}

/** Interim guardrail until the Phase 4 policy engine: task runs get exactly
 *  this allowlist. Note `git push origin agent/*` — agents can only push
 *  agent branches; main is unreachable even before branch protection. */
export function taskAllowedTools(): string[] {
  return [
    "Read",
    "Glob",
    "Grep",
    "Edit",
    "Write",
    "Bash(git status*)",
    "Bash(git diff*)",
    "Bash(git log*)",
    "Bash(git add*)",
    "Bash(git commit*)",
    "Bash(git push -u origin agent/*)",
    "Bash(git push origin agent/*)",
    "Bash(gh pr create*)",
    "Bash(pnpm *)",
    "Bash(node *)",
    "Bash(ls*)",
    "Bash(mkdir *)",
  ];
}

export function branchName(agent: AgentConfig, taskNum: number): string {
  return `agent/${agent.id}/task-${taskNum}`;
}

/** Worktrees live OUTSIDE the live checkout — an agent can never corrupt
 *  the running system's working tree. */
export function worktreePath(repoRoot: string, taskNum: number): string {
  return join(dirname(repoRoot), "charter-worktrees", `task-${taskNum}`);
}

export function prepareWorktree(
  repoRoot: string,
  agent: AgentConfig,
  taskNum: number,
): string {
  const path = worktreePath(repoRoot, taskNum);
  if (existsSync(path)) return path;
  const branch = branchName(agent, taskNum);
  const branchExists =
    execFileSync(
      "git",
      ["-C", repoRoot, "branch", "--list", branch],
      { encoding: "utf8" },
    ).trim().length > 0;
  execFileSync(
    "git",
    branchExists
      ? ["-C", repoRoot, "worktree", "add", path, branch]
      : ["-C", repoRoot, "worktree", "add", "-b", branch, path, "main"],
    { stdio: "pipe" },
  );
  return path;
}

/** Post-run diff-size check (the ~200-LOC guardrail, advisory until Phase 4). */
export function diffStat(
  worktree: string,
): { files: number; insertions: number; deletions: number } {
  const out = execFileSync(
    "git",
    ["-C", worktree, "diff", "main", "--shortstat"],
    { encoding: "utf8" },
  ).trim();
  const files = Number(/(\d+) files? changed/.exec(out)?.[1] ?? 0);
  const insertions = Number(/(\d+) insertions?/.exec(out)?.[1] ?? 0);
  const deletions = Number(/(\d+) deletions?/.exec(out)?.[1] ?? 0);
  return { files, insertions, deletions };
}

export function extractPrUrl(text: string): { url: string; number: number } | null {
  const match = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/.exec(
    text,
  );
  if (match === null) return null;
  return { url: match[0], number: Number(match[1]) };
}

export function buildTaskPrompt(options: {
  agent: AgentConfig;
  companyName: string;
  task: TaskRow;
  branch: string;
}): string {
  const { agent, companyName, task, branch } = options;
  return `You are ${agent.name} (@${agent.id}), ${agent.role} at ${companyName}.

Your charter:
${agent.charter.trim()}

You have been assigned task CH-${task.task_num}: ${task.title}
${task.body ? `\nDetails / acceptance criteria:\n${task.body}\n` : ""}
You are in a dedicated git worktree on branch \`${branch}\`. The repo's CLAUDE.md governs — read it first and follow its engineering rules exactly.

Do this, in order:
1. Read CLAUDE.md and the relevant code. Plan the smallest change that completes the task.
2. Implement it. Keep the total diff under ~200 changed lines — if the task genuinely needs more, STOP, do not implement; instead output exactly: SPLIT-REQUIRED: <one-paragraph proposal for how to split the task>.
3. Run \`pnpm check\`. Fix what it surfaces. Never proceed with a red check.
4. Commit with a clear message, push with \`git push -u origin ${branch}\`.
5. Open a PR: \`gh pr create --title "CH-${task.task_num}: ${task.title}" --body "<what and why, 2-4 sentences>. Closes task CH-${task.task_num}."\`
6. Your FINAL output line must be the PR URL alone.`;
}
