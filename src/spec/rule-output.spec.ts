import { describe, expect, it } from "vite-plus/test";
import { createEmptySpec } from "./model.ts";
import { ruleOutputMismatch } from "./rule-output.ts";
import { validateSpec } from "./validate.ts";

describe("Rule output contracts", () => {
  it("checks declared fields while allowing undeclared integration data", () => {
    const contract = {
      type: "object" as const,
      fields: {
        verdict: { type: "text" as const, required: true },
        scores: { type: "array" as const, items: { type: "number" as const } },
      },
    };
    expect(
      ruleOutputMismatch(contract, { verdict: "yes", scores: [1, 2], provider: {} }),
    ).toBeNull();
    expect(ruleOutputMismatch(contract, { scores: [1] })).toBe("output.verdict is required.");
    expect(ruleOutputMismatch(contract, { verdict: "yes", scores: [1, "two"] })).toBe(
      "output.scores.1 must be number.",
    );
  });

  it("rejects malformed portable contracts and resultless Rule outputs", () => {
    const spec = createEmptySpec({ id: "spec", key: "spec", label: "Spec" });
    const invalid = {
      ...spec,
      rules: [
        {
          id: "rule",
          key: "rule",
          label: "Rule",
          output: { type: "object", items: { type: "text" } },
          steps: [
            { id: "action", action: { key: "test.action", output: { type: "array", fields: {} } } },
          ],
        },
      ],
    };
    expect(validateSpec(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "rules.0.output", code: "SPEC.PROPERTY_CONFLICT" }),
        expect.objectContaining({ path: "rules.0.output.items", code: "SPEC.TYPE_INVALID" }),
        expect.objectContaining({
          path: "rules.0.steps.0.action.output.fields",
          code: "SPEC.TYPE_INVALID",
        }),
      ]),
    );
  });
});
