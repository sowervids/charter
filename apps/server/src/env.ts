import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  EventLog,
  ensureProjections,
  migrate,
  openDb,
  type Db,
} from "@charter/core";

export interface CompanyConfig {
  id: string;
  name: string;
}

export interface ServerContext {
  root: string;
  db: Db;
  log: EventLog;
  company: CompanyConfig;
  token: string;
}

const MARKER = join("company", "company.json");

export function findRoot(start = process.cwd()): string | null {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load or mint the local API token (var/api_token, chmod 600). */
export function loadToken(root: string): string {
  const path = join(root, "var", "api_token");
  if (existsSync(path)) {
    return readFileSync(path, "utf8").trim();
  }
  mkdirSync(join(root, "var"), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

export function openServerContext(root: string): ServerContext {
  const company = JSON.parse(
    readFileSync(join(root, MARKER), "utf8"),
  ) as CompanyConfig;
  mkdirSync(join(root, "var"), { recursive: true });
  const db = openDb(join(root, "var", "charter.db"));
  migrate(db);
  ensureProjections(db);
  return { root, db, log: new EventLog(db), company, token: loadToken(root) };
}
