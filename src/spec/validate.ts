import { ERROR_CODES, FrameworkError, type ValidationIssue } from "../errors/error.ts";
import {
  SPEC_VERSION,
  type ChoiceFieldDefinition,
  type CollectionDefinition,
  type FieldCondition,
  type FieldDefinition,
  type JsonValue,
  type Spec,
} from "./model.ts";

const semanticKeyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function validateSpec(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!hasSpecStructure(input, issues)) return issues;
  const spec = input;
  if (spec.version !== SPEC_VERSION) {
    issue(issues, "version", "SPEC.UNSUPPORTED_VERSION", "Expected Spec version 2.");
  }
  validateIdentity(spec, "", issues);
  unique(spec.collections, "collections", issues);
  const collectionIds = new Set(spec.collections.map((collection) => collection.id));
  spec.collections.forEach((collection, index) =>
    validateCollection(collection, `collections.${index}`, collectionIds, issues),
  );
  for (const [property, definitions] of otherDefinitions(spec)) {
    unique(definitions, property, issues);
    definitions.forEach((definition, index) =>
      validateIdentity(definition, `${property}.${index}`, issues),
    );
  }
  validateGlobalDefinitionIds(spec, issues);
  return issues;
}

export function assertValidSpec(input: unknown): asserts input is Spec {
  const issues = validateSpec(input);
  if (issues.length === 0) return;
  throw new FrameworkError({
    code: ERROR_CODES.specInvalid,
    message: "The Spec is invalid.",
    issues,
  });
}

function hasSpecStructure(input: unknown, issues: ValidationIssue[]): input is Spec {
  if (!isRecord(input)) {
    issue(issues, "", "SPEC.INVALID", "Spec must be an object.");
    return false;
  }
  requireIdentityShape(input, "", issues);
  if (typeof input.version !== "number") {
    issue(issues, "version", "SPEC.TYPE_INVALID", "Spec version must be a number.");
  }
  let valid = true;
  for (const property of ["collections", "sources", "views", "forms", "pages", "rules"] as const) {
    const value = input[property];
    if (!Array.isArray(value)) {
      issue(issues, property, "SPEC.TYPE_INVALID", `${property} must be an array.`);
      valid = false;
      continue;
    }
    if (property === "collections") {
      value.forEach((collection, index) =>
        requireCollectionShape(collection, `${property}.${index}`, issues),
      );
    } else {
      value.forEach((definition, index) => {
        if (!isRecord(definition)) {
          issue(
            issues,
            `${property}.${index}`,
            "SPEC.TYPE_INVALID",
            "Definition must be an object.",
          );
          return;
        }
        requireIdentityShape(definition, `${property}.${index}`, issues);
      });
    }
  }
  return valid && issues.length === 0;
}

function requireCollectionShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Collection must be an object.");
    return;
  }
  requireIdentityShape(input, path, issues);
  if (!Array.isArray(input.fields)) {
    issue(issues, `${path}.fields`, "SPEC.TYPE_INVALID", "Collection Fields must be an array.");
  } else {
    input.fields.forEach((field, index) =>
      requireFieldShape(field, `${path}.fields.${index}`, issues),
    );
  }
  optionalString(input, "titleFieldId", path, issues);
  if (input.lifecycle !== undefined)
    requireLifecycleShape(input.lifecycle, `${path}.lifecycle`, issues);
}

function requireFieldShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Field must be an object.");
    return;
  }
  requireIdentityShape(input, path, issues);
  optionalBoolean(input, "required", path, issues);
  if (input.default !== undefined && !isJsonValue(input.default)) {
    issue(issues, `${path}.default`, "SPEC.TYPE_INVALID", "Field default must be JSON-compatible.");
  }
  const type = input.type;
  if (typeof type !== "string" || !fieldKinds.has(type)) {
    issue(issues, `${path}.type`, "SPEC.FIELD_TYPE_INVALID", "Field type is not supported.");
    return;
  }
  if (input.behavior !== undefined)
    requireBehaviorShape(input.behavior, `${path}.behavior`, issues);
  switch (type) {
    case "text":
      optionalEnum(input, "format", ["plain", "email", "url", "phone"], path, issues);
      requireValidationShape(
        input.validation,
        { minLength: "number", maxLength: "number", pattern: "string", message: "string" },
        path,
        issues,
      );
      break;
    case "number":
      optionalEnum(input, "format", ["number", "currency", "percentage"], path, issues);
      optionalString(input, "currency", path, issues);
      requireValidationShape(
        input.validation,
        { min: "number", max: "number", integer: "boolean", message: "string" },
        path,
        issues,
      );
      break;
    case "date":
    case "datetime":
      requireValidationShape(
        input.validation,
        { min: "string", max: "string", message: "string" },
        path,
        issues,
      );
      break;
    case "choice":
      optionalBoolean(input, "multiple", path, issues);
      if (!Array.isArray(input.options)) {
        issue(issues, `${path}.options`, "SPEC.TYPE_INVALID", "Choice options must be an array.");
      } else {
        input.options.forEach((option, index) => {
          if (!isRecord(option)) {
            issue(
              issues,
              `${path}.options.${index}`,
              "SPEC.TYPE_INVALID",
              "Choice option must be an object.",
            );
          } else {
            requireIdentityShape(option, `${path}.options.${index}`, issues);
          }
        });
      }
      break;
    case "reference":
      requireString(input, "collectionId", path, issues);
      optionalBoolean(input, "multiple", path, issues);
      break;
    case "boolean":
    case "json":
      if (input.validation !== undefined) unsupportedValidation(path, issues);
      break;
  }
}

function requireLifecycleShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Lifecycle must be an object.");
    return;
  }
  requireString(input, "fieldId", path, issues);
  requireString(input, "initial", path, issues);
  if (input.terminal !== undefined && !isStringArrayUnknown(input.terminal)) {
    issue(issues, `${path}.terminal`, "SPEC.TYPE_INVALID", "Terminal states must be strings.");
  }
  if (!Array.isArray(input.transitions)) {
    issue(
      issues,
      `${path}.transitions`,
      "SPEC.TYPE_INVALID",
      "Lifecycle transitions must be an array.",
    );
    return;
  }
  input.transitions.forEach((transition, index) => {
    const transitionPath = `${path}.transitions.${index}`;
    if (!isRecord(transition)) {
      issue(issues, transitionPath, "SPEC.TYPE_INVALID", "Transition must be an object.");
      return;
    }
    requireIdentityShape(transition, transitionPath, issues);
    if (!isStringArrayUnknown(transition.from)) {
      issue(
        issues,
        `${transitionPath}.from`,
        "SPEC.TYPE_INVALID",
        "Transition origins must be strings.",
      );
    }
    requireString(transition, "to", transitionPath, issues);
  });
}

function requireValidationShape(
  input: unknown,
  rules: Readonly<Record<string, "boolean" | "number" | "string">>,
  fieldPath: string,
  issues: ValidationIssue[],
): void {
  if (input === undefined) return;
  if (!isRecord(input)) {
    issue(issues, `${fieldPath}.validation`, "SPEC.TYPE_INVALID", "Validation must be an object.");
    return;
  }
  for (const key of Object.keys(input)) {
    const expected = rules[key];
    if (!expected) {
      unsupportedValidation(`${fieldPath}.validation.${key}`, issues);
    } else if (typeof input[key] !== expected) {
      issue(
        issues,
        `${fieldPath}.validation.${key}`,
        "SPEC.TYPE_INVALID",
        `Validation ${key} must be a ${expected}.`,
      );
    }
  }
}

function requireBehaviorShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Field behavior must be an object.");
    return;
  }
  for (const property of ["visibleWhen", "enabledWhen", "requiredWhen"] as const) {
    if (input[property] !== undefined) {
      requireConditionShape(input[property], `${path}.${property}`, issues);
    }
  }
  if (
    input.hiddenValue !== undefined &&
    input.hiddenValue !== "preserve" &&
    input.hiddenValue !== "clear"
  ) {
    issue(
      issues,
      `${path}.hiddenValue`,
      "SPEC.VALUE_INVALID",
      "hiddenValue must be preserve or clear.",
    );
  }
}

function requireConditionShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Field condition must be an object.");
    return;
  }
  if ("all" in input || "any" in input) {
    const property = "all" in input ? "all" : "any";
    const items = input[property];
    if (!Array.isArray(items)) {
      issue(
        issues,
        `${path}.${property}`,
        "SPEC.TYPE_INVALID",
        "Condition group must be an array.",
      );
      return;
    }
    items.forEach((item, index) =>
      requireConditionShape(item, `${path}.${property}.${index}`, issues),
    );
    return;
  }
  if ("not" in input) {
    requireConditionShape(input.not, `${path}.not`, issues);
    return;
  }
  requireString(input, "fieldId", path, issues);
  optionalEnum(
    input,
    "operator",
    ["eq", "neq", "contains", "empty", "notEmpty", "gt", "gte", "lt", "lte"],
    path,
    issues,
  );
  if (input.operator === undefined) {
    issue(issues, `${path}.operator`, "SPEC.TYPE_INVALID", "Condition operator is required.");
  }
  if (input.value !== undefined && !isJsonValue(input.value)) {
    issue(issues, `${path}.value`, "SPEC.TYPE_INVALID", "Condition value must be JSON-compatible.");
  }
}

function unsupportedValidation(path: string, issues: ValidationIssue[]): void {
  issue(
    issues,
    path,
    "SPEC.FIELD_VALIDATION_UNSUPPORTED",
    "This validation rule is not supported by the Field type.",
  );
}

function requireIdentityShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  requireString(input, "id", path, issues);
  requireString(input, "key", path, issues);
  requireString(input, "label", path, issues);
  optionalString(input, "description", path, issues);
  if (input.meta !== undefined && (!isRecord(input.meta) || !isJsonValue(input.meta))) {
    issue(
      issues,
      propertyPath(path, "meta"),
      "SPEC.TYPE_INVALID",
      "Metadata must be JSON-compatible.",
    );
  }
}

function requireString(
  input: Readonly<Record<string, unknown>>,
  property: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (typeof input[property] !== "string") {
    issue(
      issues,
      propertyPath(path, property),
      "SPEC.TYPE_INVALID",
      `${property} must be a string.`,
    );
  }
}

function optionalString(
  input: Readonly<Record<string, unknown>>,
  property: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (input[property] !== undefined && typeof input[property] !== "string") {
    issue(
      issues,
      propertyPath(path, property),
      "SPEC.TYPE_INVALID",
      `${property} must be a string.`,
    );
  }
}

function optionalBoolean(
  input: Readonly<Record<string, unknown>>,
  property: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (input[property] !== undefined && typeof input[property] !== "boolean") {
    issue(
      issues,
      propertyPath(path, property),
      "SPEC.TYPE_INVALID",
      `${property} must be a boolean.`,
    );
  }
}

function optionalEnum(
  input: Readonly<Record<string, unknown>>,
  property: string,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  const value = input[property];
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    issue(
      issues,
      propertyPath(path, property),
      "SPEC.VALUE_INVALID",
      `${property} is not supported.`,
    );
  }
}

