import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Write the PreToolUse HTTP hook into a workspace so every Bash/Edit/Write
 * an agent attempts is pre-flighted against charterd's policy endpoint.
 * settings.local.json is used in git worktrees (gitignored — never part of
 * an agent's diff); plain settings.json in agents-home workspaces.
 */
export function writeHookSettings(options: {
  dir: string;
  hookUrl: string;
  local: boolean;
}): void {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash|Edit|Write",
          hooks: [{ type: "http", url: options.hookUrl, timeout: 10 }],
        },
      ],
    },
  };
  const dir = join(options.dir, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, options.local ? "settings.local.json" : "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}
