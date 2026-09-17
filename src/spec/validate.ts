import { ERROR_CODES, FrameworkError, type ValidationIssue } from "../errors/error.ts";
import {
  SPEC_VERSION,
  type ChoiceFieldDefinition,
  type CollectionDefinition,
  type FieldCondition,
  type FieldDefinition,
  type FormDefinition,
  type JsonValue,
  type PageDefinition,
  type PageLayoutNode,
  type RuleDefinition,
  type RuleStep,
  type SourceFilter,
  type SourceQueryDefinition,
  type Spec,
  type ViewDefinition,
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
  const sourceIds = new Set([
    ...spec.collections.map((collection) => collection.id),
    ...spec.sources.map((source) => source.id),
  ]);
  spec.collections.forEach((collection, index) =>
    validateCollection(collection, `collections.${index}`, sourceIds, issues),
  );
  validateSourceNamespace(spec, issues);
  spec.views.forEach((view, index) => validateView(view, index, spec, issues));
  spec.forms.forEach((form, index) => validateForm(form, index, spec, sourceIds, issues));
  spec.pages.forEach((page, index) => validatePage(page, index, issues));
  spec.rules.forEach((rule, index) => validateRule(rule, index, spec, issues));
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

export function assertValidFieldCondition(
  input: unknown,
  collection: CollectionDefinition,
): asserts input is FieldCondition {
  const issues: ValidationIssue[] = [];
  requireConditionShape(input, "filter", issues);
  if (issues.length === 0)
    validateCondition(
      input as FieldCondition,
      "filter",
      new Map(collection.fields.map((field) => [field.id, field])),
      issues,
    );
  if (issues.length > 0)
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "The Field condition is invalid.",
      issues,
    });
}

/** Validates an executable query against the concrete Source schema available at runtime. */
export function assertValidSourceQuery(
  input: unknown,
  root: CollectionDefinition,
  collections: readonly CollectionDefinition[] = [root],
  boundSourceIds: ReadonlySet<string> = new Set(),
): asserts input is SourceQueryDefinition {
  const issues: ValidationIssue[] = [];
  requireSourceQueryShape(input, "query", issues);
  if (issues.length === 0) {
    const query = input as SourceQueryDefinition;
    const aliases = new Set<string>();
    query.select?.forEach((selection, index) => {
      const path = `query.select.${index}.as`;
      if (!semanticKeyPattern.test(selection.as)) {
        issue(issues, path, "SPEC.KEY_INVALID", "Selection alias must be a semantic key.");
      } else if (aliases.has(selection.as)) {
        issue(issues, path, "SPEC.KEY_DUPLICATE", "Selection alias is duplicated.");
      }
      aliases.add(selection.as);
    });
    if (query.aggregate) {
      if (query.select)
        issue(
          issues,
          "query.select",
          "SPEC.PROPERTY_CONFLICT",
          "Select and aggregate cannot be combined.",
        );
      const output = new Set([query.aggregate.group.as]);
      query.aggregate.measures.forEach((measure, index) => {
        const path = `query.aggregate.measures.${index}`;
        if (output.has(measure.as))
          issue(
            issues,
            `${path}.as`,
            "SPEC.KEY_DUPLICATE",
            "Aggregate output alias is duplicated.",
          );
        output.add(measure.as);
        if (measure.operation !== "count" && !measure.path && !measure.paths?.length)
          issue(
            issues,
            path,
            "SPEC.AGGREGATE_PATH_REQUIRED",
            "Numeric aggregate measures need a path.",
          );
        if (measure.paths && measure.operation !== "avg")
          issue(
            issues,
            `${path}.paths`,
            "SPEC.PROPERTY_UNSUPPORTED",
            "Multiple paths are supported only by average measures.",
          );
      });
      query.aggregate.sort?.forEach((sort, index) => {
        if (!output.has(sort.key))
          issue(
            issues,
            `query.aggregate.sort.${index}.key`,
            "SPEC.REFERENCE_UNRESOLVED",
            "Aggregate sort key must name a group or measure output.",
          );
      });
    }
    const byId = new Map(collections.map((collection) => [collection.id, collection]));
    for (const [fieldPath, fieldPathLabel] of queryPaths(query)) {
      validateSourcePath(root, fieldPath, byId, boundSourceIds, fieldPathLabel, issues);
    }
  }
  if (issues.length === 0) return;
  throw new FrameworkError({
    code: ERROR_CODES.validationInvalidInput,
    message: "The Source query is invalid.",
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
        if (property === "views") requireViewShape(definition, `${property}.${index}`, issues);
        if (property === "forms") requireFormShape(definition, `${property}.${index}`, issues);
        if (property === "pages") requirePageShape(definition, `${property}.${index}`, issues);
        if (property === "rules") requireRuleShape(definition, `${property}.${index}`, issues);
      });
    }
  }
  return valid && issues.length === 0;
}

function requireRuleShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  optionalBoolean(input, "enabled", path, issues);
  if (input.priority !== undefined && !Number.isInteger(input.priority))
    issue(issues, `${path}.priority`, "SPEC.TYPE_INVALID", "Rule priority must be an integer.");
  if (input.expose !== undefined) {
    if (
      !Array.isArray(input.expose) ||
      input.expose.some((item) => item !== "ui" && item !== "agent")
    )
      issue(
        issues,
        `${path}.expose`,
        "SPEC.TYPE_INVALID",
        "Rule exposure must contain ui or agent.",
      );
  }
  if (input.input !== undefined) {
    if (!isRecord(input.input))
      issue(issues, `${path}.input`, "SPEC.TYPE_INVALID", "Rule input must be an object.");
    else
      for (const [key, definition] of Object.entries(input.input))
        requireRuleInputShape(definition, `${path}.input.${key}`, issues);
  }
  if (input.trigger !== undefined)
    requireRuleTriggerShape(input.trigger, `${path}.trigger`, issues);
  if (!Array.isArray(input.steps))
    issue(issues, `${path}.steps`, "SPEC.TYPE_INVALID", "Rule steps must be an array.");
  else requireRuleStepsShape(input.steps, `${path}.steps`, issues, new Set());
}

function requireRuleInputShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Rule input definition must be an object.");
  optionalBoolean(input, "required", path, issues);
  const kinds = ["sourceId", "value"].filter((key) => input[key] !== undefined);
  if (kinds.length !== 1)
    issue(
      issues,
      path,
      "SPEC.PROPERTY_CONFLICT",
      "Rule input must declare one sourceId or value kind.",
    );
  if (input.sourceId !== undefined) requireString(input, "sourceId", path, issues);
  if (
    input.value !== undefined &&
    (typeof input.value !== "string" ||
      !["text", "number", "boolean", "date", "object", "array"].includes(input.value))
  )
    issue(issues, `${path}.value`, "SPEC.TYPE_INVALID", "Rule value input kind is invalid.");
  if (input.default !== undefined) requireRuleValueShape(input.default, `${path}.default`, issues);
}

function requireRuleTriggerShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Rule trigger must be an object.");
  requireString(input, "event", path, issues);
  optionalString(input, "sourceId", path, issues);
  optionalString(input, "fieldId", path, issues);
  optionalString(input, "formId", path, issues);
  if (input.config !== undefined) {
    if (!isRecord(input.config))
      issue(issues, `${path}.config`, "SPEC.TYPE_INVALID", "Trigger config must be an object.");
    else
      for (const [key, value] of Object.entries(input.config))
        requireRuleValueShape(value, `${path}.config.${key}`, issues);
  }
}

function requireRuleStepsShape(
  steps: readonly unknown[],
  path: string,
  issues: ValidationIssue[],
  ids: Set<string>,
): void {
  steps.forEach((step, index) => {
    const stepPath = `${path}.${index}`;
    if (!isRecord(step))
      return issue(issues, stepPath, "SPEC.TYPE_INVALID", "Rule step must be an object.");
    requireString(step, "id", stepPath, issues);
    if (typeof step.id === "string") {
      if (ids.has(step.id))
        issue(issues, `${stepPath}.id`, "SPEC.ID_DUPLICATE", "Rule step ID is duplicated.");
      ids.add(step.id);
    }
    const kinds = [
      "gate",
      "compute",
      "action",
      "invoke",
      "delay",
      "wait",
      "foreach",
      "repeat",
      "parallel",
    ].filter((key) => step[key] !== undefined);
    if (kinds.length !== 1)
      return issue(
        issues,
        stepPath,
        "SPEC.PROPERTY_CONFLICT",
        "Rule step must contain exactly one primitive.",
      );
    const kind = kinds[0]!;
    const config = step[kind];
    if (!isRecord(config))
      return issue(
        issues,
        `${stepPath}.${kind}`,
        "SPEC.TYPE_INVALID",
        "Rule step configuration must be an object.",
      );
    const at = `${stepPath}.${kind}`;
    if (kind === "gate") {
      requireRulePredicateShape(config.predicate, `${at}.predicate`, issues);
      requireOptionalRuleSteps(config.pass, `${at}.pass`, issues, ids);
      requireOptionalRuleSteps(config.fail, `${at}.fail`, issues, ids);
    } else if (kind === "compute") {
      requireRuleValueMap(config.assign, `${at}.assign`, issues);
    } else if (kind === "action") {
      requireRuleActionShape(config, at, issues);
    } else if (kind === "invoke") {
      requireString(config, "ruleId", at, issues);
      if (config.input !== undefined) requireRuleValueMap(config.input, `${at}.input`, issues);
      optionalString(config, "as", at, issues);
    } else if (kind === "delay") {
      requireDurationShape(config.duration, `${at}.duration`, issues);
    } else if (kind === "wait") {
      if (config.request !== undefined) {
        if (!isRecord(config.request))
          issue(issues, `${at}.request`, "SPEC.TYPE_INVALID", "ActorRequest must be an object.");
        else {
          requireString(config.request, "label", `${at}.request`, issues);
          optionalString(config.request, "actor", `${at}.request`, issues);
          if (!Array.isArray(config.request.fields))
            issue(
              issues,
              `${at}.request.fields`,
              "SPEC.TYPE_INVALID",
              "Request Fields must be an array.",
            );
          else
            config.request.fields.forEach((field, index) =>
              requireFieldShape(field, `${at}.request.fields.${index}`, issues),
            );
        }
      }
      optionalString(config, "signal", at, issues);
      if (config.timeout !== undefined)
        requireDurationShape(config.timeout, `${at}.timeout`, issues);
      if (
        config.signal === undefined &&
        config.timeout === undefined &&
        config.request === undefined
      )
        issue(issues, at, "SPEC.VALUE_REQUIRED", "Wait needs a signal, timeout, or ActorRequest.");
      if (config.signal !== undefined && config.request !== undefined)
        issue(
          issues,
          at,
          "SPEC.PROPERTY_CONFLICT",
          "Wait cannot combine a signal and ActorRequest.",
        );
      optionalString(config, "as", at, issues);
      requireOptionalRuleSteps(config.onSignal, `${at}.onSignal`, issues, ids);
      requireOptionalRuleSteps(config.onTimeout, `${at}.onTimeout`, issues, ids);
    } else if (kind === "foreach") {
      requireRuleBindingShape(config.source, `${at}.source`, issues);
      requireLoopShape(config, at, issues);
      if (!Array.isArray(config.steps))
        issue(issues, `${at}.steps`, "SPEC.TYPE_INVALID", "Loop steps must be an array.");
      else requireRuleStepsShape(config.steps, `${at}.steps`, issues, ids);
    } else if (kind === "repeat") {
      if (
        !(
          typeof config.times === "number" &&
          Number.isSafeInteger(config.times) &&
          config.times >= 0
        )
      )
        requireRuleBindingShape(config.times, `${at}.times`, issues);
      requireLoopShape(config, at, issues);
      if (!Array.isArray(config.steps))
        issue(issues, `${at}.steps`, "SPEC.TYPE_INVALID", "Loop steps must be an array.");
      else requireRuleStepsShape(config.steps, `${at}.steps`, issues, ids);
    } else {
      optionalEnum(config, "join", ["all", "any"], at, issues);
      if (!Array.isArray(config.branches) || config.branches.length === 0)
        issue(issues, `${at}.branches`, "SPEC.TYPE_INVALID", "Parallel needs at least one branch.");
      else
        config.branches.forEach((branch, branchIndex) => {
          const branchPath = `${at}.branches.${branchIndex}`;
          if (!isRecord(branch))
            return issue(
              issues,
              branchPath,
              "SPEC.TYPE_INVALID",
              "Parallel branch must be an object.",
            );
          requireString(branch, "id", branchPath, issues);
          if (typeof branch.id === "string") {
            if (ids.has(branch.id))
              issue(
                issues,
                `${branchPath}.id`,
                "SPEC.ID_DUPLICATE",
                "Rule step or branch ID is duplicated.",
              );
            ids.add(branch.id);
          }
          optionalString(branch, "key", branchPath, issues);
          if (!Array.isArray(branch.steps))
            issue(
              issues,
              `${branchPath}.steps`,
              "SPEC.TYPE_INVALID",
              "Branch steps must be an array.",
            );
          else requireRuleStepsShape(branch.steps, `${branchPath}.steps`, issues, ids);
        });
    }
  });
}

