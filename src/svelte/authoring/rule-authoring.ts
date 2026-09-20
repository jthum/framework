import { nanoid } from "nanoid";
import type { WorkspaceClient } from "@jthum/framework/client";
import type { RuleDefinition, Spec } from "@jthum/framework/spec";
import type { RuleActions, RuleDraft } from "./rule-model.js";
import {
  ruleDefinitionFromDraft,
  ruleDraftFromDefinition,
  type RuleAuthoringSchemas,
} from "./rule-adapter.js";

export interface RuleAuthoringOptions {
  readonly schemas?: RuleAuthoringSchemas;
  readonly onChange?: (spec: Spec) => void | Promise<void>;
}

export type NewRuleDraft = Omit<RuleDraft, "id"> & { readonly id?: string };

/** Create one canonical Rule from the friendly model used by authoring. */
export async function createRule(
  client: WorkspaceClient,
  input: NewRuleDraft,
  options: RuleAuthoringOptions = {},
): Promise<RuleDefinition> {
  const actions = createRuleActions(client, options);
  return (await actions.save({
    ...input,
    id: input.id || nanoid(),
  } as RuleDraft)) as RuleDefinition;
}

/** Bind the reusable Rule editor to one context-bound Workspace client. */
export function createRuleActions(
  client: WorkspaceClient,
  options: RuleAuthoringOptions = {},
): RuleActions {
  return {
    save: async (patch) => {
      const workspace = await client.getWorkspace();
      const previous = workspace.spec.rules.find((rule) => rule.key === patch.key);
      const base = previous
        ? ruleDraftFromDefinition(previous, workspace.spec, options.schemas)
        : patch;
      const draft: RuleDraft = {
        ...base,
        ...patch,
        id: previous?.id ?? (patch.id || nanoid()),
      };
      const definition = ruleDefinitionFromDraft(draft, workspace.spec, options.schemas);
      const updated = await client.applySpec({
        ...workspace.spec,
        rules: previous
          ? workspace.spec.rules.map((rule) => (rule.id === previous.id ? definition : rule))
          : [...workspace.spec.rules, definition],
      });
      await options.onChange?.(updated.spec);
      return definition;
    },
    remove: async (key) => {
      const workspace = await client.getWorkspace();
      const updated = await client.applySpec({
        ...workspace.spec,
        rules: workspace.spec.rules.filter((rule) => rule.key !== key),
      });
      await options.onChange?.(updated.spec);
    },
  };
}
