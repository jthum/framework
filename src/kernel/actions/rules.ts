import { type ActionDefinition } from "../action-registry.ts";
import { type CoreActionPorts } from "./ports.ts";
import { type IdGenerator } from "../defaults.ts";
import { type JsonValue, type RuleDefinition } from "../../spec/model.ts";
import { actionTool, actionInputError, isJsonObject } from "./values.ts";

export function rulesActions(
  ports: Pick<CoreActionPorts, "listRules" | "ids" | "requireWorkspace" | "applySpec">,
): readonly ActionDefinition[] {
  return [
    {
      key: "rules.list",
      tool: {
        ...actionTool(
          "List rules",
          "Read canonical Rules, including stable IDs and steps, before editing one.",
          {},
        ),
        availability: "discoverable",
      },
      run: async ({ context }) => {
        return (await ports.listRules(context)) as unknown as JsonValue;
      },
    },
    {
      key: "rules.save",
      tool: {
        ...actionTool(
          "Save rule",
          "Create or replace one canonical Rule. Preserve its stable ID when editing; step and branch IDs are generated when omitted. Validation and Spec permissions still apply.",
          {
            rule: {
              type: "object",
              description:
                "Canonical Rule definition with key, label, inputs, steps, and optional result.",
              additionalProperties: true,
            },
          },
          ["rule"],
        ),
        availability: "discoverable",
      },
      run: async ({ context, input }) => {
        if (context.scope)
          throw actionInputError(
            "Rules in a scoped Spec cannot be saved through this Workspace Action.",
          );
        if (input.rule === undefined || !isJsonObject(input.rule))
          throw actionInputError("Action input rule must be an object.");
        const rule = withRuleIds(input.rule, ports.ids) as unknown as RuleDefinition;
        const workspace = await ports.requireWorkspace(context.workspaceId);
        const rules = workspace.spec.rules.some((candidate) => candidate.id === rule.id)
          ? workspace.spec.rules.map((candidate) => (candidate.id === rule.id ? rule : candidate))
          : [...workspace.spec.rules, rule];
        await ports.applySpec(context, { ...workspace.spec, rules });
        return { id: rule.id, key: rule.key, label: rule.label };
      },
    },
  ];
}

function withRuleIds(
  value: Readonly<Record<string, JsonValue>>,
  ids: IdGenerator,
): Record<string, JsonValue> {
  const rule = structuredClone(value) as Record<string, JsonValue>;
  if (rule.id === undefined) rule.id = ids.create("definition");
  const visit = (steps: JsonValue | undefined): void => {
    if (!Array.isArray(steps)) return;
    for (const item of steps) {
      if (!isJsonObject(item)) continue;
      const step = item as Record<string, JsonValue>;
      if (step.id === undefined) step.id = ids.create("definition");
      for (const kind of ["gate", "wait", "foreach", "repeat", "parallel"]) {
        const config = step[kind];
        if (!config || !isJsonObject(config)) continue;
        if (kind === "gate") {
          visit(config.pass);
          visit(config.fail);
        }
        if (kind === "wait") {
          visit(config.onSignal);
          visit(config.onTimeout);
        }
        if (kind === "foreach" || kind === "repeat") visit(config.steps);
        if (kind === "parallel" && Array.isArray(config.branches))
          for (const value of config.branches) {
            if (!isJsonObject(value)) continue;
            const branch = value as Record<string, JsonValue>;
            if (branch.id === undefined) branch.id = ids.create("definition");
            visit(branch.steps);
          }
      }
    }
  };
  visit(rule.steps);
  return rule;
}
