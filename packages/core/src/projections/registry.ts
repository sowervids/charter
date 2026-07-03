import type { Projector } from "./types.js";
import { agentRunsProjector } from "./agentRuns.js";
import { approvalsProjector } from "./approvals.js";
import { channelsProjector } from "./channels.js";
import { devlogProjector } from "./devlog.js";
import { ledgerProjector } from "./ledger.js";
import { tasksProjector } from "./tasks.js";

/** Every projector in the system. Order is irrelevant; each is independent. */
export const PROJECTORS: readonly Projector[] = [
  devlogProjector,
  channelsProjector,
  agentRunsProjector,
  tasksProjector,
  approvalsProjector,
  ledgerProjector,
];
