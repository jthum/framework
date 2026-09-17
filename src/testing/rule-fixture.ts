import type { RuleDefinition, Spec } from "../spec/model.js";
import { createEmptySpec } from "../spec/model.js";

export function ruleSpec(): Spec {
  const empty = createEmptySpec({ id: "spec-rules", key: "rules", label: "Rules" });
  const followUp: RuleDefinition = {
    id: "rule-follow-up",
    key: "follow_up",
    label: "Follow up",
    input: { project: { sourceId: "collection-project" } },
    steps: [{ id: "step-note", action: { key: "notifications.send" } }],
  };
  const route: RuleDefinition = {
    id: "rule-route-project",
    key: "route_project",
    label: "Route project",
    enabled: true,
    input: { project: { sourceId: "collection-project" } },
    trigger: {
      event: "record.field_changed",
      sourceId: "collection-project",
      fieldId: "field-status",
    },
    expose: ["ui", "agent"],
    steps: [
      {
        id: "step-gate",
        gate: {
          predicate: {
            all: [
              {
                op: "context.equals",
                left: { $ref: "vars.project", fieldId: "field-status" },
                value: "approved",
              },
            ],
          },
          pass: [
            {
              id: "step-update",
              action: {
                key: "records.update",
                input: {
                  record: { $ref: "vars.project" },
                  values: { "field-status": "active" },
                },
                runAs: "trigger",
                retry: { max: 2, backoff: [1] },
                compensate: { key: "records.update", input: { record: { $ref: "vars.project" } } },
              },
            },
            { id: "step-follow-up", invoke: { ruleId: followUp.id } },
          ],
        },
      },
    ],
  };
  return {
    ...empty,
    collections: [
      {
        id: "collection-project",
        key: "project",
        label: "Project",
        fields: [{ id: "field-status", key: "status", label: "Status", type: "text" }],
      },
    ],
    rules: [route, followUp],
  };
}
