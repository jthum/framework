import { nanoid } from "nanoid";
import type { FieldCondition, FieldDefinition, JsonValue } from "@jthum/framework/spec";
import {
  VALUE_SEMANTICS,
  type ValueSemantic,
  type CollectionDraft,
  type FieldCondition as DraftCondition,
  type FieldDraft,
} from "./authoring.js";
import { labelFromKey } from "./editor-data.js";

/** Removal must not silently erase another response field's conditional checks. */
export function removeFieldDefinition(
  fields: readonly FieldDefinition[],
  id: string,
): readonly FieldDefinition[] {
  const uses = (condition: FieldCondition): boolean => {
    if ("all" in condition) return condition.all.some(uses);
    if ("any" in condition) return condition.any.some(uses);
    if ("not" in condition) return uses(condition.not);
    return condition.fieldId === id;
  };
  const remaining = fields.filter((field) => field.id !== id);
  for (const field of remaining) {
    const checks = [
      field.behavior?.visibleWhen,
      field.behavior?.enabledWhen,
      field.behavior?.requiredWhen,
    ];
    if (checks.some((check) => check && uses(check)))
      throw new Error(`Update ${field.label}'s conditional checks before removing this field.`);
  }
  return remaining;
}

/** Shared field sheet bridge. Unedited canonical properties retain their identity and semantics. */
export function fieldDraftFromDefinition(
  field: FieldDefinition,
  siblings: readonly FieldDefinition[],
  sources: readonly CollectionDraft[],
): FieldDraft {
  if (field.type === "json")
    throw new Error("The shared field sheet does not yet edit JSON fields.");
  const condition = (value: FieldCondition): DraftCondition => {
    if ("all" in value) return { all: value.all.map(condition) };
    if ("any" in value) return { any: value.any.map(condition) };
    if ("not" in value) return { not: condition(value.not) };
    const sibling = siblings.find((item) => item.id === value.fieldId);
    if (!sibling) throw new Error(`Conditional Field ${value.fieldId} is unavailable.`);
    return {
      field: sibling.key,
      op: value.operator === "notEmpty" ? "not_empty" : value.operator,
      ...(value.value !== undefined ? { value: value.value } : {}),
    };
  };
  const presentation = field.meta?.presentation;
  const ui =
    presentation && typeof presentation === "object" && !Array.isArray(presentation)
      ? presentation
      : {};
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    description: field.description,
    type: field.type === "choice" ? "enum" : field.type,
    required: field.required,
    default: field.default,
    meta: field.meta,
    ...(field.type === "choice" ? { values: field.options.map((option) => option.key) } : {}),
    ...(field.type === "reference"
      ? { target: sources.find((source) => source.id === field.sourceId)?.key }
      : {}),
    ...("format" in field
      ? { format: field.format === "plain" || field.format === "number" ? undefined : field.format }
      : {}),
    ...(field.type === "number"
      ? {
          currency: field.currency,
          validation: {
            min: field.validation?.min,
            max: field.validation?.max,
            message: field.validation?.message,
          },
        }
      : {}),
    ...(field.type === "text"
      ? {
          validation: {
            min_length: field.validation?.minLength,
            max_length: field.validation?.maxLength,
            pattern: field.validation?.pattern,
            message: field.validation?.message,
          },
        }
      : {}),
    ...(typeof ui.placeholder === "string" ? { placeholder: ui.placeholder } : {}),
    ...(ui.presentation === "textarea" ||
    ui.presentation === "rating" ||
    ui.presentation === "badge"
      ? { presentation: ui.presentation }
      : {}),
    ...(ui.variant === "segments" ? { variant: ui.variant } : {}),
    ...(typeof ui.ratingMax === "number" ? { max: ui.ratingMax } : {}),
    ...(ui.valueSemantics &&
    typeof ui.valueSemantics === "object" &&
    !Array.isArray(ui.valueSemantics)
      ? {
          value_semantics: Object.fromEntries(
            Object.entries(ui.valueSemantics).filter(
              ([, value]) =>
                typeof value === "string" && VALUE_SEMANTICS.includes(value as ValueSemantic),
            ),
          ) as Record<string, ValueSemantic>,
        }
      : {}),
    ...(field.behavior?.visibleWhen ? { visible_when: condition(field.behavior.visibleWhen) } : {}),
    ...(field.behavior?.enabledWhen ? { enabled_when: condition(field.behavior.enabledWhen) } : {}),
    ...(field.behavior?.requiredWhen
      ? { required_when: condition(field.behavior.requiredWhen) }
      : {}),
    hidden_value: field.behavior?.hiddenValue,
  };
}

