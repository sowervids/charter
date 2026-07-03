import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PolicyDoc, actionHash, evaluate } from "../src/evaluate.js";

const arbTool = fc.constantFrom("Bash", "Edit", "Write", "Read", "Glob", "WebFetch");
const arbAction = fc.record({
  tool: arbTool,
  input: fc.record({
    command: fc.string({ maxLength: 60 }),
    file_path: fc.string({ maxLength: 40 }),
  }),
});

function doc(rules: Partial<PolicyDoc["rules"]>): PolicyDoc {
  return PolicyDoc.parse({ version: 1, rules });
}

describe("policy evaluator — the trust boundary (properties)", () => {
  it("DENY BY DEFAULT: with no rules, no action is ever allowed", () => {
    fc.assert(
      fc.property(arbAction, (action) => {
        expect(evaluate(doc({}), action).decision).toBe("deny");
      }),
    );
  });

  it("an action not matching any allow/hold rule is denied, whatever else exists", () => {
    fc.assert(
      fc.property(
        arbAction,
        fc.array(fc.constantFrom("Bash(git status*)", "Read", "Glob"), {
          maxLength: 3,
        }),
        (action, allow) => {
          const result = evaluate(doc({ allow }), {
            tool: "WebFetch", // never in the allow vocabulary above
            input: action.input,
          });
          expect(result.decision).toBe("deny");
        },
      ),
    );
  });

  it("deny beats hold beats allow, for the same matching pattern", () => {
    const action = { tool: "Bash", input: { command: "git push origin main" } };
    const pattern = "Bash(git push*)";
    expect(
      evaluate(doc({ deny: [pattern], approval_required: [pattern], allow: [pattern] }), action)
        .decision,
    ).toBe("deny");
    expect(
      evaluate(doc({ approval_required: [pattern], allow: [pattern] }), action).decision,
    ).toBe("hold");
    expect(evaluate(doc({ allow: [pattern] }), action).decision).toBe("allow");
  });

  it("adding an allow rule never widens an UNRELATED permission", () => {
    fc.assert(
      fc.property(arbAction, (action) => {
        const before = evaluate(doc({ allow: ["Read"] }), action);
        const after = evaluate(doc({ allow: ["Read", "Bash(git status)"] }), action);
        // Only the exact new grant may flip deny→allow.
        if (before.decision === "deny" && after.decision === "allow") {
          expect(action.tool).toBe("Bash");
          expect(action.input.command).toBe("git status");
        }
      }),
    );
  });

  it("prefix patterns match prefixes only", () => {
    const policy = doc({ allow: ["Bash(git push origin agent/*)"] });
    expect(
      evaluate(policy, { tool: "Bash", input: { command: "git push origin agent/ship/task-1" } })
        .decision,
    ).toBe("allow");
    expect(
      evaluate(policy, { tool: "Bash", input: { command: "git push origin main" } }).decision,
    ).toBe("deny");
  });

  it("action hashes are payload-exact (any input change → different hash)", () => {
    fc.assert(
      fc.property(arbAction, arbAction, (a, b) => {
        const same =
          a.tool === b.tool &&
          JSON.stringify(a.input) === JSON.stringify(b.input);
        expect(actionHash(a) === actionHash(b)).toBe(same);
      }),
    );
  });
});
