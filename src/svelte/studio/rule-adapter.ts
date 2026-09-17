import { nanoid } from "nanoid";
import type {
  CollectionDefinition,
  RuleAction,
  RuleActionCall,
  RuleDefinition,
  RulePredicate,
  RuleStep as CanonicalStep,
  RuleTriggerDefinition,
  Spec,
} from "@jthum/framework/spec";
import type {
  AutomationBinding,
  AutomationEffect,
  AutomationEffectCall,
  AutomationInput,
  AutomationPredicate,
  AutomationTrigger,
  AutomationValue,
  RuleDraft,
  RuleStep,
} from "./rule-model.js";

export class RuleAuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleAuthoringError";
  }
}

export type RuleAuthoringSchemas = Readonly<Record<string, CollectionDefinition>>;

/** Translate a portable Rule into Studio's key-oriented working model. */
export function ruleDraftFromDefinition(
  rule: RuleDefinition,
  spec: Spec,
  suppliedSchemas: RuleAuthoringSchemas = {},
): RuleDraft {
  const schemas = ruleSchemas(spec, suppliedSchemas);
  const inputs = canonicalInputSources(rule, spec);
  collectCanonicalOutputs(rule.steps, spec, inputs);
  return {
    id: rule.id,
    key: rule.key,
    label: rule.label,
    ...(rule.description ? { description: rule.description } : {}),
    ...(rule.meta ? { meta: structuredClone(rule.meta) } : {}),
    ...(rule.enabled !== undefined ? { enabled: rule.enabled } : {}),
    ...(rule.priority !== undefined ? { priority: rule.priority } : {}),
    ...(rule.input
      ? {
          input: Object.fromEntries(
            Object.entries(rule.input).map(([key, input]) => [
              key,
              "sourceId" in input
                ? {
                    record: sourceKey(spec, input.sourceId),
                    ...(input.required !== undefined ? { required: input.required } : {}),
                  }
                : draftClone<AutomationInput>(input),
            ]),
          ),
        }
      : {}),
    ...(rule.trigger ? { trigger: draftTrigger(rule.trigger, spec, schemas) } : {}),
    ...(rule.expose ? { expose: [...rule.expose] } : {}),
    steps: rule.steps.map((step) => draftStep(step, spec, schemas, inputs)),
  };
}

/** Translate Studio's working model to the canonical, identity-based Rule contract. */
export function ruleDefinitionFromDraft(
  draft: RuleDraft,
  spec: Spec,
  suppliedSchemas: RuleAuthoringSchemas = {},
): RuleDefinition {
  const schemas = ruleSchemas(spec, suppliedSchemas);
  const authoredInputs = draft.input ?? inferredTriggerInputs(draft.trigger, spec);
  const inputs = draftInputSources(authoredInputs);
  collectDraftOutputs(draft.steps, inputs);
  return {
    id: draft.id,
    key: draft.key,
    label: draft.label,
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.meta ? { meta: structuredClone(draft.meta) } : {}),
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    ...(draft.priority !== undefined ? { priority: draft.priority } : {}),
    ...(authoredInputs
      ? {
          input: Object.fromEntries(
            Object.entries(authoredInputs).map(([key, input]) => [
              key,
              "record" in input
                ? {
                    sourceId: sourceId(spec, input.record),
                    ...(input.required !== undefined ? { required: input.required } : {}),
                  }
                : structuredClone(input),
            ]),
          ),
        }
      : {}),
    ...(draft.trigger ? { trigger: canonicalTrigger(draft.trigger, spec, schemas) } : {}),
    ...(draft.expose ? { expose: [...draft.expose] } : {}),
    steps: draft.steps.map((step) => canonicalStep(step, spec, schemas, inputs)),
  };
}

