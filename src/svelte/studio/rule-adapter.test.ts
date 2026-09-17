import { describe, expect, it } from "vite-plus/test";
import { ruleSpec } from "../../testing/rule-fixture.js";
import { ruleDefinitionFromDraft, ruleDraftFromDefinition } from "./rule-adapter.js";

describe("Rule Studio adapter", () => {
  it("preserves canonical ActorRequest Fields through the authoring round trip", () => {
    const spec = ruleSpec();
    const rule = {
      ...spec.rules[0]!,
      steps: [
        {
          id: "approval",
          wait: {
            request: {
              actor: "reviewer",
              label: "Approve",
              fields: [
                {
                  id: "approved",
                  key: "approved",
                  label: "Approved",
                  type: "boolean" as const,
                  required: true,
                },
              ],
            },
            as: "review",
          },
        },
      ],
    };
    expect(ruleDefinitionFromDraft(ruleDraftFromDefinition(rule, spec), spec)).toEqual(rule);
  });
  it("round-trips identity-based Rules through the key-oriented editor model", () => {
    const spec = ruleSpec();
    const rule = spec.rules[0]!;

    const draft = ruleDraftFromDefinition(rule, spec);

    expect(draft).toMatchObject({
      input: { project: { record: "project" } },
      trigger: { key: "project.status.changed" },
      steps: [
        {
          id: "step-gate",
          gate: {
            pass: [
              { id: "step-update", effect: { key: "records.update", runAs: "trigger" } },
              { id: "step-follow-up", invoke: { workflow: "follow_up" } },
            ],
          },
        },
      ],
    });
    expect(ruleDefinitionFromDraft(draft, spec)).toEqual(rule);
  });

  it("assigns stable identities when Studio adds new nested steps and branches", () => {
    const spec = ruleSpec();
    const draft = ruleDraftFromDefinition(spec.rules[1]!, spec);
    draft.steps = [
      { effect: { key: "null" } },
      {
        parallel: {
          branches: [
            { key: "first", steps: [{ delay: { duration: 1 } }] },
            { key: "second", steps: [] },
          ],
        },
      },
    ];

    const canonical = ruleDefinitionFromDraft(draft, spec);
    const ids = JSON.stringify(canonical).match(/[A-Za-z0-9_-]{21}/g) ?? [];

    expect(new Set(ids).size).toBe(5);
    expect(ruleDefinitionFromDraft(ruleDraftFromDefinition(canonical, spec), spec)).toEqual(
      canonical,
    );
  });
});