function requireOptionalRuleSteps(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
  ids: Set<string>,
): void {
  if (input === undefined) return;
  if (!Array.isArray(input))
    issue(issues, path, "SPEC.TYPE_INVALID", "Nested Rule steps must be an array.");
  else requireRuleStepsShape(input, path, issues, ids);
}

function requireRuleActionShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  requireString(input, "key", path, issues);
  optionalString(input, "as", path, issues);
  optionalString(input, "runAs", path, issues);
  if (input.input !== undefined) requireRuleValueMap(input.input, `${path}.input`, issues);
  if (input.retry !== undefined) {
    if (!isRecord(input.retry))
      issue(issues, `${path}.retry`, "SPEC.TYPE_INVALID", "Retry must be an object.");
    else {
      if (!Number.isInteger(input.retry.max) || Number(input.retry.max) < 1)
        issue(
          issues,
          `${path}.retry.max`,
          "SPEC.TYPE_INVALID",
          "Retry max must be a positive integer.",
        );
      if (
        input.retry.backoff !== undefined &&
        (!Array.isArray(input.retry.backoff) ||
          input.retry.backoff.some(
            (value) => typeof value !== "number" || !Number.isFinite(value) || value < 0,
          ))
      )
        issue(
          issues,
          `${path}.retry.backoff`,
          "SPEC.TYPE_INVALID",
          "Retry backoff must contain non-negative seconds.",
        );
    }
  }
  if (input.compensate !== undefined) {
    if (!isRecord(input.compensate))
      issue(
        issues,
        `${path}.compensate`,
        "SPEC.TYPE_INVALID",
        "Compensation must be an Action call.",
      );
    else {
      requireString(input.compensate, "key", `${path}.compensate`, issues);
      optionalString(input.compensate, "runAs", `${path}.compensate`, issues);
      if (input.compensate.input !== undefined)
        requireRuleValueMap(input.compensate.input, `${path}.compensate.input`, issues);
    }
  }
}

function requireRulePredicateShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Rule predicate must be an object.");
  const kinds = ["all", "any", "not", "op"].filter((key) => input[key] !== undefined);
  if (kinds.length !== 1)
    return issue(
      issues,
      path,
      "SPEC.PROPERTY_CONFLICT",
      "Predicate must contain exactly one combinator or op.",
    );
  if (input.all !== undefined || input.any !== undefined) {
    const children = input.all ?? input.any;
    if (!Array.isArray(children))
      issue(issues, path, "SPEC.TYPE_INVALID", "Predicate children must be an array.");
    else
      children.forEach((child, index) =>
        requireRulePredicateShape(child, `${path}.${index}`, issues),
      );
  } else if (input.not !== undefined) requireRulePredicateShape(input.not, `${path}.not`, issues);
  else {
    requireString(input, "op", path, issues);
    for (const [key, value] of Object.entries(input))
      if (key !== "op") requireRuleValueShape(value, `${path}.${key}`, issues);
  }
}

function requireRuleValueMap(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Rule values must be an object.");
  for (const [key, value] of Object.entries(input))
    requireRuleValueShape(value, `${path}.${key}`, issues);
}

function requireRuleValueShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (input === null || typeof input === "string" || typeof input === "boolean") return;
  if (typeof input === "number") {
    if (!Number.isFinite(input))
      issue(issues, path, "SPEC.TYPE_INVALID", "Rule number must be finite.");
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((value, index) => requireRuleValueShape(value, `${path}.${index}`, issues));
    return;
  }
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Rule value must be JSON-compatible.");
  if ("$ref" in input) return requireRuleBindingShape(input, path, issues);
  for (const [key, value] of Object.entries(input))
    requireRuleValueShape(value, `${path}.${key}`, issues);
}

function requireRuleBindingShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    !isRecord(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.$ref !== "string" ||
    !/^(?:trigger|actor|vars|meta)(?:\.[A-Za-z0-9_-]+)+$/.test(input.$ref)
  )
    issue(issues, path, "SPEC.TYPE_INVALID", "Rule binding must contain only a non-empty $ref.");
}

function requireLoopShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  optionalString(input, "as", path, issues);
  if (input.max !== undefined && (!Number.isInteger(input.max) || Number(input.max) < 1))
    issue(issues, `${path}.max`, "SPEC.TYPE_INVALID", "Loop max must be a positive integer.");
  optionalEnum(input, "onItemFailure", ["stop", "continue"], path, issues);
}

function requireDurationShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    !(
      (typeof input === "number" && Number.isFinite(input) && input >= 0) ||
      (typeof input === "string" && input.trim().length > 0)
    )
  )
    issue(issues, path, "SPEC.TYPE_INVALID", "Duration must be a non-negative number or string.");
}

function requireFormShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  optionalEnum(input, "mode", ["create", "edit", "standalone"], path, issues);
  if (input.mode === undefined) {
    issue(issues, `${path}.mode`, "SPEC.TYPE_INVALID", "Form mode is required.");
  } else if (input.mode === "standalone") {
    if (!Array.isArray(input.fields)) {
      issue(
        issues,
        `${path}.fields`,
        "SPEC.TYPE_INVALID",
        "Standalone Form Fields must be an array.",
      );
    } else {
      input.fields.forEach((field, index) =>
        requireFieldShape(field, `${path}.fields.${index}`, issues),
      );
    }
    if (input.collectionId !== undefined || input.fieldIds !== undefined) {
      issue(
        issues,
        path,
        "SPEC.FORM_SHAPE_INVALID",
        "Standalone Forms own Fields and cannot target a Collection.",
      );
    }
  } else if (input.mode === "create" || input.mode === "edit") {
    requireString(input, "collectionId", path, issues);
    if (!isStringArrayUnknown(input.fieldIds)) {
      issue(
        issues,
        `${path}.fieldIds`,
        "SPEC.TYPE_INVALID",
        "Collection Form fieldIds must be an array of stable Field IDs.",
      );
    }
    if (input.fields !== undefined) {
      issue(
        issues,
        `${path}.fields`,
        "SPEC.FORM_SHAPE_INVALID",
        "Collection Forms reference Fields and cannot own them.",
      );
    }
  }
  if (input.submit !== undefined) requireFormSubmitShape(input.submit, `${path}.submit`, issues);
}

function requireFormSubmitShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Form submit settings must be an object.");
    return;
  }
  if (input.success === undefined) return;
  if (!isRecord(input.success)) {
    issue(issues, `${path}.success`, "SPEC.TYPE_INVALID", "Form success must be an object.");
    return;
  }
  optionalString(input.success, "title", `${path}.success`, issues);
  optionalString(input.success, "description", `${path}.success`, issues);
}

function requirePageShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(input.layout)) {
    issue(issues, `${path}.layout`, "SPEC.TYPE_INVALID", "Page layout must be an array.");
    return;
  }
  input.layout.forEach((node, index) =>
    requirePageNodeShape(node, `${path}.layout.${index}`, issues),
  );
}

function requirePageNodeShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Page layout node must be an object.");
    return;
  }
  requireString(input, "id", path, issues);
  optionalEnum(input, "kind", ["block", "group"], path, issues);
  if (input.kind === undefined) {
    issue(issues, `${path}.kind`, "SPEC.TYPE_INVALID", "Page layout node kind is required.");
  } else if (input.kind === "block") {
    requireString(input, "block", path, issues);
    if (input.config !== undefined && (!isRecord(input.config) || !isJsonValue(input.config))) {
      issue(issues, `${path}.config`, "SPEC.TYPE_INVALID", "Block config must be a JSON object.");
    }
  } else if (input.kind === "group") {
    if (input.columns !== undefined && typeof input.columns !== "number") {
      issue(issues, `${path}.columns`, "SPEC.TYPE_INVALID", "Group columns must be a number.");
    }
    optionalEnum(input, "minHeight", ["s", "m", "l", "xl"], path, issues);
    if (!Array.isArray(input.children)) {
      issue(issues, `${path}.children`, "SPEC.TYPE_INVALID", "Group children must be an array.");
    } else {
      input.children.forEach((node, index) =>
        requirePageNodeShape(node, `${path}.children.${index}`, issues),
      );
    }
  }
}

function requireViewShape(
  input: Readonly<Record<string, unknown>>,
  path: string,
  issues: ValidationIssue[],
): void {
  requireString(input, "source", path, issues);
  if (input.query !== undefined) requireSourceQueryShape(input.query, `${path}.query`, issues);
  if (input.parameters !== undefined) {
    if (!Array.isArray(input.parameters)) {
      issue(issues, `${path}.parameters`, "SPEC.TYPE_INVALID", "View parameters must be an array.");
    } else {
      input.parameters.forEach((parameter, index) => {
        const parameterPath = `${path}.parameters.${index}`;
        if (!isRecord(parameter))
          return issue(
            issues,
            parameterPath,
            "SPEC.TYPE_INVALID",
            "View parameter must be an object.",
          );
        requireString(parameter, "key", parameterPath, issues);
        optionalString(parameter, "label", parameterPath, issues);
        requireSourcePath(parameter.path, `${parameterPath}.path`, issues);
        optionalEnum(
          parameter,
          "operator",
          ["eq", "neq", "contains", "empty", "notEmpty", "gt", "gte", "lt", "lte"],
          parameterPath,
          issues,
        );
        optionalBoolean(parameter, "required", parameterPath, issues);
        optionalEnum(parameter, "source", ["input", "context"], parameterPath, issues);
      });
    }
  }
  if (input.presentation !== undefined) {
    if (!isRecord(input.presentation)) {
      issue(
        issues,
        `${path}.presentation`,
        "SPEC.TYPE_INVALID",
        "View presentation must be an object.",
      );
    } else {
      requireString(input.presentation, "block", `${path}.presentation`, issues);
      if (
        input.presentation.config !== undefined &&
        (!isRecord(input.presentation.config) || !isJsonValue(input.presentation.config))
      ) {
        issue(
          issues,
          `${path}.presentation.config`,
          "SPEC.TYPE_INVALID",
          "Block config must be a JSON object.",
        );
      }
    }
  }
}

function requireSourceQueryShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input)) {
    issue(issues, path, "SPEC.TYPE_INVALID", "Source query must be an object.");
    return;
  }
  if (input.filter !== undefined) requireSourceFilterShape(input.filter, `${path}.filter`, issues);
  if (input.sort !== undefined) {
    if (!Array.isArray(input.sort))
      issue(issues, `${path}.sort`, "SPEC.TYPE_INVALID", "Source sort must be an array.");
    else
      input.sort.forEach((sort, index) => {
        const itemPath = `${path}.sort.${index}`;
        if (!isRecord(sort))
          return issue(issues, itemPath, "SPEC.TYPE_INVALID", "Sort must be an object.");
        requireSourcePath(sort.path, `${itemPath}.path`, issues);
        optionalEnum(sort, "direction", ["asc", "desc"], itemPath, issues);
        if (sort.direction === undefined)
          issue(
            issues,
            `${itemPath}.direction`,
            "SPEC.TYPE_INVALID",
            "Sort direction is required.",
          );
      });
  }
  if (input.select !== undefined) {
    if (!Array.isArray(input.select))
      issue(issues, `${path}.select`, "SPEC.TYPE_INVALID", "Source selection must be an array.");
    else
      input.select.forEach((selection, index) => {
        const itemPath = `${path}.select.${index}`;
        if (!isRecord(selection))
          return issue(issues, itemPath, "SPEC.TYPE_INVALID", "Selection must be an object.");
        requireSourcePath(selection.path, `${itemPath}.path`, issues);
        requireString(selection, "as", itemPath, issues);
        optionalString(selection, "label", itemPath, issues);
      });
  }
  if (input.aggregate !== undefined)
    requireSourceAggregateShape(input.aggregate, `${path}.aggregate`, issues);
  requireNonNegativeInteger(input.offset, `${path}.offset`, issues, true);
  requireNonNegativeInteger(input.limit, `${path}.limit`, issues, false);
}