function draftStep(
  step: CanonicalStep,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): RuleStep {
  const id = step.id;
  if ("action" in step) return { id, effect: draftAction(step.action, spec, schemas, inputs) };
  if ("invoke" in step)
    return {
      id,
      invoke: {
        workflow: ruleKey(spec, step.invoke.ruleId),
        ...(step.invoke.input
          ? { input: draftClone<Record<string, AutomationValue>>(step.invoke.input) }
          : {}),
        ...(step.invoke.as ? { as: step.invoke.as } : {}),
      },
    };
  if ("gate" in step)
    return {
      id,
      gate: {
        predicate: draftPredicate(step.gate.predicate, schemas),
        ...(step.gate.pass
          ? { pass: step.gate.pass.map((item) => draftStep(item, spec, schemas, inputs)) }
          : {}),
        ...(step.gate.fail
          ? { fail: step.gate.fail.map((item) => draftStep(item, spec, schemas, inputs)) }
          : {}),
      },
    };
  if ("compute" in step)
    return {
      id,
      compute: { assign: draftClone<Record<string, AutomationValue>>(step.compute.assign) },
    };
  if ("delay" in step) return { id, delay: structuredClone(step.delay) };
  if ("wait" in step)
    return {
      id,
      wait: {
        ...(step.wait.signal ? { signal: step.wait.signal } : {}),
        ...(step.wait.request ? { request: structuredClone(step.wait.request) } : {}),
        ...(step.wait.timeout !== undefined ? { timeout: step.wait.timeout } : {}),
        ...(step.wait.as ? { as: step.wait.as } : {}),
        ...(step.wait.onSignal
          ? { on_signal: step.wait.onSignal.map((item) => draftStep(item, spec, schemas, inputs)) }
          : {}),
        ...(step.wait.onTimeout
          ? {
              on_timeout: step.wait.onTimeout.map((item) => draftStep(item, spec, schemas, inputs)),
            }
          : {}),
      },
    };
  if ("foreach" in step)
    return {
      id,
      foreach: {
        source: structuredClone(step.foreach.source),
        ...(step.foreach.as ? { as: step.foreach.as } : {}),
        ...(step.foreach.max !== undefined ? { max: step.foreach.max } : {}),
        ...(step.foreach.onItemFailure ? { on_item_failure: step.foreach.onItemFailure } : {}),
        steps: step.foreach.steps.map((item) => draftStep(item, spec, schemas, inputs)),
      },
    };
  if ("repeat" in step)
    return {
      id,
      repeat: {
        times: structuredClone(step.repeat.times),
        ...(step.repeat.as ? { as: step.repeat.as } : {}),
        ...(step.repeat.max !== undefined ? { max: step.repeat.max } : {}),
        ...(step.repeat.onItemFailure ? { on_item_failure: step.repeat.onItemFailure } : {}),
        steps: step.repeat.steps.map((item) => draftStep(item, spec, schemas, inputs)),
      },
    };
  return {
    id,
    parallel: {
      ...(step.parallel.join ? { join: step.parallel.join } : {}),
      branches: step.parallel.branches.map((branch) => ({
        id: branch.id,
        ...(branch.key ? { key: branch.key } : {}),
        steps: branch.steps.map((item) => draftStep(item, spec, schemas, inputs)),
      })),
    },
  };
}

