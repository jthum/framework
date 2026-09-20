import { nanoid } from "nanoid";
import type { WorkspaceClient } from "@jthum/framework/client";
import type { Spec } from "@jthum/framework/spec";
import type { ViewActions, ViewDraft } from "./authoring.js";
import { labelFromKey } from "./editor-data.js";
import {
  viewDefinitionFromDraft,
  viewDraftFromDefinition,
  type ViewAuthoringSchemas,
} from "./view-adapter.js";

export interface ViewAuthoringOptions {
  readonly schemas: ViewAuthoringSchemas;
  /** Called with the committed Spec so hosts can refresh reactive state without another read. */
  readonly onChange?: (spec: Spec) => void | Promise<void>;
}

/** Bind the reusable View editor to one context-bound Workspace client. */
export function createViewActions(
  client: WorkspaceClient,
  options: ViewAuthoringOptions,
): ViewActions {
  return {
    save: async (patch) => {
      const workspace = await client.getWorkspace();
      const previous = workspace.spec.views.find((view) => view.key === patch.key);
      const base: ViewDraft = previous
        ? viewDraftFromDefinition(previous, options.schemas)
        : {
            id: patch.id ?? nanoid(),
            key: patch.key,
            label: patch.label ?? labelFromKey(patch.key),
            source: patch.source ?? "",
            fields: patch.fields ?? [],
          };
      const draft: ViewDraft = {
        ...base,
        ...patch,
        id: previous?.id ?? base.id,
        label: patch.label ?? base.label,
        source: patch.source ?? base.source,
        fields: patch.fields ?? base.fields,
      };
      const definition = viewDefinitionFromDraft(draft, options.schemas);
      const updated = await client.applySpec({
        ...workspace.spec,
        views: previous
          ? workspace.spec.views.map((view) => (view.id === previous.id ? definition : view))
          : [...workspace.spec.views, definition],
      });
      await options.onChange?.(updated.spec);
      return definition;
    },
    remove: async (key) => {
      const workspace = await client.getWorkspace();
      const updated = await client.applySpec({
        ...workspace.spec,
        views: workspace.spec.views.filter((view) => view.key !== key),
      });
      await options.onChange?.(updated.spec);
    },
    query: async (draft, filters) => {
      const view = viewDefinitionFromDraft(draft, options.schemas);
      const parameters = Object.fromEntries(
        (draft.expose ?? []).flatMap((field) => {
          const value = filters[field];
          if (value === undefined || value === "") return [];
          return [[draft.parameters?.[field]?.key ?? field.replaceAll(".", "_"), value]];
        }),
      );
      const result = await client.previewView(view, { parameters });
      return result.data.rows.map((row) => ({ id: row.id, ...row.values }));
    },
  };
}
