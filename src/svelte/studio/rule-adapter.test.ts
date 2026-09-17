import { describe, expect, it } from "vite-plus/test";
import type { RuleDefinition } from "@jthum/framework/spec";
import { ruleSpec } from "../../testing/rule-fixture.js";
import { ruleDefinitionFromDraft, ruleDraftFromDefinition } from "./rule-adapter.js";

describe("Rule Studio adapter", () => {
  it("translates friendly create/update steps and compensation to executable canonical Actions", () => {
    const spec = ruleSpec();
    const draft = ruleDraftFromDefinition(spec.rules[1]!, spec);
    draft.steps = [
      {
        effect: {
          key: "records.create",
          params: { type: "project", fields: { status: "draft" } },
          as: "created",
          retry: { max: 2 },
          compensate: {
            key: "records.set",
            params: { record: { $ref: "vars.created" }, values: { status: "cancelled" } },
          },
        },
      },
    ];
    const canonical = ruleDefinitionFromDraft(draft, spec);
    expect(canonical.steps[0]).toMatchObject({
      action: {
        key: "records.create",
        input: { sourceId: "collection-project", values: { status: "draft" } },
        as: "created",
        retry: { max: 2 },
        compensate: { key: "records.update" },
      },
    });
    const again = ruleDraftFromDefinition(canonical, spec);
    expect(again.steps[0]).toMatchObject(draft.steps[0]!);
    expect(ruleDefinitionFromDraft(again, spec)).toEqual(canonical);
  });
  it("does not rewrite custom Action inputs or ambiguous canonical create inputs", () => {
    const spec = ruleSpec();
    const rule: RuleDefinition = {
      ...spec.rules[1]!,
      steps: [
        {
          id: "custom",
          action: { key: "billing.create", input: { type: "project", fields: { title: "keep" } } },
        },
        {
          id: "raw-create",
          action: {
            key: "records.create",
            input: { sourceId: "collection-project", type: "custom-value", values: {} },
          },
        },
      ],
    };
    expect(ruleDefinitionFromDraft(ruleDraftFromDefinition(rule, spec), spec)).toEqual(rule);
  });
  it("rejects unresolved and dynamic friendly create Sources instead of saving broken execution inputs", () => {
    const spec = ruleSpec();
    const draft = ruleDraftFromDefinition(spec.rules[1]!, spec);
    draft.steps = [{ effect: { key: "records.create", params: { type: "missing", fields: {} } } }];
    expect(() => ruleDefinitionFromDraft(draft, spec)).toThrow("unavailable");
    draft.steps = [
      { effect: { key: "records.create", params: { type: { $ref: "vars.type" }, fields: {} } } },
    ];
    expect(() => ruleDefinitionFromDraft(draft, spec)).toThrow("Choose a record Source");
  });
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
              { id: "step-update", effect: { key: "records.set", runAs: "trigger" } },
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