function canonicalStep(
  step: RuleStep,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): CanonicalStep {
  const id = step.id || nanoid();
  if ("effect" in step) return { id, action: canonicalAction(step.effect, spec, schemas, inputs) };
  if ("invoke" in step)
    return {
      id,
      invoke: {
        ruleId: ruleId(spec, step.invoke.workflow),
        ...(step.invoke.input ? { input: structuredClone(step.invoke.input) } : {}),
        ...(step.invoke.as ? { as: step.invoke.as } : {}),
      },
    };
  if ("gate" in step)
    return {
      id,
      gate: {
        predicate: canonicalPredicate(step.gate.predicate, schemas, inputs),
        ...(step.gate.pass
          ? { pass: step.gate.pass.map((item) => canonicalStep(item, spec, schemas, inputs)) }
          : {}),
        ...(step.gate.fail
          ? { fail: step.gate.fail.map((item) => canonicalStep(item, spec, schemas, inputs)) }
          : {}),
      },
    };
  if ("compute" in step) return { id, compute: structuredClone(step.compute) };
  if ("delay" in step) return { id, delay: structuredClone(step.delay) };
  if ("wait" in step)
    return {
      id,
      wait: {
        ...(step.wait.signal ? { signal: step.wait.signal } : {}),
        ...(step.wait.request ? { request: structuredClone(step.wait.request) } : {}),
        ...(step.wait.timeout !== undefined ? { timeout: step.wait.timeout } : {}),
        ...(step.wait.as ? { as: step.wait.as } : {}),
        ...(step.wait.on_signal
          ? {
              onSignal: step.wait.on_signal.map((item) =>
                canonicalStep(item, spec, schemas, inputs),
              ),
            }
          : {}),
        ...(step.wait.on_timeout
          ? {
              onTimeout: step.wait.on_timeout.map((item) =>
                canonicalStep(item, spec, schemas, inputs),
              ),
            }
          : {}),
      },
    };
  if ("foreach" in step)
    return {
      id,
      foreach: {
        source: structuredClone(step.foreach.source),
        ...(step.foreach.as ? { as: step.foreach.as } : {}),
        ...(step.foreach.max !== undefined ? { max: step.foreach.max } : {}),
        ...(step.foreach.on_item_failure ? { onItemFailure: step.foreach.on_item_failure } : {}),
        steps: step.foreach.steps.map((item) => canonicalStep(item, spec, schemas, inputs)),
      },
    };
  if ("repeat" in step)
    return {
      id,
      repeat: {
        times: structuredClone(step.repeat.times),
        ...(step.repeat.as ? { as: step.repeat.as } : {}),
        ...(step.repeat.max !== undefined ? { max: step.repeat.max } : {}),
        ...(step.repeat.on_item_failure ? { onItemFailure: step.repeat.on_item_failure } : {}),
        steps: step.repeat.steps.map((item) => canonicalStep(item, spec, schemas, inputs)),
      },
    };
  return {
    id,
    parallel: {
      ...(step.parallel.join ? { join: step.parallel.join } : {}),
      branches: step.parallel.branches.map((branch) => ({
        id: branch.id || nanoid(),
        ...(branch.key ? { key: branch.key } : {}),
        steps: branch.steps.map((item) => canonicalStep(item, spec, schemas, inputs)),
      })),
    },
  };
}

function draftAction(
  action: RuleAction,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): AutomationEffect {
  return {
    ...draftActionCall(action, spec, schemas, inputs),
    ...(action.as ? { as: action.as } : {}),
    ...(action.retry
      ? {
          retry: {
            max: action.retry.max,
            ...(action.retry.backoff ? { backoff: [...action.retry.backoff] } : {}),
          },
        }
      : {}),
    ...(action.compensate
      ? { compensate: draftActionCall(action.compensate, spec, schemas, inputs) }
      : {}),
  };
}

function canonicalAction(
  effect: AutomationEffect,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): RuleAction {
  return {
    ...canonicalActionCall(effect, spec, schemas, inputs),
    ...(effect.as ? { as: effect.as } : {}),
    ...(effect.retry ? { retry: structuredClone(effect.retry) } : {}),
    ...(effect.compensate
      ? { compensate: canonicalActionCall(effect.compensate, spec, schemas, inputs) }
      : {}),
  };
}

