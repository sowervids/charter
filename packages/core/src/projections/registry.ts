import type { Projector } from "./types.js";
import { channelsProjector } from "./channels.js";
import { devlogProjector } from "./devlog.js";

/** Every projector in the system. Order is irrelevant; each is independent. */
export const PROJECTORS: readonly Projector[] = [
  devlogProjector,
  channelsProjector,
];
