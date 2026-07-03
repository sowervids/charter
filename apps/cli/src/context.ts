import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function requireRoot(): string {
  const root = findRoot();
  if (root === null) {
    throw new Error(
      "Not inside a Charter company (no company/company.json found). Run `charter init` first.",
    );
  }
  return root;
}

export function createDefaultCompany(root: string): CompanyConfig {
  const config: CompanyConfig = { id: "co_charter", name: "Charter" };
  mkdirSync(join(root, "company"), { recursive: true });
  writeFileSync(
    join(root, MARKER),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  return config;
}

export function loadCompany(root: string): CompanyConfig {
  return JSON.parse(
    readFileSync(join(root, MARKER), "utf8"),
  ) as CompanyConfig;
}

export interface CharterContext {
  root: string;
  db: Db;
  log: EventLog;
  company: CompanyConfig;
}

export function openCharter(root: string): CharterContext {
  const company = loadCompany(root);
  mkdirSync(join(root, "var"), { recursive: true });
  const db = openDb(join(root, "var", "charter.db"));
  migrate(db);
  ensureProjections(db);
  return { root, db, log: new EventLog(db), company };
}
