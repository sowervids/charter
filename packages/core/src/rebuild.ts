import type { Db } from "./db.js";
import type { Projector } from "./projections/types.js";
import { PROJECTORS } from "./projections/registry.js";
import { rowToEvent, type EventRow } from "./rows.js";

const CHUNK = 1000;

function rebuildOne(db: Db, projector: Projector): void {
  const tx = db.transaction(() => {
    projector.truncate(db);
    db.prepare(
      `INSERT INTO projection_state (name, version, last_seq)
       VALUES (?, ?, 0)
       ON CONFLICT(name) DO UPDATE SET version = excluded.version, last_seq = 0`,
    ).run(projector.name, projector.version);

    const page = db.prepare(
      "SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?",
    );
    let after = 0;
    for (;;) {
      const rows = page.all(after, CHUNK) as EventRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const event = rowToEvent(row);
        if (projector.types.includes(event.type)) {
          projector.apply(db, event);
        }
        after = event.seq;
      }
    }
    db.prepare("UPDATE projection_state SET last_seq = ? WHERE name = ?").run(
      after,
      projector.name,
    );
  });
  tx.immediate();
}

/** Rebuild all projections, or one by name. Returns the names rebuilt. */
export function rebuild(db: Db, name?: string): string[] {
  const targets = name
    ? PROJECTORS.filter((p) => p.name === name)
    : [...PROJECTORS];
  if (name && targets.length === 0) {
    throw new Error(
      `Unknown projection "${name}". Known: ${PROJECTORS.map((p) => p.name).join(", ")}`,
    );
  }
  for (const projector of targets) rebuildOne(db, projector);
  return targets.map((p) => p.name);
}

/**
 * Bring projections in line with the registry: missing or version-mismatched
 * projectors are rebuilt from the log. Call after migrate() at startup.
 */
export function ensureProjections(db: Db): string[] {
  const rebuilt: string[] = [];
  for (const projector of PROJECTORS) {
    const state = db
      .prepare("SELECT version FROM projection_state WHERE name = ?")
      .get(projector.name) as { version: number } | undefined;
    if (state === undefined || state.version !== projector.version) {
      rebuildOne(db, projector);
      rebuilt.push(projector.name);
    }
  }
  return rebuilt;
}
