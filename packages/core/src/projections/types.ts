import type { CommittedEvent } from "@charter/schema";
import type { Db } from "../db.js";

/**
 * A projector is a pure function of the log: no clock, no network, no
 * randomness (CLAUDE.md rule 3). `apply` runs inside the append transaction.
 * Bump `version` when apply logic changes; the store rebuilds automatically.
 */
export interface Projector {
  name: string;
  version: number;
  types: readonly string[];
  apply(db: Db, event: CommittedEvent): void;
  truncate(db: Db): void;
}