function draftActionCall(
  action: RuleActionCall,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): AutomationEffectCall {
  let key = action.key;
  let params = action.input ? draftClone<Record<string, AutomationValue>>(action.input) : undefined;
  if (key === "records.update" && params?.record !== undefined) key = "records.set";
  if ((key === "records.set" || key === "records.create") && isAutomationObject(params?.values)) {
    const sourceKey = actionSourceKey(params, spec, inputs);
    params = { ...params, values: draftFieldValues(params.values, sourceKey, schemas) };
  }
  if (key === "records.list" && typeof params?.sourceId === "string") {
    const where = draftQueryFilters(params.query, params.sourceId, spec);
    if (where !== null) {
      const { sourceId: id, query: _query, ...rest } = params;
      key = "records.query";
      params = {
        ...rest,
        type: sourceKey(spec, id as string),
        ...(Object.keys(where).length ? { where } : {}),
      };
    }
  }
  if (key === "views.query" && typeof params?.viewId === "string") {
    const view = spec.views.find((candidate) => candidate.id === params?.viewId);
    if (!view) throw new RuleAuthoringError(`View ${params.viewId} is unavailable.`);
    const parameters = params.parameters;
    if (parameters === undefined || isAutomationObject(parameters)) {
      const { viewId: _viewId, parameters: _parameters, ...rest } = params;
      key = "records.query";
      params = {
        ...rest,
        view: view.key,
        ...(parameters && Object.keys(parameters).length ? { where: parameters } : {}),
      };
    }
  }
  if (
    key === "records.create" &&
    typeof params?.sourceId === "string" &&
    !("type" in params) &&
    !("fields" in params)
  ) {
    const { sourceId: id, values, ...rest } = params;
    params = {
      ...rest,
      type: sourceKey(spec, id as string),
      ...(values !== undefined ? { fields: values } : {}),
    };
  }
  return {
    key,
    ...(params ? { params } : {}),
    ...(action.runAs ? { runAs: action.runAs } : {}),
  };
}

function canonicalActionCall(
  effect: AutomationEffectCall,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): RuleActionCall {
  let key = effect.key === "records.set" ? "records.update" : effect.key;
  let input = effect.params ? structuredClone(effect.params) : undefined;
  if (key === "records.query" && input) {
    const where = queryWhere(input.where);
    if (typeof input.type === "string" && !("view" in input)) {
      const source = sourceDefinitionByKey(spec, input.type);
      const { type: _type, where: _where, ...rest } = input;
      key = "records.list";
      input = {
        ...rest,
        sourceId: source.id,
        ...(Object.keys(where).length
          ? { query: { filter: canonicalQueryFilter(where, source.id, spec) } }
          : {}),
      };
    } else if (typeof input.view === "string" && !("type" in input)) {
      const view = spec.views.find((candidate) => candidate.key === input?.view);
      if (!view) throw new RuleAuthoringError(`View ${input.view} is unavailable.`);
      const allowed = new Set((view.parameters ?? []).map((parameter) => parameter.key));
      for (const parameter of Object.keys(where))
        if (!allowed.has(parameter))
          throw new RuleAuthoringError(
            `View ${view.key} does not declare the ${parameter} parameter.`,
          );
      const { view: _view, where: _where, ...rest } = input;
      key = "views.query";
      input = {
        ...rest,
        viewId: view.id,
        ...(Object.keys(where).length ? { parameters: where } : {}),
      };
    } else {
      throw new RuleAuthoringError("Choose one record Source or View before saving a query step.");
    }
  }
  if (key === "records.create" && input && "type" in input && !("sourceId" in input)) {
    if (typeof input.type !== "string")
      throw new RuleAuthoringError("Choose a record Source before saving a create step.");
    if ("values" in input)
      throw new RuleAuthoringError("A create step cannot mix fields and canonical values.");
    const { type, fields, ...rest } = input;
    const schema = schemas[type];
    if (!schema) throw new RuleAuthoringError(`Source schema ${type} is unavailable.`);
    input = {
      ...rest,
      sourceId: sourceId(spec, type),
      ...(fields !== undefined
        ? { values: canonicalFieldValues(fields, schema, "Create record") }
        : {}),
    };
  }
  if (key === "records.update" && input && isAutomationObject(input.values)) {
    const sourceKey = actionSourceKey(input, spec, inputs);
    const schema = sourceKey ? schemas[sourceKey] : undefined;
    if (!schema)
      throw new RuleAuthoringError("Choose a typed record before saving an update step.");
    input = { ...input, values: canonicalFieldValues(input.values, schema, "Update record") };
  }
  return {
    key,
    ...(input ? { input } : {}),
    ...(effect.runAs ? { runAs: effect.runAs } : {}),
  };
}

