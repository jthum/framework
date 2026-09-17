import { describe, expect, it } from "vite-plus/test";
import { ruleSpec } from "../testing/rule-fixture.js";
import { checkRuleCompatibility } from "./rule-compatibility.js";

describe("Rule runtime compatibility", () => {
  it("separates portable validity from installed execution support", () => {
    const rule = ruleSpec().rules[0]!;
    const compatibility = checkRuleCompatibility(rule, {
      key: "browser",
      label: "Browser",
      actions: new Set(["records.update"]),
      events: new Set(["record.field_changed"]),
      conditions: new Set(["context.equals"]),
      capabilities: {
        retries: "emulated",
        compensation: "supported",
        nested_rules: "supported",
      },
      notes: { retries: "Retries end when this tab closes." },
    });

    expect(compatibility).toMatchObject({
      compatible: true,
      requiredActions: ["records.update"],
      requiredCapabilities: ["retries", "compensation", "nested_rules"],
      diagnostics: [
        {
          kind: "capability",
          key: "retries",
          support: "emulated",
          message: "Retries end when this tab closes.",
        },
      ],
    });
  });

  it("blocks execution when an Event or Action adapter is absent", () => {
    const compatibility = checkRuleCompatibility(ruleSpec().rules[0]!, {
      key: "minimal",
      label: "Minimal runtime",
      actions: new Set(),
      events: new Set(),
      conditions: new Set(),
      capabilities: {},
    });

    expect(compatibility.compatible).toBe(false);
    expect(compatibility.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "event", key: "record.field_changed" }),
        expect.objectContaining({ kind: "action", key: "records.update" }),
        expect.objectContaining({ kind: "condition", key: "context.equals" }),
      ]),
    );
  });
});
