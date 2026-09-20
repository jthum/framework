import { nanoid } from "nanoid";
import type { WorkspaceClient } from "@jthum/framework/client";
import type {
  CollectionDefinition,
  CollectionLifecycleDefinition,
  Spec,
} from "@jthum/framework/spec";
import type {
  CollectionActions,
  CollectionDraft,
  FieldDraft,
  LifecycleDraft,
} from "./authoring.js";
import { labelFromKey } from "./editor-data.js";
import {
  fieldDefinitionFromDraft,
  fieldDraftFromDefinition,
  removeFieldDefinition,
} from "./field-adapter.js";
import { editorContextFromSpec, type EditorContextOptions } from "./context-adapter.js";

export interface CollectionAuthoringOptions extends EditorContextOptions {
  /** Called with the committed Spec so hosts can refresh reactive state without another read. */
  readonly onChange?: (spec: Spec) => void | Promise<void>;
}

export type NewCollectionDraft = Omit<CollectionDraft, "id"> & { readonly id?: string };

/** Create one canonical Collection from the same friendly model used by authoring. */
export async function createCollection(
  client: WorkspaceClient,
  input: NewCollectionDraft,
  options: CollectionAuthoringOptions = {},
): Promise<CollectionDefinition> {
  const workspace = await client.getWorkspace();
  if (workspace.spec.collections.some((collection) => collection.key === input.key))
    throw new Error(`Collection key ${input.key} is already in use.`);
  const identity: CollectionDraft = {
    ...input,
    id: input.id ?? nanoid(),
    fields: input.fields.map((field) => ({ ...field, id: field.id || nanoid() })),
  };
  const existing = editorContextFromSpec(workspace.spec, options).collections;
  const sources = [...existing, { ...identity, fields: [] }];
  const fields = identity.fields.map((field) =>
    fieldDefinitionFromDraft(field, identity.fields, sources),
  );
  const base: CollectionDefinition = {
    id: identity.id,
    key: identity.key,
    label: identity.label,
    ...(identity.collection_label ? { collectionLabel: identity.collection_label } : {}),
    ...(identity.description ? { description: identity.description } : {}),
    ...(identity.meta ? { meta: structuredClone(identity.meta) } : {}),
    fields,
  };
  const collection: CollectionDefinition = {
    ...base,
    ...(identity.lifecycle ? { lifecycle: lifecycleDefinition(identity.lifecycle, base) } : {}),
  };
  const updated = await client.applySpec({
    ...workspace.spec,
    collections: [...workspace.spec.collections, collection],
  });
  await options.onChange?.(updated.spec);
  return collection;
}

/**
 * Bind the reusable Collection editor to one context-bound Workspace client.
 *
 * Every mutation reads the current Spec before applying its focused transform. The client remains
 * the authorization and persistence boundary; this layer owns only the authoring projection.
 */
