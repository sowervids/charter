import { channelStream, type NewEvent } from "@charter/schema";
import {
  EventLog,
  ensureProjections,
  migrate,
  openDb,
  type Db,
} from "../src/index.js";

export const COMPANY = "co_test";

export function freshLog(): { db: Db; log: EventLog } {
  const db = openDb(":memory:");
  migrate(db);
  ensureProjections(db);
  return { db, log: new EventLog(db) };
}

export function noteEvent(
  note: string,
  overrides: Partial<NewEvent> = {},
): NewEvent {
  return {
    company_id: COMPANY,
    stream: channelStream("devlog"),
    type: "devlog.note",
    actor: { kind: "human", id: "founder" },
    payload: { note },
    ...overrides,
  };
}

/** Deterministic, order-stable dump of a projection table for comparisons. */
export function dumpTable(db: Db, table: string): string {
  const rows = db
    .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
    .all() as Record<string, unknown>[];
  return JSON.stringify(rows);
}
