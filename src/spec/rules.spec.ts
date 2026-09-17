import { describe, expect, it } from "vite-plus/test";
import type { Spec } from "./model.js";
import { validateSpec } from "./validate.js";
import { ruleSpec } from "../testing/rule-fixture.js";

describe("portable Rule Spec", () => {
  it("accepts structured Actions, predicates, loops, and nested Rule invocation", () => {
    expect(validateSpec(ruleSpec())).toEqual([]);
  });

  it("rejects duplicate step identities and unresolved definition references", () => {
    const spec = ruleSpec();
    const invalid: Spec = {
      ...spec,
      rules: [
        {
          ...spec.rules[0]!,
          input: { project: { sourceId: "missing-source" } },
          steps: [
            { id: "same", action: { key: "records.create" } },
            { id: "same", invoke: { ruleId: "missing-rule" } },
          ],
        },
        spec.rules[1]!,
      ],
    };

    expect(validateSpec(invalid)).toContainEqual(
      expect.objectContaining({ code: "SPEC.ID_DUPLICATE" }),
    );
    const unresolved: Spec = {
      ...invalid,
      rules: [{ ...invalid.rules[0]!, steps: [invalid.rules[0]!.steps[1]!] }, invalid.rules[1]!],
    };
    expect(validateSpec(unresolved)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "SPEC.REFERENCE_UNRESOLVED" })]),
    );
  });

  it("rejects ambiguous predicates and non-portable bindings", () => {
    const spec = structuredClone(ruleSpec()) as unknown as {
      rules: Array<Record<string, unknown>>;
    };
    spec.rules[0]!.steps = [
      {
        id: "step-bad",
        gate: {
          predicate: { all: [], op: "always" },
          pass: [
            {
              id: "step-action",
              action: { key: "records.create", input: { value: { $ref: "outside.value" } } },
            },
          ],
        },
      },
    ];

    expect(validateSpec(spec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPEC.PROPERTY_CONFLICT" }),
        expect.objectContaining({ code: "SPEC.TYPE_INVALID" }),
      ]),
    );
  });
});