function sourceDefinitionByKey(spec: Spec, key: string) {
  const source = [...spec.collections, ...spec.sources].find((item) => item.key === key);
  if (!source) throw new RuleAuthoringError(`Source ${key} is unavailable.`);
  return source;
}

function queryWhere(value: AutomationValue | undefined): Record<string, AutomationValue> {
  if (value === undefined) return {};
  if (!isAutomationObject(value))
    throw new RuleAuthoringError("Additional query filters must be a field map.");
  return value;
}

function canonicalQueryFilter(
  where: Record<string, AutomationValue>,
  sourceIdValue: string,
  spec: Spec,
): AutomationValue {
  const collection = spec.collections.find((candidate) => candidate.id === sourceIdValue);
  if (!collection)
    throw new RuleAuthoringError(
      "Additional filters for attached Sources are not editable until their schema is loaded.",
    );
  const filters = Object.entries(where).map(([key, value]) => {
    const field = collection.fields.find((candidate) => candidate.key === key);
    if (!field) throw new RuleAuthoringError(`Query Field ${key} is unavailable.`);
    return { path: [field.id], operator: "eq", value };
  });
  return filters.length === 1 ? filters[0]! : { all: filters };
}

function draftQueryFilters(
  value: AutomationValue | undefined,
  sourceIdValue: string,
  spec: Spec,
): Record<string, AutomationValue> | null {
  if (value === undefined) return {};
  if (!isAutomationObject(value)) return null;
  const filter = value.filter;
  if (filter === undefined) return Object.keys(value).length ? null : {};
  if (Object.keys(value).some((key) => key !== "filter")) return null;
  const collection = spec.collections.find((candidate) => candidate.id === sourceIdValue);
  if (!collection || !isAutomationObject(filter)) return null;
  const items = "all" in filter && Array.isArray(filter.all) ? filter.all : [filter];
  const where: Record<string, AutomationValue> = {};
  for (const item of items) {
    if (
      !isAutomationObject(item) ||
      item.operator !== "eq" ||
      !Array.isArray(item.path) ||
      item.path.length !== 1 ||
      typeof item.path[0] !== "string" ||
      !("value" in item)
    )
      return null;
    const fieldId = item.path[0];
    const field = collection.fields.find((candidate) => candidate.id === fieldId);
    if (!field || field.key in where) return null;
    where[field.key] = item.value as AutomationValue;
  }
  return where;
}

function ruleSchemas(spec: Spec, supplied: RuleAuthoringSchemas): RuleAuthoringSchemas {
  return {
    ...Object.fromEntries(spec.collections.map((collection) => [collection.key, collection])),
    ...supplied,
  };
}

function canonicalInputSources(rule: RuleDefinition, spec: Spec): Map<string, string> {
  return new Map(
    Object.entries(rule.input ?? {}).flatMap(([name, input]) =>
      "sourceId" in input ? [[name, sourceKey(spec, input.sourceId)] as const] : [],
    ),
  );
}

function draftInputSources(
  inputs: Readonly<Record<string, AutomationInput>> | undefined,
): Map<string, string> {
  return new Map(
    Object.entries(inputs ?? {}).flatMap(([name, input]) =>
      "record" in input ? [[name, input.record] as const] : [],
    ),
  );
}

