import { nanoid } from "nanoid";
import type { WorkspaceClient } from "@jthum/framework/client";
import type { Spec } from "@jthum/framework/spec";
import type { CollectionDraft, FormActions, FormDraft } from "./authoring.js";
import { labelFromKey } from "./editor-data.js";
import {
  formDefinitionFromDraft,
  formDraftFromDefinition,
  prepareFormField,
} from "./form-adapter.js";

export interface FormAuthoringOptions {
  readonly sources: readonly CollectionDraft[];
  readonly onChange?: (spec: Spec) => void | Promise<void>;
}

/** Bind the reusable Form editor to one context-bound Workspace client. */
export function createFormActions(
  client: WorkspaceClient,
  options: FormAuthoringOptions,
): FormActions {
  return {
    prepareField: prepareFormField,
    save: async (patch) => {
      const workspace = await client.getWorkspace();
      const previous = workspace.spec.forms.find((form) => form.key === patch.key);
      const base: FormDraft = previous
        ? formDraftFromDefinition(previous, workspace.spec, options.sources)
        : {
            id: patch.id ?? nanoid(),
            key: patch.key,
            label: patch.label ?? labelFromKey(patch.key),
            mode: patch.mode,
          };
      const draft: FormDraft = {
        ...base,
        ...patch,
        id: previous?.id ?? base.id,
        label: patch.label ?? base.label,
      };
      const definition = formDefinitionFromDraft(draft, workspace.spec, options.sources, previous);
      const updated = await client.applySpec({
        ...workspace.spec,
        forms: previous
          ? workspace.spec.forms.map((form) => (form.id === previous.id ? definition : form))
          : [...workspace.spec.forms, definition],
      });
      await options.onChange?.(updated.spec);
      return definition;
    },
    remove: async (key) => {
      const workspace = await client.getWorkspace();
      const updated = await client.applySpec({
        ...workspace.spec,
        forms: workspace.spec.forms.filter((form) => form.key !== key),
      });
      await options.onChange?.(updated.spec);
    },
  };
}
