import { ulid } from "ulid";

export function newEventId(): string {
  return `evt_${ulid()}`;
}