function propertyPath(path: string, property: string): string {
  return path ? `${path}.${property}` : property;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isStringArrayUnknown(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const fieldKinds = new Set<string>([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "choice",
  "reference",
  "json",
]);

function validateCollection(
  collection: CollectionDefinition,
  path: string,
  collectionIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  validateIdentity(collection, path, issues);
  unique(collection.fields, `${path}.fields`, issues);
  const fieldsById = new Map(collection.fields.map((field) => [field.id, field]));
  collection.fields.forEach((field, index) =>
    validateField(field, `${path}.fields.${index}`, fieldsById, collectionIds, issues),
  );
  if (collection.titleFieldId && !fieldsById.has(collection.titleFieldId)) {
    issue(
      issues,
      `${path}.titleFieldId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "The title Field does not exist in this Collection.",
    );
  }
  if (collection.lifecycle) validateLifecycle(collection, path, fieldsById, issues);
}

function validateLifecycle(
  collection: CollectionDefinition,
  collectionPath: string,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  issues: ValidationIssue[],
): void {
  const lifecycle = collection.lifecycle;
  if (!lifecycle) return;
  const path = `${collectionPath}.lifecycle`;
  const field = fieldsById.get(lifecycle.fieldId);
  if (field?.type !== "choice" || field.multiple) {
    issue(
      issues,
      `${path}.fieldId`,
      "SPEC.LIFECYCLE_FIELD_INVALID",
      "A lifecycle requires a single-choice Field in the same Collection.",
    );
    return;
  }
  const choices = new Set(field.options.map((option) => option.key));
  validateLifecycleChoice(lifecycle.initial, `${path}.initial`, choices, issues);
  lifecycle.terminal?.forEach((value, index) =>
    validateLifecycleChoice(value, `${path}.terminal.${index}`, choices, issues),
  );
  unique(lifecycle.transitions, `${path}.transitions`, issues);
  lifecycle.transitions.forEach((transition, index) => {
    const transitionPath = `${path}.transitions.${index}`;
    validateIdentity(transition, transitionPath, issues);
    transition.from.forEach((value, fromIndex) =>
      validateLifecycleChoice(value, `${transitionPath}.from.${fromIndex}`, choices, issues),
    );
    validateLifecycleChoice(transition.to, `${transitionPath}.to`, choices, issues);
  });
}

function validateField(
  field: FieldDefinition,
  path: string,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  collectionIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  validateIdentity(field, path, issues);
  if (field.type === "choice") validateChoices(field, path, issues);
  if (field.type === "reference" && !collectionIds.has(field.collectionId)) {
    issue(
      issues,
      `${path}.collectionId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "The referenced Collection does not exist in this Spec.",
    );
  }
  if (field.type === "number") {
    const { min, max } = field.validation ?? {};
    if (min !== undefined && max !== undefined && min > max) {
      issue(issues, `${path}.validation`, "SPEC.RANGE_INVALID", "Minimum exceeds maximum.");
    }
    if (field.format === "currency" && !/^[A-Z]{3}$/.test(field.currency ?? "")) {
      issue(
        issues,
        `${path}.currency`,
        "SPEC.CURRENCY_INVALID",
        "Currency Fields require a three-letter uppercase currency code.",
      );
    }
  }
  if (field.type === "text") validateTextDefinition(field, path, issues);
  for (const [property, condition] of Object.entries(field.behavior ?? {})) {
    if (property === "hiddenValue" || condition === undefined) continue;
    validateCondition(
      condition as FieldCondition,
      `${path}.behavior.${property}`,
      fieldsById,
      issues,
    );
  }
  if (field.default !== undefined) {
    validateFieldValue(field, field.default, `${path}.default`, issues, false);
  }
}

function validateTextDefinition(
  field: Extract<FieldDefinition, { type: "text" }>,
  path: string,
  issues: ValidationIssue[],
): void {
  const { minLength, maxLength, pattern } = field.validation ?? {};
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
    issue(issues, `${path}.validation`, "SPEC.RANGE_INVALID", "Minimum length exceeds maximum.");
  }
  if (pattern) {
    try {
      new RegExp(pattern);
    } catch {
      issue(issues, `${path}.validation.pattern`, "SPEC.PATTERN_INVALID", "Pattern is invalid.");
    }
  }
}

function validateChoices(
  field: ChoiceFieldDefinition,
  path: string,
  issues: ValidationIssue[],
): void {
  if (field.options.length === 0) {
    issue(issues, `${path}.options`, "SPEC.CHOICES_REQUIRED", "Choice Fields need an option.");
  }
  unique(field.options, `${path}.options`, issues);
  field.options.forEach((option, index) =>
    validateIdentity(option, `${path}.options.${index}`, issues),
  );
}

function validateCondition(
  condition: FieldCondition,
  path: string,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  issues: ValidationIssue[],
): void {
  if ("all" in condition) {
    condition.all.forEach((item, index) =>
      validateCondition(item, `${path}.all.${index}`, fieldsById, issues),
    );
    return;
  }
  if ("any" in condition) {
    condition.any.forEach((item, index) =>
      validateCondition(item, `${path}.any.${index}`, fieldsById, issues),
    );
    return;
  }
  if ("not" in condition) {
    validateCondition(condition.not, `${path}.not`, fieldsById, issues);
    return;
  }
  if (!fieldsById.has(condition.fieldId)) {
    issue(
      issues,
      `${path}.fieldId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "The condition Field does not exist in this Collection.",
    );
  }
}

export function validateFieldValue(
  field: FieldDefinition,
  value: JsonValue | undefined,
  path: string,
  issues: ValidationIssue[],
  required = field.required === true,
): void {
  if (value === undefined || value === null || value === "") {
    if (required) issue(issues, path, "VALIDATION.REQUIRED", `${field.label} is required.`);
    return;
  }
  const invalidType = (): void =>
    issue(issues, path, "VALIDATION.TYPE", `${field.label} has the wrong value type.`);
  switch (field.type) {
    case "text":
      if (typeof value !== "string") return invalidType();
      validateTextValue(field, value, path, issues);
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return invalidType();
      validateNumberValue(field, value, path, issues);
      return;
    case "boolean":
      if (typeof value !== "boolean") invalidType();
      return;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalidType();
      validateBoundedString(field, value, path, issues);
      return;
    case "datetime":
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return invalidType();
      validateBoundedString(field, value, path, issues);
      return;
    case "choice":
      validateChoiceValue(field, value, path, issues);
      return;
    case "reference":
      if (field.multiple ? !isStringArray(value) : typeof value !== "string") invalidType();
      return;
    case "json":
      return;
  }
}

function validateTextValue(
  field: Extract<FieldDefinition, { type: "text" }>,
  value: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const validation = field.validation;
  if (validation?.minLength !== undefined && value.length < validation.minLength) {
    issue(
      issues,
      path,
      "VALIDATION.MIN_LENGTH",
      validation.message ?? `${field.label} is too short.`,
    );
  }
  if (validation?.maxLength !== undefined && value.length > validation.maxLength) {
    issue(
      issues,
      path,
      "VALIDATION.MAX_LENGTH",
      validation.message ?? `${field.label} is too long.`,
    );
  }
  if (validation?.pattern && !new RegExp(validation.pattern).test(value)) {
    issue(
      issues,
      path,
      "VALIDATION.PATTERN",
      validation.message ?? `${field.label} has an invalid format.`,
    );
  }
  if (field.format === "email" && !/^\S+@\S+\.\S+$/.test(value)) {
    issue(issues, path, "VALIDATION.EMAIL", `${field.label} must be an email address.`);
  }
  if (field.format === "url") {
    try {
      new URL(value);
    } catch {
      issue(issues, path, "VALIDATION.URL", `${field.label} must be a valid URL.`);
    }
  }
}

function validateNumberValue(
  field: Extract<FieldDefinition, { type: "number" }>,
  value: number,
  path: string,
  issues: ValidationIssue[],
): void {
  const validation = field.validation;
  if (validation?.min !== undefined && value < validation.min) {
    issue(issues, path, "VALIDATION.MIN", validation.message ?? `${field.label} is too small.`);
  }
  if (validation?.max !== undefined && value > validation.max) {
    issue(issues, path, "VALIDATION.MAX", validation.message ?? `${field.label} is too large.`);
  }
  if (validation?.integer && !Number.isInteger(value)) {
    issue(
      issues,
      path,
      "VALIDATION.INTEGER",
      validation.message ?? `${field.label} must be a whole number.`,
    );
  }
}

function validateBoundedString(
  field: Extract<FieldDefinition, { type: "date" | "datetime" }>,
  value: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (field.validation?.min && value < field.validation.min) {
    issue(
      issues,
      path,
      "VALIDATION.MIN",
      field.validation.message ?? `${field.label} is too early.`,
    );
  }
  if (field.validation?.max && value > field.validation.max) {
    issue(
      issues,
      path,
      "VALIDATION.MAX",
      field.validation.message ?? `${field.label} is too late.`,
    );
  }
}

function validateChoiceValue(
  field: ChoiceFieldDefinition,
  value: JsonValue,
  path: string,
  issues: ValidationIssue[],
): void {
  const values = field.multiple
    ? isStringArray(value)
      ? value
      : null
    : typeof value === "string"
      ? [value]
      : null;
  if (!values) {
    issue(issues, path, "VALIDATION.TYPE", `${field.label} has the wrong value type.`);
    return;
  }
  const options = new Set(field.options.map((option) => option.key));
  if (values.some((item) => !options.has(item))) {
    issue(issues, path, "VALIDATION.CHOICE", `${field.label} contains an unknown choice.`);
  }
}

function validateIdentity(
  definition: { readonly id: string; readonly key: string; readonly label: string },
  path: string,
  issues: ValidationIssue[],
): void {
  const prefix = path ? `${path}.` : "";
  if (!definition.id) issue(issues, `${prefix}id`, "SPEC.ID_REQUIRED", "A stable ID is required.");
  if (!semanticKeyPattern.test(definition.key)) {
    issue(
      issues,
      `${prefix}key`,
      "SPEC.KEY_INVALID",
      "Keys use lowercase letters, numbers, and underscores and must start with a letter.",
    );
  }
  if (!definition.label.trim()) {
    issue(issues, `${prefix}label`, "SPEC.LABEL_REQUIRED", "A label is required.");
  }
}

function unique(
  definitions: readonly { readonly id: string; readonly key: string }[],
  path: string,
  issues: ValidationIssue[],
): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  definitions.forEach((definition, index) => {
    if (ids.has(definition.id)) {
      issue(issues, `${path}.${index}.id`, "SPEC.ID_DUPLICATE", "ID is duplicated.");
    }
    if (keys.has(definition.key)) {
      issue(issues, `${path}.${index}.key`, "SPEC.KEY_DUPLICATE", "Key is duplicated.");
    }
    ids.add(definition.id);
    keys.add(definition.key);
  });
}

function validateGlobalDefinitionIds(spec: Spec, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  const visit = (id: string, path: string): void => {
    if (seen.has(id)) {
      issue(issues, path, "SPEC.ID_DUPLICATE", "Definition ID must be globally unique.");
    }
    seen.add(id);
  };
  visit(spec.id, "id");
  spec.collections.forEach((collection, collectionIndex) => {
    visit(collection.id, `collections.${collectionIndex}.id`);
    collection.fields.forEach((field, fieldIndex) => {
      visit(field.id, `collections.${collectionIndex}.fields.${fieldIndex}.id`);
      if (field.type === "choice") {
        field.options.forEach((option, optionIndex) =>
          visit(
            option.id,
            `collections.${collectionIndex}.fields.${fieldIndex}.options.${optionIndex}.id`,
          ),
        );
      }
    });
    collection.lifecycle?.transitions.forEach((transition, transitionIndex) =>
      visit(
        transition.id,
        `collections.${collectionIndex}.lifecycle.transitions.${transitionIndex}.id`,
      ),
    );
  });
  for (const [property, definitions] of otherDefinitions(spec)) {
    definitions.forEach((definition, index) => visit(definition.id, `${property}.${index}.id`));
  }
}

function otherDefinitions(spec: Spec): ReadonlyArray<readonly [string, Spec["sources"]]> {
  return [
    ["sources", spec.sources],
    ["views", spec.views],
    ["forms", spec.forms],
    ["pages", spec.pages],
    ["rules", spec.rules],
  ];
}

function validateLifecycleChoice(
  value: string,
  path: string,
  choices: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!choices.has(value)) {
    issue(issues, path, "SPEC.LIFECYCLE_STATE_INVALID", "Lifecycle state is not a Field choice.");
  }
}

function isStringArray(value: JsonValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}
