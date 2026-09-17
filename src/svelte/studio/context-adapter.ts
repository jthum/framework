import type {
  CollectionDefinition,
  FormDefinition,
  SourceDefinition,
  Spec,
} from "@jthum/framework/spec";
import type { CollectionDraft, EditorContext, FormDraft, LifecycleDraft } from "./authoring.js";
import { fieldDraftFromDefinition } from "./field-adapter.js";
import { ruleDraftFromDefinition } from "./rule-adapter.js";
import {
  localViewSchemas,
  viewDraftFromDefinition,
  type ViewAuthoringSchemas,
} from "./view-adapter.js";

export interface EditorContextOptions {
  /** Concrete schemas for attached Sources, keyed by their local binding key. */
  readonly schemas?: ViewAuthoringSchemas;
}

/**
 * Project a portable Spec into Studio's key-oriented working model.
 *
 * Attached Sources are included when their concrete schemas are supplied. The
 * adapter is deliberately strict: Studio must not silently discard canonical
 * properties it cannot faithfully represent.
 */
export function editorContextFromSpec(
  spec: Spec,
  options: EditorContextOptions = {},
): EditorContext {
  const schemas = { ...options.schemas, ...localViewSchemas(spec) };
  const identities = [
    ...spec.collections.map((collection) => collectionIdentity(collection)),
    ...spec.sources.map((source) => sourceIdentity(source, schemas[source.key])),
  ];
  const collections = [
    ...spec.collections.map((collection) => collectionDraft(collection, identities)),
    ...spec.sources.flatMap((source) => {
      const schema = schemas[source.key];
      return schema ? [sourceDraft(source, schema, identities)] : [];
    }),
  ];
  return {
    collections,
    views: spec.views.map((view) => viewDraftFromDefinition(view, schemas)),
    forms: spec.forms.map((form) => formDraft(form, spec, identities)),
    rules: spec.rules.map((rule) => ruleDraftFromDefinition(rule, spec)),
  };
}

function collectionIdentity(collection: CollectionDefinition): CollectionDraft {
  return {
    id: collection.id,
    key: collection.key,
    label: collection.label,
    fields: [],
  };
}

function sourceIdentity(
  source: SourceDefinition,
  schema: CollectionDefinition | undefined,
): CollectionDraft {
  return {
    id: source.id,
    key: source.key,
    label: source.label,
    fields: [],
    ...(schema ? {} : { description: source.description }),
  };
}

function collectionDraft(
  collection: CollectionDefinition,
  sources: readonly CollectionDraft[],
): CollectionDraft {
  const fields = collection.fields.map((field) =>
    fieldDraftFromDefinition(field, collection.fields, sources),
  );
  return {
    id: collection.id,
    key: collection.key,
    label: collection.label,
    ...(collection.description ? { description: collection.description } : {}),
    ...(collection.meta ? { meta: structuredClone(collection.meta) } : {}),
    fields,
    ...(collection.lifecycle
      ? { lifecycle: lifecycleDraft(collection, collection.lifecycle.fieldId) }
      : {}),
  };
}

function sourceDraft(
  source: SourceDefinition,
  schema: CollectionDefinition,
  sources: readonly CollectionDraft[],
): CollectionDraft {
  const projected = collectionDraft(schema, sources);
  return {
    ...projected,
    id: source.id,
    key: source.key,
    label: source.label,
    ...(source.description ? { description: source.description } : {}),
    ...(source.meta ? { meta: structuredClone(source.meta) } : {}),
  };
}

function lifecycleDraft(collection: CollectionDefinition, fieldId: string): LifecycleDraft {
  const lifecycle = collection.lifecycle!;
  const field = collection.fields.find((candidate) => candidate.id === fieldId);
  if (!field) throw new Error(`Lifecycle Field ${fieldId} is unavailable.`);
  return {
    field: field.key,
    initial: lifecycle.initial,
    ...(lifecycle.terminal ? { terminal: [...lifecycle.terminal] } : {}),
    transitions: lifecycle.transitions.map((transition) => ({
      id: transition.id,
      key: transition.key,
      label: transition.label,
      from: [...transition.from],
      to: transition.to,
    })),
  };
}

function formDraft(
  form: FormDefinition,
  spec: Spec,
  sources: readonly CollectionDraft[],
): FormDraft {
  const identity = {
    id: form.id,
    key: form.key,
    label: form.label,
    ...(form.description ? { description: form.description } : {}),
    ...(form.meta ? { meta: structuredClone(form.meta) } : {}),
    ...(form.submit ? { submit: structuredClone(form.submit) } : {}),
  };
  if (form.mode === "standalone")
    return {
      ...identity,
      mode: form.mode,
      inputs: form.fields.map((field) => fieldDraftFromDefinition(field, form.fields, sources)),
    };
  const collection = spec.collections.find((candidate) => candidate.id === form.collectionId);
  if (!collection) throw new Error(`Form Collection ${form.collectionId} is unavailable.`);
  return {
    ...identity,
    mode: form.mode,
    type: collection.key,
    fields: form.fieldIds.map((id) => {
      const field = collection.fields.find((candidate) => candidate.id === id);
      if (!field) throw new Error(`Form Field ${id} is unavailable.`);
      return field.key;
    }),
  };
}