export function createCollectionActions(
  client: WorkspaceClient,
  options: CollectionAuthoringOptions = {},
): CollectionActions {
  const change = async (transform: (spec: Spec) => Spec): Promise<void> => {
    const workspace = await client.getWorkspace();
    const updated = await client.applySpec(transform(workspace.spec));
    await options.onChange?.(updated.spec);
  };
  const sources = (spec: Spec): CollectionDraft[] =>
    editorContextFromSpec(spec, options).collections;

  return {
    save: (draft) =>
      change((spec) => ({
        ...spec,
        collections: spec.collections.map((collection) =>
          collection.key === draft.key
            ? {
                ...collection,
                ...(draft.label === undefined ? {} : { label: draft.label }),
                ...(draft.collection_label === undefined
                  ? {}
                  : { collectionLabel: draft.collection_label || undefined }),
                ...(draft.lifecycle === undefined
                  ? {}
                  : {
                      lifecycle:
                        draft.lifecycle === null
                          ? undefined
                          : lifecycleDefinition(draft.lifecycle, collection),
                    }),
              }
            : collection,
        ),
      })),
    rename: (key, next) =>
      change((spec) => {
        if (spec.collections.some((collection) => collection.key === next))
          throw new Error(`Collection key ${next} is already in use.`);
        return {
          ...spec,
          collections: spec.collections.map((collection) =>
            collection.key === key ? { ...collection, key: next } : collection,
          ),
          views: spec.views.map((view) => (view.source === key ? { ...view, source: next } : view)),
        };
      }),
    renameField: (collectionKey, key, next) =>
      change((spec) => ({
        ...spec,
        collections: spec.collections.map((collection) => {
          if (collection.key !== collectionKey) return collection;
          if (collection.fields.some((field) => field.key === next))
            throw new Error(`Field key ${next} is already in use.`);
          return {
            ...collection,
            fields: collection.fields.map((field) =>
              field.key === key ? { ...field, key: next } : field,
            ),
          };
        }),
      })),
    saveField: (collectionKey, patch) =>
      change((spec) => {
        const collection = requireCollection(spec, collectionKey);
        const previous = collection.fields.find((field) => field.key === patch.key);
        const drafts = collection.fields.map((field) =>
          fieldDraftFromDefinition(field, collection.fields, sources(spec)),
        );
        const priorDraft = drafts.find((field) => field.key === patch.key);
        const draft: FieldDraft = {
          ...(priorDraft ?? {
            id: nanoid(),
            key: patch.key,
            label: labelFromKey(patch.key),
            type: "text",
          }),
          ...patch,
          label: patch.label || priorDraft?.label || labelFromKey(patch.key),
          type: patch.type ?? priorDraft?.type ?? "text",
        };
        const siblings = previous
          ? drafts.map((field) => (field.id === previous.id ? draft : field))
          : [...drafts, draft];
        const definition = fieldDefinitionFromDraft(draft, siblings, sources(spec), previous);
        return replaceCollection(spec, collectionKey, {
          ...collection,
          fields: previous
            ? collection.fields.map((field) => (field.id === previous.id ? definition : field))
            : [...collection.fields, definition],
        });
      }),
    reorderFields: (collectionKey, keys) =>
      change((spec) => {
        const collection = requireCollection(spec, collectionKey);
        const byKey = new Map(collection.fields.map((field) => [field.key, field]));
        if (keys.length !== collection.fields.length || keys.some((key) => !byKey.has(key)))
          throw new Error("Field order must contain every Collection Field exactly once.");
        return replaceCollection(spec, collectionKey, {
          ...collection,
          fields: keys.map((key) => byKey.get(key)!),
        });
      }),
    deleteField: (collectionKey, key) =>
      change((spec) => {
        const collection = requireCollection(spec, collectionKey);
        const field = collection.fields.find((candidate) => candidate.key === key);
        if (!field) throw new Error(`Field ${key} is unavailable.`);
        return replaceCollection(spec, collectionKey, {
          ...collection,
          fields: removeFieldDefinition(collection.fields, field.id),
        });
      }),
    remove: (key) =>
      change((spec) => ({
        ...spec,
        collections: spec.collections.filter((collection) => collection.key !== key),
      })),
  };
}

function requireCollection(spec: Spec, key: string): CollectionDefinition {
  const collection = spec.collections.find((candidate) => candidate.key === key);
  if (!collection) throw new Error(`Collection ${key} is unavailable.`);
  return collection;
}

function replaceCollection(spec: Spec, key: string, replacement: CollectionDefinition): Spec {
  return {
    ...spec,
    collections: spec.collections.map((collection) =>
      collection.key === key ? replacement : collection,
    ),
  };
}

function lifecycleDefinition(
  draft: LifecycleDraft,
  collection: CollectionDefinition,
): CollectionLifecycleDefinition {
  const field = collection.fields.find((candidate) => candidate.key === draft.field);
  if (!field) throw new Error(`Lifecycle Field ${draft.field} is unavailable.`);
  return {
    fieldId: field.id,
    initial: draft.initial,
    ...(draft.terminal ? { terminal: [...draft.terminal] } : {}),
    transitions: draft.transitions.map((transition) => {
      const previous = collection.lifecycle?.transitions.find(
        (candidate) => candidate.id === transition.id || candidate.key === transition.key,
      );
      return {
        id: transition.id ?? previous?.id ?? nanoid(),
        key: transition.key,
        label: transition.label,
        from: [...transition.from],
        to: transition.to,
      };
    }),
  };
}