export function fieldDefinitionFromDraft(
  draft: FieldDraft,
  siblings: readonly Pick<FieldDraft, "id" | "key">[],
  sources: readonly CollectionDraft[],
  previous?: FieldDefinition,
): FieldDefinition {
  const condition = (value: DraftCondition): FieldCondition => {
    if ("all" in value) return { all: value.all.map(condition) };
    if ("any" in value) return { any: value.any.map(condition) };
    if ("not" in value) return { not: condition(value.not) };
    const sibling = siblings.find((item) => item.key === value.field);
    if (!sibling) throw new Error(`Conditional Field ${value.field} is unavailable.`);
    if (value.op === "in") {
      if (!Array.isArray(value.value)) throw new Error("The in condition requires a list.");
      return {
        any: value.value.map((item) => ({
          fieldId: sibling.id,
          operator: "eq",
          value: item as JsonValue,
        })),
      };
    }
    return {
      fieldId: sibling.id,
      operator: value.op === "not_empty" ? "notEmpty" : (value.op ?? "eq"),
      ...(value.value !== undefined ? { value: value.value as JsonValue } : {}),
    };
  };
  const type = draft.type === "enum" ? "choice" : draft.type;
  const sameType = previous?.type === type;
  const oldPresentation = draft.meta?.presentation;
  const presentation = {
    ...(oldPresentation && typeof oldPresentation === "object" && !Array.isArray(oldPresentation)
      ? oldPresentation
      : {}),
    placeholder: draft.placeholder,
    presentation: draft.presentation,
    variant: draft.variant,
    ratingMax: draft.max,
    valueSemantics: draft.value_semantics,
  };
  const definedPresentation = Object.fromEntries(
    Object.entries(presentation).filter(([, value]) => value !== undefined),
  ) as Record<string, JsonValue>;
  const { presentation: _presentation, ...otherMeta } = draft.meta ?? {};
  const meta = {
    ...otherMeta,
    ...(Object.keys(definedPresentation).length ? { presentation: definedPresentation } : {}),
  };
  const behavior = {
    ...(draft.visible_when ? { visibleWhen: condition(draft.visible_when) } : {}),
    ...(draft.enabled_when ? { enabledWhen: condition(draft.enabled_when) } : {}),
    ...(draft.required_when ? { requiredWhen: condition(draft.required_when) } : {}),
    ...(draft.hidden_value ? { hiddenValue: draft.hidden_value } : {}),
  };
  const base = {
    id: draft.id,
    key: draft.key,
    label: draft.label,
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.required !== undefined ? { required: draft.required } : {}),
    ...(sameType && previous.default !== undefined ? { default: previous.default } : {}),
    ...(Object.keys(meta).length ? { meta } : {}),
    ...(Object.keys(behavior).length ? { behavior } : {}),
  };
  if (type === "choice")
    return {
      ...base,
      type,
      ...(sameType && previous.type === "choice" && previous.multiple !== undefined
        ? { multiple: previous.multiple }
        : {}),
      options: (draft.values ?? []).map((key) =>
        previous?.type === "choice"
          ? (previous.options.find((option) => option.key === key) ?? {
              id: nanoid(),
              key,
              label: labelFromKey(key),
            })
          : { id: nanoid(), key, label: labelFromKey(key) },
      ),
    };
  if (type === "reference") {
    const sourceId =
      sources.find((source) => source.key === draft.target)?.id ??
      (sameType && previous.type === "reference" && !draft.target ? previous.sourceId : undefined);
    if (!sourceId) throw new Error(`Reference Source ${draft.target ?? ""} is unavailable.`);
    return {
      ...base,
      type,
      sourceId,
      ...(sameType && previous.type === "reference" && previous.multiple !== undefined
        ? { multiple: previous.multiple }
        : {}),
    };
  }
  if (type === "text")
    return {
      ...base,
      type,
      ...(draft.format === "email" || draft.format === "url" || draft.format === "phone"
        ? { format: draft.format }
        : {}),
      validation: {
        minLength: draft.validation?.min_length,
        maxLength: draft.validation?.max_length,
        pattern: draft.validation?.pattern,
        message: draft.validation?.message,
      },
    };
  if (type === "number")
    return {
      ...base,
      type,
      ...(draft.format === "currency" || draft.format === "percentage"
        ? { format: draft.format }
        : {}),
      ...(draft.currency ? { currency: draft.currency } : {}),
      validation: {
        min: draft.validation?.min,
        max: draft.validation?.max,
        message: draft.validation?.message,
        ...(sameType && previous.type === "number" && previous.validation?.integer !== undefined
          ? { integer: previous.validation.integer }
          : {}),
      },
    };
  if (type === "date" || type === "datetime")
    return {
      ...base,
      type,
      ...(sameType &&
      (previous.type === "date" || previous.type === "datetime") &&
      previous.validation
        ? { validation: previous.validation }
        : {}),
    };
  return { ...base, type };
}
