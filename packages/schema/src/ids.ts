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

export function newApprovalId(): string {
  return `apr_${ulid()}`;
}

export function newEntryId(): string {
  return `ent_${ulid()}`;
}

export function newProposalId(): string {
  return `pay_${ulid()}`;
}
