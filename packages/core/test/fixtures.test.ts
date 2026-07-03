import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEventPayload } from "@charter/schema";

/**
 * The fixture corpus (ADR 0002): one frozen sample of every event shape ever
 * emitted. If any fixture stops parsing, months of history just became
 * unreadable — fix the schema/upcaster, never the fixture.
 */
const fixturesDir = fileURLToPath(
  new URL("../../../fixtures/events/", import.meta.url),
);

describe("fixture corpus", () => {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  it("has at least one fixture", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`replays ${file}`, () => {
      const fixture = JSON.parse(
        readFileSync(new URL(file, `file://${fixturesDir}`), "utf8"),
      ) as { type: string; payload: unknown };
      expect(() =>
        parseEventPayload(fixture.type, fixture.payload),
      ).not.toThrow();
    });
  }
});