function requireSourceAggregateShape(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Source aggregation must be an object.");
  if (!isRecord(input.group)) {
    issue(issues, `${path}.group`, "SPEC.TYPE_INVALID", "Aggregation group must be a selection.");
  } else {
    requireSourcePath(input.group.path, `${path}.group.path`, issues);
    if (input.group.labelPath !== undefined)
      requireSourcePath(input.group.labelPath, `${path}.group.labelPath`, issues);
    requireString(input.group, "as", `${path}.group`, issues);
    optionalString(input.group, "label", `${path}.group`, issues);
  }
  if (!Array.isArray(input.measures) || input.measures.length === 0) {
    issue(
      issues,
      `${path}.measures`,
      "SPEC.TYPE_INVALID",
      "Aggregation needs at least one measure.",
    );
  } else {
    input.measures.forEach((measure, index) => {
      const measurePath = `${path}.measures.${index}`;
      if (!isRecord(measure))
        return issue(
          issues,
          measurePath,
          "SPEC.TYPE_INVALID",
          "Aggregate measure must be an object.",
        );
      requireString(measure, "as", measurePath, issues);
      optionalString(measure, "label", measurePath, issues);
      optionalEnum(
        measure,
        "operation",
        ["count", "sum", "avg", "min", "max"],
        measurePath,
        issues,
      );
      if (measure.operation === undefined)
        issue(
          issues,
          `${measurePath}.operation`,
          "SPEC.TYPE_INVALID",
          "Aggregate operation is required.",
        );
      if (measure.path !== undefined)
        requireSourcePath(measure.path, `${measurePath}.path`, issues);
      if (measure.paths !== undefined) {
        if (!Array.isArray(measure.paths) || measure.paths.length === 0)
          issue(
            issues,
            `${measurePath}.paths`,
            "SPEC.TYPE_INVALID",
            "Aggregate paths must be a non-empty array.",
          );
        else
          measure.paths.forEach((fieldPath, fieldIndex) =>
            requireSourcePath(fieldPath, `${measurePath}.paths.${fieldIndex}`, issues),
          );
      }
    });
  }
  if (input.sort !== undefined) {
    if (!Array.isArray(input.sort))
      issue(issues, `${path}.sort`, "SPEC.TYPE_INVALID", "Aggregate sort must be an array.");
    else
      input.sort.forEach((sort, index) => {
        const sortPath = `${path}.sort.${index}`;
        if (!isRecord(sort))
          return issue(issues, sortPath, "SPEC.TYPE_INVALID", "Aggregate sort must be an object.");
        requireString(sort, "key", sortPath, issues);
        optionalEnum(sort, "direction", ["asc", "desc"], sortPath, issues);
        if (sort.direction === undefined)
          issue(
            issues,
            `${sortPath}.direction`,
            "SPEC.TYPE_INVALID",
            "Aggregate sort direction is required.",
          );
      });
  }
}

function requireSourceFilterShape(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(input))
    return issue(issues, path, "SPEC.TYPE_INVALID", "Source filter must be an object.");
  const groups = ["all", "any", "not"].filter((property) => property in input);
  const hasLeaf = ["path", "operator", "value"].some((property) => property in input);
  if (groups.length + Number(hasLeaf) !== 1) {
    issue(
      issues,
      path,
      "SPEC.FILTER_SHAPE_INVALID",
      "A Source filter must contain exactly one of all, any, not, or a Field predicate.",
    );
    return;
  }
  if (groups[0] === "all" || groups[0] === "any") {
    const property = groups[0];
    rejectUnexpectedProperties(input, [property], path, "Source filter group", issues);
    const items = input[property];
    if (!Array.isArray(items) || items.length === 0)
      return issue(
        issues,
        `${path}.${property}`,
        "SPEC.TYPE_INVALID",
        "Filter group must be a non-empty array.",
      );
    items.forEach((item, index) =>
      requireSourceFilterShape(item, `${path}.${property}.${index}`, issues),
    );
    return;
  }
  if (groups[0] === "not") {
    rejectUnexpectedProperties(input, ["not"], path, "Source filter negation", issues);
    return requireSourceFilterShape(input.not, `${path}.not`, issues);
  }
  rejectUnexpectedProperties(
    input,
    ["path", "operator", "value"],
    path,
    "Source predicate",
    issues,
  );
  requireSourcePath(input.path, `${path}.path`, issues);
  optionalEnum(
    input,
    "operator",
    ["eq", "neq", "contains", "empty", "notEmpty", "gt", "gte", "lt", "lte"],
    path,
    issues,
  );
  if (input.operator === undefined)
    issue(issues, `${path}.operator`, "SPEC.TYPE_INVALID", "Filter operator is required.");
  if (input.value !== undefined && !isJsonValue(input.value))
    issue(issues, `${path}.value`, "SPEC.TYPE_INVALID", "Filter value must be JSON-compatible.");
}

function rejectUnexpectedProperties(
  input: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  path: string,
  label: string,
  issues: ValidationIssue[],
): void {
  for (const property of Object.keys(input)) {
    if (allowed.includes(property)) continue;
    issue(
      issues,
      propertyPath(path, property),
      "SPEC.PROPERTY_UNSUPPORTED",
      `${property} is not supported by this ${label}.`,
    );
  }
}

function requireSourcePath(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    !input.every((item) => typeof item === "string" && item.length > 0)
  ) {
    issue(
      issues,
      path,
      "SPEC.TYPE_INVALID",
      "Field path must be a non-empty array of stable Field IDs.",
    );
  }
}

function requireNonNegativeInteger(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
  allowZero: boolean,
): void {
  if (input === undefined) return;
  if (typeof input !== "number" || !Number.isInteger(input) || input < (allowZero ? 0 : 1)) {
    issue(
      issues,
      path,
      "SPEC.TYPE_INVALID",
      allowZero ? "Offset must be a non-negative integer." : "Limit must be a positive integer.",
    );
  }
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
  rejectUnsupportedFieldProperties(input, type, path, issues);
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
      requireString(input, "sourceId", path, issues);
      optionalBoolean(input, "multiple", path, issues);
      break;
    case "boolean":
    case "json":
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
    } else if (
      typeof input[key] !== expected ||
      (expected === "number" && !Number.isFinite(input[key]))
    ) {
      issue(
        issues,
        `${fieldPath}.validation.${key}`,
        "SPEC.TYPE_INVALID",
        `Validation ${key} must be a ${expected}.`,
      );
    }
  }
}

