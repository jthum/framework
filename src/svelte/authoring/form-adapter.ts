import { nanoid } from "nanoid";
import type { FormDefinition, Spec } from "@jthum/framework/spec";
import type { CollectionDraft, FieldDraft, FormDraft } from "./authoring.js";
import { labelFromKey } from "./editor-data.js";
import { fieldDefinitionFromDraft, fieldDraftFromDefinition } from "./field-adapter.js";
import { isAuthoringManaged, withAuthoringManaged } from "./authoring-meta.js";

/** Convert one canonical Form into the authoring interface's key-oriented working model. */
export function formDraftFromDefinition(
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
    ...(isAuthoringManaged(form.meta) ? { implicit: true } : {}),
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

/** Convert an authoring draft to a canonical Form while retaining stable identity. */
export function formDefinitionFromDraft(
  draft: FormDraft,
  spec: Spec,
  sources: readonly CollectionDraft[],
  previous?: FormDefinition,
): FormDefinition {
  const identity = {
    id: previous?.id ?? draft.id,
    key: draft.key,
    label: draft.label,
    ...(draft.description ? { description: draft.description } : {}),
    ...(withAuthoringManaged(draft.meta, draft.implicit)
      ? { meta: withAuthoringManaged(draft.meta, draft.implicit) }
      : {}),
    ...(draft.submit ? { submit: structuredClone(draft.submit) } : {}),
  };
  if (draft.mode === "standalone") {
    const prior = previous?.mode === "standalone" ? previous.fields : [];
    const inputs = draft.inputs ?? [];
    return {
      ...identity,
      mode: draft.mode,
      fields: inputs.map((field) =>
        fieldDefinitionFromDraft(
          field,
          inputs,
          sources,
          prior.find((candidate) => candidate.id === field.id),
        ),
      ),
    };
  }
  const collection = spec.collections.find((candidate) => candidate.key === draft.type);
  if (!collection) throw new Error(`Form Collection ${draft.type ?? ""} is unavailable.`);
  return {
    ...identity,
    mode: draft.mode,
    collectionId: collection.id,
    fieldIds: (draft.fields ?? []).map((key) => {
      const field = collection.fields.find((candidate) => candidate.key === key);
      if (!field) throw new Error(`Form Field ${key} is unavailable.`);
      return field.id;
    }),
  };
}

/** Assign the identity and defaults needed by the shared standalone-Field sheet. */
export function prepareFormField(
  key: string,
  patch: Partial<FieldDraft>,
  previous?: FieldDraft,
): FieldDraft {
  return {
    ...(previous ?? {
      id: nanoid(),
      key,
      label: labelFromKey(key),
      type: "text" as const,
    }),
    ...patch,
    id: previous?.id ?? patch.id ?? nanoid(),
    key,
    label: patch.label || previous?.label || labelFromKey(key),
    type: patch.type ?? previous?.type ?? "text",
  };
}