function inferredTriggerInputs(
  trigger: AutomationTrigger | undefined,
  spec: Spec,
): Record<string, AutomationInput> | undefined {
  if (!trigger) return undefined;
  for (const source of [...spec.collections, ...spec.sources]) {
    const exact = [
      `${source.key}.created`,
      `${source.key}.changed`,
      `${source.key}.deleted`,
    ].includes(trigger.key);
    const field = trigger.key.startsWith(`${source.key}.`) && trigger.key.endsWith(".changed");
    if (exact || field) return { [source.key]: { record: source.key } };
  }
  return undefined;
}

function collectCanonicalOutputs(
  steps: readonly CanonicalStep[],
  spec: Spec,
  sources: Map<string, string>,
): void {
  for (const step of steps) {
    if (
      "action" in step &&
      step.action.as &&
      step.action.key === "records.create" &&
      typeof step.action.input?.sourceId === "string"
    )
      sources.set(step.action.as, sourceKey(spec, step.action.input.sourceId));
    for (const children of canonicalStepChildren(step))
      collectCanonicalOutputs(children, spec, sources);
  }
}

function collectDraftOutputs(steps: readonly RuleStep[], sources: Map<string, string>): void {
  for (const step of steps) {
    if (
      "effect" in step &&
      step.effect.as &&
      step.effect.key === "records.create" &&
      typeof step.effect.params?.type === "string"
    )
      sources.set(step.effect.as, step.effect.params.type);
    for (const children of draftStepChildren(step)) collectDraftOutputs(children, sources);
  }
}

function canonicalStepChildren(step: CanonicalStep): readonly (readonly CanonicalStep[])[] {
  if ("gate" in step) return [step.gate.pass ?? [], step.gate.fail ?? []];
  if ("wait" in step) return [step.wait.onSignal ?? [], step.wait.onTimeout ?? []];
  if ("foreach" in step) return [step.foreach.steps];
  if ("repeat" in step) return [step.repeat.steps];
  if ("parallel" in step) return step.parallel.branches.map((branch) => branch.steps);
  return [];
}

function draftStepChildren(step: RuleStep): readonly (readonly RuleStep[])[] {
  if ("gate" in step) return [step.gate.pass ?? [], step.gate.fail ?? []];
  if ("wait" in step) return [step.wait.on_signal ?? [], step.wait.on_timeout ?? []];
  if ("foreach" in step) return [step.foreach.steps];
  if ("repeat" in step) return [step.repeat.steps];
  if ("parallel" in step) return step.parallel.branches.map((branch) => branch.steps);
  return [];
}

function canonicalPredicate(
  predicate: AutomationPredicate,
  schemas: RuleAuthoringSchemas,
  inputs: ReadonlyMap<string, string>,
): RulePredicate {
  if ("all" in predicate && Array.isArray(predicate.all))
    return {
      all: (predicate.all as AutomationPredicate[]).map((item) =>
        canonicalPredicate(item, schemas, inputs),
      ),
    };
  if ("any" in predicate && Array.isArray(predicate.any))
    return {
      any: (predicate.any as AutomationPredicate[]).map((item) =>
        canonicalPredicate(item, schemas, inputs),
      ),
    };
  if ("not" in predicate && isAutomationPredicate(predicate.not))
    return { not: canonicalPredicate(predicate.not, schemas, inputs) };
  const condition = structuredClone(predicate) as Record<string, AutomationValue> & { op: string };
  const path = condition.path;
  if (typeof path !== "string") return condition;
  const parts = path.split(".");
  if (parts.length !== 3 || parts[0] !== "vars") return condition;
  const sourceKeyValue = inputs.get(parts[1]!);
  const field = sourceKeyValue
    ? schemas[sourceKeyValue]?.fields.find((candidate) => candidate.key === parts[2])
    : undefined;
  if (!field) return condition;
  const { path: _path, ...rest } = condition;
  return { ...rest, left: { $ref: `vars.${parts[1]}`, fieldId: field.id } };
}

