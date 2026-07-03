import { ulid } from "ulid";

export function newEventId(): string {
  return `evt_${ulid()}`;
}

export function newRunId(): string {
  return `run_${ulid()}`;
}