function rejectUnsupportedFieldProperties(
  input: Readonly<Record<string, unknown>>,
  type: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const allowed = new Set([
    "id",
    "key",
    "label",
    "description",
    "meta",
    "type",
    "required",
    "default",
    "behavior",
    ...(fieldProperties[type] ?? []),
  ]);
  for (const property of Object.keys(input)) {
    if (allowed.has(property)) continue;
    issue(
      issues,
      `${path}.${property}`,
      "SPEC.FIELD_PROPERTY_UNSUPPORTED",
      `${property} is not supported by ${type} Fields.`,
    );
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
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
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

const fieldProperties: Readonly<Record<string, readonly string[]>> = {
  text: ["format", "validation"],
  number: ["format", "currency", "validation"],
  boolean: [],
  date: ["validation"],
  datetime: ["validation"],
  choice: ["options", "multiple"],
  reference: ["sourceId", "multiple"],
  json: [],
};

function validateCollection(
  collection: CollectionDefinition,
  path: string,
  sourceIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  validateIdentity(collection, path, issues);
  if (collection.collectionLabel !== undefined && typeof collection.collectionLabel !== "string")
    issue(
      issues,
      `${path}.collectionLabel`,
      "SPEC.TYPE_INVALID",
      "collectionLabel must be a string.",
    );
  unique(collection.fields, `${path}.fields`, issues);
  const fieldsById = new Map(collection.fields.map((field) => [field.id, field]));
  collection.fields.forEach((field, index) =>
    validateField(field, `${path}.fields.${index}`, fieldsById, sourceIds, issues),
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

function validateSourceNamespace(spec: Spec, issues: ValidationIssue[]): void {
  const local = new Set(spec.collections.map((collection) => collection.key));
  spec.sources.forEach((source, index) => {
    if (local.has(source.key)) {
      issue(
        issues,
        `sources.${index}.key`,
        "SPEC.SOURCE_KEY_DUPLICATE",
        "Source keys must be unique across local Collections and bound Sources.",
      );
    }
  });
}

function validateForm(
  form: FormDefinition,
  index: number,
  spec: Spec,
  sourceIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const path = `forms.${index}`;
  if (form.mode === "standalone") {
    unique(form.fields, `${path}.fields`, issues);
    const fieldsById = new Map(form.fields.map((field) => [field.id, field]));
    form.fields.forEach((field, fieldIndex) =>
      validateField(field, `${path}.fields.${fieldIndex}`, fieldsById, sourceIds, issues),
    );
    return;
  }
  const collection = spec.collections.find((candidate) => candidate.id === form.collectionId);
  if (!collection) {
    issue(
      issues,
      `${path}.collectionId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "The Form Collection does not exist in this Spec.",
    );
    return;
  }
  const fieldIds = new Set<string>();
  form.fieldIds.forEach((fieldId, fieldIndex) => {
    const fieldPath = `${path}.fieldIds.${fieldIndex}`;
    if (fieldIds.has(fieldId)) {
      issue(issues, fieldPath, "SPEC.REFERENCE_DUPLICATE", "Form Field is listed more than once.");
    } else if (!collection.fields.some((field) => field.id === fieldId)) {
      issue(
        issues,
        fieldPath,
        "SPEC.REFERENCE_UNRESOLVED",
        "The Form Field does not exist in its Collection.",
      );
    }
    fieldIds.add(fieldId);
  });
}

function validatePage(page: PageDefinition, index: number, issues: ValidationIssue[]): void {
  page.layout.forEach((node, nodeIndex) =>
    validatePageNode(node, `pages.${index}.layout.${nodeIndex}`, issues),
  );
}

function validateRule(
  rule: RuleDefinition,
  index: number,
  spec: Spec,
  issues: ValidationIssue[],
): void {
  const path = `rules.${index}`;
  const sourceIds = new Set([
    ...spec.collections.map((collection) => collection.id),
    ...spec.sources.map((source) => source.id),
  ]);
  for (const [key, input] of Object.entries(rule.input ?? {})) {
    const inputPath = `${path}.input.${key}`;
    if (!semanticKeyPattern.test(key))
      issue(issues, inputPath, "SPEC.KEY_INVALID", "Rule input key must be semantic.");
    if ("sourceId" in input && !sourceIds.has(input.sourceId))
      issue(
        issues,
        `${inputPath}.sourceId`,
        "SPEC.REFERENCE_UNRESOLVED",
        "Rule input Source does not exist.",
      );
  }
  const trigger = rule.trigger;
  if (trigger?.event.startsWith("record.") && !trigger.sourceId)
    issue(
      issues,
      `${path}.trigger.sourceId`,
      "SPEC.VALUE_REQUIRED",
      "Record Events need a Source.",
    );
  if (trigger?.event === "record.field_changed" && !trigger.fieldId)
    issue(
      issues,
      `${path}.trigger.fieldId`,
      "SPEC.VALUE_REQUIRED",
      "Field-change Events need a Field.",
    );
  if (trigger?.event === "form.submitted" && !trigger.formId)
    issue(
      issues,
      `${path}.trigger.formId`,
      "SPEC.VALUE_REQUIRED",
      "Form submission Events need a Form.",
    );
  if (trigger?.sourceId && !sourceIds.has(trigger.sourceId))
    issue(
      issues,
      `${path}.trigger.sourceId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "Trigger Source does not exist.",
    );
  if (trigger?.formId && !spec.forms.some((form) => form.id === trigger.formId))
    issue(
      issues,
      `${path}.trigger.formId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "Trigger Form does not exist.",
    );
  if (trigger?.fieldId) {
    const collection = spec.collections.find((item) => item.id === trigger.sourceId);
    if (collection && !collection.fields.some((field) => field.id === trigger.fieldId))
      issue(
        issues,
        `${path}.trigger.fieldId`,
        "SPEC.REFERENCE_UNRESOLVED",
        "Trigger Field does not exist on its Source.",
      );
  }
  const ruleIds = new Set(spec.rules.map((item) => item.id));
  validateRuleStepReferences(rule.steps, `${path}.steps`, ruleIds, issues);
  validateRuleRequests(rule.steps, `${path}.steps`, sourceIds, issues);
}

function validateRuleRequests(
  steps: readonly RuleStep[],
  path: string,
  sourceIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  steps.forEach((step, index) => {
    const at = `${path}.${index}`;
    if ("wait" in step && step.wait.request) {
      const request = step.wait.request;
      if (request.actor && request.actor !== "trigger" && !semanticKeyPattern.test(request.actor))
        issue(
          issues,
          `${at}.wait.request.actor`,
          "SPEC.KEY_INVALID",
          "Request Actor binding must be semantic.",
        );
      unique(request.fields, `${at}.wait.request.fields`, issues);
      const fields = new Map(request.fields.map((field) => [field.id, field]));
      request.fields.forEach((field, fieldIndex) =>
        validateField(field, `${at}.wait.request.fields.${fieldIndex}`, fields, sourceIds, issues),
      );
    }
    const children =
      "gate" in step
        ? [step.gate.pass ?? [], step.gate.fail ?? []]
        : "wait" in step
          ? [step.wait.onSignal ?? [], step.wait.onTimeout ?? []]
          : "foreach" in step
            ? [step.foreach.steps]
            : "repeat" in step
              ? [step.repeat.steps]
              : "parallel" in step
                ? step.parallel.branches.map((branch) => branch.steps)
                : [];
    children.forEach((nested, childIndex) =>
      validateRuleRequests(nested, `${at}.children.${childIndex}`, sourceIds, issues),
    );
  });
}

function validateRuleStepReferences(
  steps: readonly RuleStep[],
  path: string,
  ruleIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  steps.forEach((step, index) => {
    const stepPath = `${path}.${index}`;
    if ("invoke" in step && !ruleIds.has(step.invoke.ruleId))
      issue(
        issues,
        `${stepPath}.invoke.ruleId`,
        "SPEC.REFERENCE_UNRESOLVED",
        "Invoked Rule does not exist.",
      );
    if ("action" in step) {
      for (const [runAs, runAsPath] of [
        [step.action.runAs, `${stepPath}.action.runAs`],
        [step.action.compensate?.runAs, `${stepPath}.action.compensate.runAs`],
      ] as const)
        if (runAs && runAs !== "trigger" && runAs !== "system" && !semanticKeyPattern.test(runAs))
          issue(issues, runAsPath, "SPEC.KEY_INVALID", "Run-as binding must be semantic.");
    }
    if ("gate" in step) {
      validateRuleStepReferences(step.gate.pass ?? [], `${stepPath}.gate.pass`, ruleIds, issues);
      validateRuleStepReferences(step.gate.fail ?? [], `${stepPath}.gate.fail`, ruleIds, issues);
    } else if ("wait" in step) {
      validateRuleStepReferences(
        step.wait.onSignal ?? [],
        `${stepPath}.wait.onSignal`,
        ruleIds,
        issues,
      );
      validateRuleStepReferences(
        step.wait.onTimeout ?? [],
        `${stepPath}.wait.onTimeout`,
        ruleIds,
        issues,
      );
    } else if ("foreach" in step) {
      validateRuleStepReferences(step.foreach.steps, `${stepPath}.foreach.steps`, ruleIds, issues);
    } else if ("repeat" in step) {
      validateRuleStepReferences(step.repeat.steps, `${stepPath}.repeat.steps`, ruleIds, issues);
    } else if ("parallel" in step) {
      step.parallel.branches.forEach((branch, branchIndex) =>
        validateRuleStepReferences(
          branch.steps,
          `${stepPath}.parallel.branches.${branchIndex}.steps`,
          ruleIds,
          issues,
        ),
      );
    }
  });
}

function validatePageNode(node: PageLayoutNode, path: string, issues: ValidationIssue[]): void {
  if (!node.id) issue(issues, `${path}.id`, "SPEC.ID_REQUIRED", "A stable ID is required.");
  if (node.kind === "block") {
    if (!semanticKeyPattern.test(node.block)) {
      issue(issues, `${path}.block`, "SPEC.KEY_INVALID", "Block must be a semantic key.");
    }
    return;
  }
  if (
    node.columns !== undefined &&
    (!Number.isInteger(node.columns) || node.columns < 1 || node.columns > 12)
  ) {
    issue(
      issues,
      `${path}.columns`,
      "SPEC.RANGE_INVALID",
      "Group columns must be an integer from 1 to 12.",
    );
  }
  node.children.forEach((child, childIndex) =>
    validatePageNode(child, `${path}.children.${childIndex}`, issues),
  );
}

function validateView(
  view: ViewDefinition,
  index: number,
  spec: Spec,
  issues: ValidationIssue[],
): void {
  const path = `views.${index}`;
  if (!semanticKeyPattern.test(view.source)) {
    issue(issues, `${path}.source`, "SPEC.KEY_INVALID", "View source must be a semantic key.");
    return;
  }
  const collection = spec.collections.find((item) => item.key === view.source);
  const binding = spec.sources.some((item) => item.key === view.source);
  if (!collection && !binding) {
    issue(
      issues,
      `${path}.source`,
      "SPEC.REFERENCE_UNRESOLVED",
      "The View Source is not declared in this Spec.",
    );
    return;
  }
  if (view.presentation && !semanticKeyPattern.test(view.presentation.block)) {
    issue(
      issues,
      `${path}.presentation.block`,
      "SPEC.KEY_INVALID",
      "Block must be a semantic key.",
    );
  }
  const query = view.query;
  const parameterKeys = new Set<string>();
  view.parameters?.forEach((parameter, parameterIndex) => {
    const parameterPath = `${path}.parameters.${parameterIndex}`;
    if (!semanticKeyPattern.test(parameter.key)) {
      issue(
        issues,
        `${parameterPath}.key`,
        "SPEC.KEY_INVALID",
        "View parameter key must be semantic.",
      );
    } else if (parameterKeys.has(parameter.key)) {
      issue(
        issues,
        `${parameterPath}.key`,
        "SPEC.KEY_DUPLICATE",
        "View parameter key is duplicated.",
      );
    }
    parameterKeys.add(parameter.key);
  });
  if (!query) {
    if (collection) validateViewParameterPaths(view, path, collection, spec, issues);
    return;
  }
  const aliases = new Set<string>();
  query.select?.forEach((selection, selectionIndex) => {
    const selectionPath = `${path}.query.select.${selectionIndex}`;
    if (!semanticKeyPattern.test(selection.as)) {
      issue(
        issues,
        `${selectionPath}.as`,
        "SPEC.KEY_INVALID",
        "Selection alias must be a semantic key.",
      );
    } else if (aliases.has(selection.as)) {
      issue(issues, `${selectionPath}.as`, "SPEC.KEY_DUPLICATE", "Selection alias is duplicated.");
    }
    aliases.add(selection.as);
  });
  if (query.aggregate) {
    if (query.select)
      issue(
        issues,
        `${path}.query.select`,
        "SPEC.PROPERTY_CONFLICT",
        "Select and aggregate cannot be combined.",
      );
    const output = new Set([query.aggregate.group.as]);
    if (!semanticKeyPattern.test(query.aggregate.group.as))
      issue(
        issues,
        `${path}.query.aggregate.group.as`,
        "SPEC.KEY_INVALID",
        "Group alias must be semantic.",
      );
    query.aggregate.measures.forEach((measure, measureIndex) => {
      const measurePath = `${path}.query.aggregate.measures.${measureIndex}`;
      if (!semanticKeyPattern.test(measure.as))
        issue(issues, `${measurePath}.as`, "SPEC.KEY_INVALID", "Measure alias must be semantic.");
      else if (output.has(measure.as))
        issue(
          issues,
          `${measurePath}.as`,
          "SPEC.KEY_DUPLICATE",
          "Aggregate output alias is duplicated.",
        );
      output.add(measure.as);
      if (measure.operation !== "count" && !measure.path && !measure.paths?.length)
        issue(
          issues,
          measurePath,
          "SPEC.AGGREGATE_PATH_REQUIRED",
          "Numeric aggregate measures need a path.",
        );
      if (measure.paths && measure.operation !== "avg")
        issue(
          issues,
          `${measurePath}.paths`,
          "SPEC.PROPERTY_UNSUPPORTED",
          "Multiple paths are supported only by average measures.",
        );
    });
    query.aggregate.sort?.forEach((sort, sortIndex) => {
      if (!output.has(sort.key))
        issue(
          issues,
          `${path}.query.aggregate.sort.${sortIndex}.key`,
          "SPEC.REFERENCE_UNRESOLVED",
          "Aggregate sort key must name a group or measure output.",
        );
    });
  }
  // Bound Source schemas are instance data and are validated again when the View executes.
  if (!collection) return;
  const collections = new Map(spec.collections.map((item) => [item.id, item]));
  const boundSourceIds = new Set(spec.sources.map((source) => source.id));
  for (const [fieldPath, fieldPathLabel] of queryPaths(query, `${path}.query`)) {
    validateSourcePath(collection, fieldPath, collections, boundSourceIds, fieldPathLabel, issues);
  }
  validateViewParameterPaths(view, path, collection, spec, issues);
}

function validateViewParameterPaths(
  view: ViewDefinition,
  path: string,
  collection: CollectionDefinition,
  spec: Spec,
  issues: ValidationIssue[],
): void {
  const collections = new Map(spec.collections.map((item) => [item.id, item]));
  const boundSourceIds = new Set(spec.sources.map((source) => source.id));
  view.parameters?.forEach((parameter, index) =>
    validateSourcePath(
      collection,
      parameter.path,
      collections,
      boundSourceIds,
      `${path}.parameters.${index}.path`,
      issues,
    ),
  );
}

function queryPaths(
  query: SourceQueryDefinition,
  base = "query",
): Array<readonly [readonly string[], string]> {
  const paths: Array<readonly [readonly string[], string]> = [];
  collectFilterPaths(query.filter, `${base}.filter`, paths);
  query.sort?.forEach((sort, index) => paths.push([sort.path, `${base}.sort.${index}.path`]));
  query.select?.forEach((selection, index) =>
    paths.push([selection.path, `${base}.select.${index}.path`]),
  );
  if (query.aggregate) {
    paths.push([query.aggregate.group.path, `${base}.aggregate.group.path`]);
    if (query.aggregate.group.labelPath)
      paths.push([query.aggregate.group.labelPath, `${base}.aggregate.group.labelPath`]);
    query.aggregate.measures.forEach((measure, index) => {
      if (measure.path) paths.push([measure.path, `${base}.aggregate.measures.${index}.path`]);
      measure.paths?.forEach((path, pathIndex) =>
        paths.push([path, `${base}.aggregate.measures.${index}.paths.${pathIndex}`]),
      );
    });
  }
  return paths;
}

function collectFilterPaths(
  filter: SourceFilter | undefined,
  path: string,
  output: Array<readonly [readonly string[], string]>,
): void {
  if (!filter) return;
  if ("all" in filter) {
    filter.all.forEach((item, index) => collectFilterPaths(item, `${path}.all.${index}`, output));
  } else if ("any" in filter) {
    filter.any.forEach((item, index) => collectFilterPaths(item, `${path}.any.${index}`, output));
  } else if ("not" in filter) {
    collectFilterPaths(filter.not, `${path}.not`, output);
  } else {
    output.push([filter.path, `${path}.path`]);
  }
}

function validateSourcePath(
  root: CollectionDefinition,
  path: readonly string[],
  collections: ReadonlyMap<string, CollectionDefinition>,
  boundSourceIds: ReadonlySet<string>,
  issuePath: string,
  issues: ValidationIssue[],
): void {
  let collection = root;
  for (const [index, fieldId] of path.entries()) {
    const field = collection.fields.find((item) => item.id === fieldId);
    if (!field) {
      issue(
        issues,
        issuePath,
        "SPEC.REFERENCE_UNRESOLVED",
        "Field path contains an unknown Field.",
      );
      break;
    }
    if (index === path.length - 1) break;
    if (field.type !== "reference") {
      issue(
        issues,
        issuePath,
        "SPEC.RELATION_INVALID",
        "Only declared reference Fields may be traversed.",
      );
      break;
    }
    const target = collections.get(field.sourceId);
    if (!target) {
      // A declared bound Source gets its concrete schema from the Workspace instance.
      // Remaining path validation is repeated when the query executes.
      if (boundSourceIds.has(field.sourceId)) break;
      issue(
        issues,
        issuePath,
        "SPEC.REFERENCE_UNRESOLVED",
        "Relationship target Collection is unavailable.",
      );
      break;
    }
    collection = target;
  }
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
  sourceIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  validateIdentity(field, path, issues);
  if (field.type === "choice") validateChoices(field, path, issues);
  if (field.type === "reference" && !sourceIds.has(field.sourceId)) {
    issue(
      issues,
      `${path}.sourceId`,
      "SPEC.REFERENCE_UNRESOLVED",
      "The referenced Source does not exist in this Spec.",
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
  if (minLength !== undefined && (!Number.isInteger(minLength) || minLength < 0)) {
    issue(
      issues,
      `${path}.validation.minLength`,
      "SPEC.RANGE_INVALID",
      "Minimum length must be a non-negative integer.",
    );
  }
  if (maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength < 0)) {
    issue(
      issues,
      `${path}.validation.maxLength`,
      "SPEC.RANGE_INVALID",
      "Maximum length must be a non-negative integer.",
    );
  }
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
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
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
      if (typeof value !== "string" || !isDateOnly(value)) return invalidType();
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
  spec.forms.forEach((form, formIndex) => {
    if (form.mode !== "standalone") return;
    form.fields.forEach((field, fieldIndex) => {
      visit(field.id, `forms.${formIndex}.fields.${fieldIndex}.id`);
      if (field.type === "choice") {
        field.options.forEach((option, optionIndex) =>
          visit(option.id, `forms.${formIndex}.fields.${fieldIndex}.options.${optionIndex}.id`),
        );
      }
    });
  });
  spec.pages.forEach((page, pageIndex) =>
    visitPageNodeIds(page.layout, `pages.${pageIndex}.layout`, visit),
  );
  for (const [property, definitions] of otherDefinitions(spec)) {
    definitions.forEach((definition, index) => visit(definition.id, `${property}.${index}.id`));
  }
}

function visitPageNodeIds(
  nodes: readonly PageLayoutNode[],
  path: string,
  visit: (id: string, path: string) => void,
): void {
  nodes.forEach((node, index) => {
    const nodePath = `${path}.${index}`;
    visit(node.id, `${nodePath}.id`);
    if (node.kind === "group") visitPageNodeIds(node.children, `${nodePath}.children`, visit);
  });
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

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function issue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}