function draftPredicate(
  predicate: RulePredicate,
  schemas: RuleAuthoringSchemas,
): AutomationPredicate {
  if ("all" in predicate && Array.isArray(predicate.all))
    return { all: predicate.all.map((item) => draftPredicate(item, schemas)) };
  if ("any" in predicate && Array.isArray(predicate.any))
    return { any: predicate.any.map((item) => draftPredicate(item, schemas)) };
  if ("not" in predicate && isRulePredicate(predicate.not))
    return { not: draftPredicate(predicate.not, schemas) };
  const condition = structuredClone(predicate) as unknown as Record<string, AutomationValue> & {
    op: string;
  };
  const left = condition.left;
  if (!isFieldBinding(left)) return condition;
  const field = findFieldById(left.fieldId, schemas);
  if (!field) throw new RuleAuthoringError(`Rule Field ${left.fieldId} is unavailable.`);
  const { left: _left, ...rest } = condition;
  return { ...rest, path: `${left.$ref}.${field.key}` };
}

function actionSourceKey(
  input: Record<string, AutomationValue>,
  spec: Spec,
  inputs: ReadonlyMap<string, string>,
): string | undefined {
  if (typeof input.sourceId === "string") return sourceKey(spec, input.sourceId);
  if (typeof input.type === "string") return input.type;
  const record = input.record;
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    !("$ref" in record) ||
    typeof record.$ref !== "string"
  )
    return undefined;
  const match = /^vars\.([A-Za-z0-9_-]+)$/.exec(record.$ref);
  return match ? inputs.get(match[1]!) : undefined;
}

function canonicalFieldValues(
  value: AutomationValue,
  schema: CollectionDefinition,
  label: string,
): Record<string, AutomationValue> {
  if (!isAutomationObject(value))
    throw new RuleAuthoringError(`${label} values must be a field map.`);
  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => {
      const field = schema.fields.find((candidate) => candidate.key === key);
      if (!field) throw new RuleAuthoringError(`${label} Field ${key} is unavailable.`);
      return [field.id, fieldValue];
    }),
  );
}

function draftFieldValues(
  value: Record<string, AutomationValue>,
  sourceKeyValue: string | undefined,
  schemas: RuleAuthoringSchemas,
): Record<string, AutomationValue> {
  const schema = sourceKeyValue ? schemas[sourceKeyValue] : undefined;
  if (!schema) throw new RuleAuthoringError("Record Action Source schema is unavailable.");
  return Object.fromEntries(
    Object.entries(value).map(([fieldId, fieldValue]) => {
      const field = schema.fields.find((candidate) => candidate.id === fieldId);
      if (!field) throw new RuleAuthoringError(`Record Action Field ${fieldId} is unavailable.`);
      return [field.key, fieldValue];
    }),
  );
}

function findFieldById(
  id: string,
  schemas: RuleAuthoringSchemas,
): CollectionDefinition["fields"][number] | undefined {
  for (const schema of Object.values(schemas)) {
    const field = schema.fields.find((candidate) => candidate.id === id);
    if (field) return field;
  }
  return undefined;
}

function isFieldBinding(value: unknown): value is AutomationBinding & { fieldId: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "$ref" in value &&
    typeof value.$ref === "string" &&
    "fieldId" in value &&
    typeof value.fieldId === "string",
  );
}

function isAutomationPredicate(value: unknown): value is AutomationPredicate {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRulePredicate(value: unknown): value is RulePredicate {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAutomationObject(value: unknown): value is Record<string, AutomationValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && !("$ref" in value));
}

