import { ulid } from "ulid";

export function newEventId(): string {
  return `evt_${ulid()}`;
}

export function newRunId(): string {
  return `run_${ulid()}`;
}

export function newTaskId(): string {
  return `tsk_${ulid()}`;
}
