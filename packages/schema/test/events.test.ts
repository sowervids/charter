import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  isEventType,
  newEventId,
  parseEventPayload,
} from "../src/index.js";

describe("event payload registry", () => {
  it("accepts a valid devlog.note payload", () => {
    const parsed = parseEventPayload("devlog.note", {
      note: "hello",
      tags: ["a"],
    });
    expect(parsed).toEqual({ note: "hello", tags: ["a"] });
  });

  it("rejects an unknown event type with a pointer to the registry", () => {
    expect(() => parseEventPayload("nope.nope", {})).toThrow(/EVENT_PAYLOADS/);
  });

  it("rejects a malformed payload with the failing path", () => {
    expect(() => parseEventPayload("devlog.note", { note: "" })).toThrow(
      /note/,
    );
  });

  it("type guard agrees with the registry", () => {
    expect(isEventType("devlog.note")).toBe(true);
    expect(isEventType("devlog.nope")).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("drops undefined values and preserves array order", () => {
    expect(canonicalJson({ a: [2, 1], b: undefined })).toBe('{"a":[2,1]}');
  });
});

describe("ids", () => {
  it("mints prefixed, unique, sortable ids", () => {
    const a = newEventId();
    const b = newEventId();
    expect(a).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
  });
});