function draftTrigger(
  trigger: RuleTriggerDefinition,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
): AutomationTrigger {
  if (trigger.event === "form.submitted" && trigger.formId)
    return {
      key: trigger.event,
      config: {
        ...(trigger.config ? draftClone<Record<string, AutomationValue>>(trigger.config) : {}),
        form: formKey(spec, trigger.formId),
      },
    };
  if (trigger.event.startsWith("record.") && trigger.sourceId) {
    const source = sourceDefinition(spec, trigger.sourceId);
    if (trigger.event === "record.field_changed" && trigger.fieldId) {
      const field = schemas[source.key]?.fields.find((item) => item.id === trigger.fieldId);
      if (!field) throw new RuleAuthoringError(`Trigger Field ${trigger.fieldId} is unavailable.`);
      return {
        key: `${source.key}.${field.key}.changed`,
        ...(trigger.config
          ? { config: draftClone<Record<string, AutomationValue>>(trigger.config) }
          : {}),
      };
    }
    const suffix = trigger.event.slice("record.".length).replace("updated", "changed");
    return {
      key: `${source.key}.${suffix}`,
      ...(trigger.config
        ? { config: draftClone<Record<string, AutomationValue>>(trigger.config) }
        : {}),
    };
  }
  return {
    key: trigger.event,
    ...(trigger.config
      ? { config: draftClone<Record<string, AutomationValue>>(trigger.config) }
      : {}),
  };
}

function canonicalTrigger(
  trigger: AutomationTrigger,
  spec: Spec,
  schemas: RuleAuthoringSchemas,
): RuleTriggerDefinition {
  if (trigger.key === "form.submitted" && typeof trigger.config?.form === "string") {
    const { form: _form, ...config } = trigger.config;
    return {
      event: trigger.key,
      formId: formId(spec, trigger.config.form),
      ...(Object.keys(config).length ? { config } : {}),
    };
  }
  for (const source of [...spec.collections, ...spec.sources]) {
    if (trigger.key === `${source.key}.created`)
      return {
        event: "record.created",
        sourceId: source.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    if (trigger.key === `${source.key}.changed`)
      return {
        event: "record.updated",
        sourceId: source.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    if (trigger.key === `${source.key}.deleted`)
      return {
        event: "record.deleted",
        sourceId: source.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    const prefix = `${source.key}.`,
      suffix = ".changed";
    if (trigger.key.startsWith(prefix) && trigger.key.endsWith(suffix)) {
      const key = trigger.key.slice(prefix.length, -suffix.length);
      const field = schemas[source.key]?.fields.find((item) => item.key === key);
      if (!field) throw new RuleAuthoringError(`Trigger Field ${key} is unavailable.`);
      return {
        event: "record.field_changed",
        sourceId: source.id,
        fieldId: field.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    }
  }
  return {
    event: trigger.key,
    ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
  };
}

function sourceDefinition(spec: Spec, id: string) {
  const source = [...spec.collections, ...spec.sources].find((item) => item.id === id);
  if (!source) throw new RuleAuthoringError(`Source ${id} is unavailable.`);
  return source;
}
function sourceKey(spec: Spec, id: string): string {
  return sourceDefinition(spec, id).key;
}
function sourceId(spec: Spec, key: string): string {
  const source = [...spec.collections, ...spec.sources].find((item) => item.key === key);
  if (!source) throw new RuleAuthoringError(`Source ${key} is unavailable.`);
  return source.id;
}
function ruleKey(spec: Spec, id: string): string {
  const rule = spec.rules.find((item) => item.id === id);
  if (!rule) throw new RuleAuthoringError(`Rule ${id} is unavailable.`);
  return rule.key;
}
function ruleId(spec: Spec, key: string): string {
  const rule = spec.rules.find((item) => item.key === key);
  if (!rule) throw new RuleAuthoringError(`Rule ${key} is unavailable.`);
  return rule.id;
}
function formKey(spec: Spec, id: string): string {
  const form = spec.forms.find((item) => item.id === id);
  if (!form) throw new RuleAuthoringError(`Form ${id} is unavailable.`);
  return form.key;
}
function formId(spec: Spec, key: string): string {
  const form = spec.forms.find((item) => item.key === key);
  if (!form) throw new RuleAuthoringError(`Form ${key} is unavailable.`);
  return form.id;
}

function draftClone<T>(value: unknown): T {
  return structuredClone(value) as T;
}
