import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type {
  JsonValue,
  RuleActionCall,
  RuleDefinition,
  RulePredicate,
  RuleStep,
  RuleValue,
} from "../spec/model.ts";
import type { ActionRegistry, ActionRuntime } from "./action-registry.ts";
import type { ConditionRegistry } from "./condition-registry.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext } from "./model.ts";
import {
  checkRuleCompatibility,
  type RuleCompatibilityDiagnostic,
  type RuleRuntimeProfile,
} from "./rule-compatibility.ts";

export interface RuleEvent {
  readonly event: string;
  readonly sourceId?: string;
  readonly fieldId?: string;
  readonly formId?: string;
  readonly payload?: Readonly<Record<string, JsonValue>>;
  /** Values supplied to matching Rule inputs before defaults are applied. */
  readonly input?: Readonly<Record<string, JsonValue>>;
}

export interface RunRuleInput {
  readonly input?: Readonly<Record<string, JsonValue>>;
  readonly trigger?: RuleEvent;
}

export interface RuleStepTrace {
  readonly stepId: string;
  readonly kind: RuleStepKind;
  readonly status: "completed" | "skipped";
}

export interface RuleRun {
  readonly ruleId: string;
  readonly ruleKey: string;
  readonly actorId: string;
  readonly status: "completed";
  readonly vars: Readonly<Record<string, JsonValue>>;
  readonly trace: readonly RuleStepTrace[];
}

export interface ActorBindingRequest {
  readonly binding: string;
  readonly context: ExecutionContext;
  readonly rule: RuleDefinition;
  readonly stepId: string;
  readonly scope: Readonly<Record<string, JsonValue>>;
}

export type ActorBindingResolver = (request: ActorBindingRequest) => Promise<string>;

export interface RuleServiceOptions {
  readonly maxSteps?: number;
  readonly maxDepth?: number;
}

interface RuleScope {
  trigger: Record<string, JsonValue>;
  actor: Record<string, JsonValue>;
  vars: Record<string, JsonValue>;
  meta: Record<string, JsonValue>;
}

interface RunState {
  remaining: number;
  depth: number;
  readonly trace: RuleStepTrace[];
  readonly compensations: Compensation[];
}

interface Compensation {
  readonly action: RuleActionCall;
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly context: ExecutionContext;
  readonly ruleId: string;
  readonly stepId: string;
}

type RuleStepKind =
  | "gate"
  | "compute"
  | "action"
  | "invoke"
  | "delay"
  | "wait"
  | "foreach"
  | "repeat"
  | "parallel";

/** Executes bounded, in-process Rules. Durable waits belong to a runtime-specific worker. */
export class RuleService {
  private readonly maxSteps: number;
  private readonly maxDepth: number;

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly actions: ActionRegistry,
    private readonly conditions: ConditionRegistry,
    private readonly runtime: ActionRuntime,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
    private readonly resolveSourceInput: (
      context: ExecutionContext,
      sourceId: string,
      value: JsonValue,
    ) => Promise<JsonValue>,
    private readonly resolveActor: ActorBindingResolver,
    options: RuleServiceOptions = {},
  ) {
    this.maxSteps = options.maxSteps ?? 1_000;
    this.maxDepth = options.maxDepth ?? 12;
  }

  actionKeys(): ReadonlySet<string> {
    return this.actions.keys();
  }

  conditionKeys(): ReadonlySet<string> {
    return this.conditions.keys();
  }

  profile(events: ReadonlySet<string> = new Set()): RuleRuntimeProfile {
    return {
      key: "kernel.short",
      label: "Kernel short runner",
      actions: this.actions.keys(),
      conditions: this.conditions.keys(),
      events,
      capabilities: {
        compensation: "supported",
        loops: "supported",
        nested_rules: "supported",
        parallel: "emulated",
        retries: "emulated",
        run_as: "supported",
        durable_waits: "unsupported",
        signals: "unsupported",
      },
      notes: {
        parallel: "Branches execute deterministically in-process.",
        retries: "Retries end when this process stops.",
      },
    };
  }

  async run(context: ExecutionContext, key: string, input: RunRuleInput = {}): Promise<RuleRun> {
    await this.assertContext(context);
    const rule = await this.requireRule(context, key);
    await this.authorizeRule(context, "rules.run", rule);
    if (rule.enabled === false) return disabledRule(rule);
    await this.assertExecutable(context, rule);
    const state: RunState = {
      remaining: this.maxSteps,
      depth: 0,
      trace: [],
      compensations: [],
    };
    return this.execute(context, rule, input, state);
  }

  async executeAction(
    context: ExecutionContext,
    key: string,
    input: Readonly<Record<string, JsonValue>> = {},
  ): Promise<JsonValue> {
    await this.assertContext(context);
    const state = this.createState();
    return this.invokeAction(key, input, context, { kind: "call" }, state);
  }

  async dispatch(context: ExecutionContext, event: RuleEvent): Promise<readonly RuleRun[]> {
    await this.assertContext(context);
    await this.authorize({
      context,
      operation: "rules.dispatch",
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    return this.dispatchWithState(context, event, this.createState(), workspace);
  }

  private async dispatchWithState(
    context: ExecutionContext,
    event: RuleEvent,
    state: RunState,
    knownWorkspace?: Awaited<ReturnType<CatalogRepository["getWorkspace"]>>,
  ): Promise<readonly RuleRun[]> {
    const workspace = knownWorkspace ?? (await this.catalog.getWorkspace(context.workspaceId));
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    const matches = workspace.spec.rules
      .filter((rule) => rule.enabled !== false && matchesEvent(rule, event))
      .map((rule, index) => ({ rule, index }))
      .sort(
        (left, right) =>
          (right.rule.priority ?? 0) - (left.rule.priority ?? 0) || left.index - right.index,
      );
    for (const { rule } of matches)
      await this.assertExecutable(context, rule, new Set([event.event]));
    const runs: RuleRun[] = [];
    for (const { rule } of matches) {
      runs.push(
        await this.execute(
          context,
          rule,
          { input: eventInput(rule, event), trigger: event },
          state,
        ),
      );
    }
    return runs;
  }

  private async execute(
    context: ExecutionContext,
    rule: RuleDefinition,
    input: RunRuleInput,
    state: RunState,
  ): Promise<RuleRun> {
    if (state.depth >= this.maxDepth) throw executionLimit("Rule nesting", this.maxDepth);
    state.depth += 1;
    const compensationStart = state.compensations.length;
    const scope: RuleScope = {
      trigger: {
        event: input.trigger?.event ?? "rule.called",
        ...(input.trigger?.sourceId === undefined ? {} : { sourceId: input.trigger.sourceId }),
        ...(input.trigger?.fieldId === undefined ? {} : { fieldId: input.trigger.fieldId }),
        ...(input.trigger?.formId === undefined ? {} : { formId: input.trigger.formId }),
        payload: { ...input.trigger?.payload },
      },
      actor: { id: context.actorId },
      vars: await this.prepareInputs(context, rule, input.input ?? {}),
      meta: { ruleId: rule.id, ruleKey: rule.key },
    };
    try {
      await this.runSteps(context, rule, rule.steps, scope, state);
    } catch (error) {
      await this.compensate(state, compensationStart);
      throw error;
    } finally {
      state.depth -= 1;
    }
    return {
      ruleId: rule.id,
      ruleKey: rule.key,
      actorId: context.actorId,
      status: "completed",
      vars: structuredClone(scope.vars),
      trace: structuredClone(state.trace),
    };
  }

  private async runSteps(
    context: ExecutionContext,
    rule: RuleDefinition,
    steps: readonly RuleStep[],
    scope: RuleScope,
    state: RunState,
  ): Promise<void> {
    for (const step of steps) {
      if (--state.remaining < 0) throw executionLimit("Rule steps", this.maxSteps);
      const kind = stepKind(step);
      if ("gate" in step) {
        const passed = await this.test(step.gate.predicate, scope);
        state.trace.push({ stepId: step.id, kind, status: "completed" });
        await this.runSteps(
          context,
          rule,
          passed ? (step.gate.pass ?? []) : (step.gate.fail ?? []),
          scope,
          state,
        );
      } else if ("compute" in step) {
        for (const [key, value] of Object.entries(step.compute.assign))
          scope.vars[key] = resolveValue(value, scope);
        state.trace.push({ stepId: step.id, kind, status: "completed" });
      } else if ("action" in step) {
        const resolved = resolveObject(step.action.input ?? {}, scope);
        const actionContext = await this.actionContext(
          context,
          rule,
          step.id,
          step.action.runAs,
          scope,
        );
        const output = await this.runAction(
          step.action,
          resolved,
          actionContext,
          rule.id,
          step.id,
          state,
        );
        if (step.action.as) scope.vars[step.action.as] = output;
        if (step.action.compensate)
          state.compensations.push({
            action: step.action.compensate,
            input: resolveObject(step.action.compensate.input ?? {}, scope),
            context: await this.actionContext(
              context,
              rule,
              step.id,
              step.action.compensate.runAs,
              scope,
            ),
            ruleId: rule.id,
            stepId: step.id,
          });
        state.trace.push({ stepId: step.id, kind, status: "completed" });
      } else if ("invoke" in step) {
        const nested = await this.requireRuleById(context, step.invoke.ruleId);
        await this.authorizeRule(context, "rules.run", nested);
        if (nested.enabled === false)
          throw invalidExecution(`Nested Rule ${nested.key} is disabled.`, { ruleId: nested.id });
        const result = await this.execute(
          context,
          nested,
          { input: resolveObject(step.invoke.input ?? {}, scope) },
          state,
        );
        if (step.invoke.as) scope.vars[step.invoke.as] = { ...result.vars };
        state.trace.push({ stepId: step.id, kind, status: "completed" });
      } else if ("foreach" in step) {
        const items = resolveReference(step.foreach.source.$ref, scope);
        if (!Array.isArray(items))
          throw invalidExecution("A foreach source must resolve to an array.", { stepId: step.id });
        const maximum = step.foreach.max ?? 100;
        if (items.length > maximum) throw executionLimit("foreach items", maximum);
        const name = step.foreach.as ?? "item";
        for (const item of items) {
          scope.vars[name] = item;
          try {
            await this.runSteps(context, rule, step.foreach.steps, scope, state);
          } catch (error) {
            if (step.foreach.onItemFailure !== "continue") throw error;
          }
        }
        state.trace.push({ stepId: step.id, kind, status: "completed" });
      } else if ("repeat" in step) {
        const resolved =
          typeof step.repeat.times === "number"
            ? step.repeat.times
            : resolveReference(step.repeat.times.$ref, scope);
        if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved < 0)
          throw invalidExecution("A repeat count must resolve to a non-negative integer.", {
            stepId: step.id,
          });
        const maximum = step.repeat.max ?? 100;
        if (resolved > maximum) throw executionLimit("repeat iterations", maximum);
        const name = step.repeat.as ?? "index";
        for (let index = 0; index < resolved; index += 1) {
          scope.vars[name] = index;
          try {
            await this.runSteps(context, rule, step.repeat.steps, scope, state);
          } catch (error) {
            if (step.repeat.onItemFailure !== "continue") throw error;
          }
        }
        state.trace.push({ stepId: step.id, kind, status: "completed" });
      } else if ("parallel" in step) {
        await this.runBranches(context, rule, step, scope, state);
        state.trace.push({ stepId: step.id, kind, status: "completed" });
      } else {
        throw new FrameworkError({
          code: ERROR_CODES.persistenceUnsupported,
          message: `The synchronous Rule runner does not support ${kind} steps.`,
          details: { stepId: step.id, kind },
        });
      }
    }
  }

  private async runBranches(
    context: ExecutionContext,
    rule: RuleDefinition,
    step: Extract<RuleStep, { readonly parallel: unknown }>,
    scope: RuleScope,
    state: RunState,
  ): Promise<void> {
    let firstError: unknown;
    for (const branch of step.parallel.branches) {
      const branchScope: RuleScope = structuredClone(scope);
      try {
        await this.runSteps(context, rule, branch.steps, branchScope, state);
        scope.vars[branch.key ?? branch.id] = branchScope.vars;
        if (step.parallel.join === "any") return;
      } catch (error) {
        firstError ??= error;
        if (step.parallel.join !== "any") throw error;
      }
    }
    if (step.parallel.join === "any" && firstError) throw firstError;
  }

  private async test(predicate: RulePredicate, scope: RuleScope): Promise<boolean> {
    if ("all" in predicate && Array.isArray(predicate.all)) {
      for (const child of predicate.all) if (!(await this.test(child, scope))) return false;
      return true;
    }
    if ("any" in predicate && Array.isArray(predicate.any)) {
      for (const child of predicate.any) if (await this.test(child, scope)) return true;
      return false;
    }
    if (
      "not" in predicate &&
      predicate.not &&
      typeof predicate.not === "object" &&
      !Array.isArray(predicate.not)
    )
      return !(await this.test(predicate.not as RulePredicate, scope));
    if ("op" in predicate && typeof predicate.op === "string") {
      const { op, ...raw } = predicate;
      return this.conditions.test(op, {
        input: resolveObject(raw, scope),
        read: (path) => resolveReference(path, scope),
      });
    }
    throw invalidExecution("A Rule predicate has no executable Condition key.", {});
  }

  private async runAction(
    action: RuleActionCall & {
      readonly retry?: { readonly max: number; readonly backoff?: readonly number[] };
    },
    input: Readonly<Record<string, JsonValue>>,
    context: ExecutionContext,
    ruleId: string,
    stepId: string,
    state: RunState,
  ): Promise<JsonValue> {
    const attempts = action.retry?.max ?? 1;
    let failure: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        const seconds = action.retry?.backoff?.[attempt - 1] ?? 0;
        if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
      }
      try {
        return await this.invokeAction(
          action.key,
          input,
          context,
          { kind: "rule", ruleId, stepId },
          state,
        );
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  private async actionContext(
    context: ExecutionContext,
    rule: RuleDefinition,
    stepId: string,
    binding: string | undefined,
    scope: RuleScope,
  ): Promise<ExecutionContext> {
    if (!binding || binding === "trigger") return context;
    const actorId = await this.resolveActor({
      binding,
      context,
      rule,
      stepId,
      scope: scopeValue(scope),
    });
    const resolved = { ...context, actorId };
    await this.assertContext(resolved);
    return resolved;
  }

  private async prepareInputs(
    context: ExecutionContext,
    rule: RuleDefinition,
    supplied: Readonly<Record<string, JsonValue>>,
  ): Promise<Record<string, JsonValue>> {
    const values: Record<string, JsonValue> = {};
    for (const [name, definition] of Object.entries(rule.input ?? {})) {
      let value = supplied[name];
      if (value === undefined && "default" in definition && definition.default !== undefined)
        value = resolveValue(definition.default, emptyScope(context, rule));
      if (value === undefined) {
        if (definition.required === true)
          throw invalidExecution(`Rule input ${name} is required.`, { input: name });
        continue;
      }
      values[name] =
        "sourceId" in definition
          ? await this.resolveSourceInput(context, definition.sourceId, value)
          : assertInputKind(name, definition.value, value);
    }
    const unknown = Object.keys(supplied).find((name) => !(name in (rule.input ?? {})));
    if (unknown)
      throw invalidExecution(`Rule input ${unknown} is not declared.`, { input: unknown });
    return values;
  }

  private async compensate(state: RunState, start: number): Promise<void> {
    const pending = state.compensations.splice(start);
    for (const item of pending.reverse())
      await this.invokeAction(
        item.action.key,
        item.input,
        item.context,
        { kind: "rule", ruleId: item.ruleId, stepId: item.stepId },
        state,
      );
  }

  private async requireRule(context: ExecutionContext, key: string): Promise<RuleDefinition> {
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    const rule = workspace?.spec.rules.find((candidate) => candidate.key === key);
    if (!rule) throw resourceNotFound("Rule", key);
    return rule;
  }

  private async requireRuleById(context: ExecutionContext, id: string): Promise<RuleDefinition> {
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    const rule = workspace?.spec.rules.find((candidate) => candidate.id === id);
    if (!rule) throw resourceNotFound("Rule", id);
    return rule;
  }

  private async assertExecutable(
    context: ExecutionContext,
    rule: RuleDefinition,
    events = new Set(rule.trigger ? [rule.trigger.event] : []),
    seen = new Set<string>(),
  ): Promise<void> {
    if (seen.has(rule.id)) return;
    seen.add(rule.id);
    const compatibility = checkRuleCompatibility(rule, this.profile(events));
    const unsupported = compatibility.diagnostics.filter(
      (diagnostic) => diagnostic.support === "unsupported",
    );
    if (unsupported.length > 0) throw unsupportedRule(rule, unsupported);
    for (const ruleId of invokedRuleIds(rule.steps)) {
      const nested = await this.requireRuleById(context, ruleId);
      await this.assertExecutable(context, nested, events, seen);
    }
  }

  private authorizeRule(
    context: ExecutionContext,
    operation: string,
    rule: RuleDefinition,
  ): Promise<void> {
    return this.authorize({
      context,
      operation,
      resource: { kind: "rule", id: rule.id, workspaceId: context.workspaceId },
    });
  }

  private async invokeAction(
    key: string,
    input: Readonly<Record<string, JsonValue>>,
    context: ExecutionContext,
    origin: import("./action-registry.ts").ActionOrigin,
    knownState?: RunState,
  ): Promise<JsonValue> {
    await this.authorize({
      context,
      operation: "actions.execute",
      resource: { kind: "action", id: key, workspaceId: context.workspaceId },
    });
    const state = knownState ?? this.createState();
    return this.actions.run(key, {
      context,
      input,
      runtime: this.runtime,
      origin,
      publish: async (event) => {
        await this.dispatchWithState(context, event, state);
      },
    });
  }

  private createState(): RunState {
    return {
      remaining: this.maxSteps,
      depth: 0,
      trace: [],
      compensations: [],
    };
  }
}

function matchesEvent(rule: RuleDefinition, event: RuleEvent): boolean {
  const trigger = rule.trigger;
  return Boolean(
    trigger &&
    trigger.event === event.event &&
    (trigger.sourceId === undefined || trigger.sourceId === event.sourceId) &&
    (trigger.fieldId === undefined || trigger.fieldId === event.fieldId) &&
    (trigger.formId === undefined || trigger.formId === event.formId),
  );
}

function eventInput(rule: RuleDefinition, event: RuleEvent): Readonly<Record<string, JsonValue>> {
  const input: Record<string, JsonValue> = { ...event.input };
  const record = event.payload?.record;
  if (record !== undefined && event.sourceId)
    for (const [name, definition] of Object.entries(rule.input ?? {}))
      if (
        "sourceId" in definition &&
        definition.sourceId === event.sourceId &&
        input[name] === undefined
      )
        input[name] = record;
  return input;
}

function resolveObject(
  values: Readonly<Record<string, RuleValue>>,
  scope: RuleScope,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, resolveValue(value, scope)]),
  );
}

function resolveValue(value: RuleValue, scope: RuleScope): JsonValue {
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, scope));
  if (value && typeof value === "object") {
    if ("$ref" in value && typeof value.$ref === "string") {
      const resolved = resolveReference(value.$ref, scope);
      if (resolved === undefined)
        throw invalidExecution(`Rule binding ${value.$ref} could not be resolved.`, {
          binding: value.$ref,
        });
      return structuredClone(resolved);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item as RuleValue, scope)]),
    );
  }
  return value;
}

function resolveReference(path: string, scope: RuleScope): JsonValue | undefined {
  const parts = path.split(".").filter(Boolean);
  const root = parts.shift();
  if (!root || !["trigger", "actor", "vars", "meta"].includes(root)) return undefined;
  let value: JsonValue | undefined = scope[root as keyof RuleScope];
  for (const part of parts) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = value[part];
  }
  return value;
}

function scopeValue(scope: RuleScope): Readonly<Record<string, JsonValue>> {
  return {
    trigger: scope.trigger,
    actor: scope.actor,
    vars: scope.vars,
    meta: scope.meta,
  };
}

function emptyScope(context: ExecutionContext, rule: RuleDefinition): RuleScope {
  return {
    trigger: { event: "rule.called", payload: {} },
    actor: { id: context.actorId },
    vars: {},
    meta: { ruleId: rule.id, ruleKey: rule.key },
  };
}

function assertInputKind(name: string, kind: string, value: JsonValue): JsonValue {
  const valid =
    kind === "array"
      ? Array.isArray(value)
      : kind === "object"
        ? Boolean(value && typeof value === "object" && !Array.isArray(value))
        : kind === "date"
          ? typeof value === "string" && !Number.isNaN(Date.parse(value))
          : kind === "text"
            ? typeof value === "string"
            : typeof value === kind;
  if (!valid)
    throw invalidExecution(`Rule input ${name} must be a ${kind}.`, { input: name, kind });
  return value;
}

function stepKind(step: RuleStep): RuleStepKind {
  if ("gate" in step) return "gate";
  if ("compute" in step) return "compute";
  if ("action" in step) return "action";
  if ("invoke" in step) return "invoke";
  if ("delay" in step) return "delay";
  if ("wait" in step) return "wait";
  if ("foreach" in step) return "foreach";
  if ("repeat" in step) return "repeat";
  return "parallel";
}

function invalidExecution(
  message: string,
  details: Readonly<Record<string, JsonValue>>,
): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message, details });
}

function executionLimit(kind: string, maximum: number): FrameworkError {
  return invalidExecution(`${kind} exceeded the runtime limit of ${maximum}.`, { kind, maximum });
}

function disabledRule(rule: RuleDefinition): never {
  throw invalidExecution(`Rule ${rule.key} is disabled.`, { ruleId: rule.id });
}

function invokedRuleIds(steps: readonly RuleStep[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    if ("invoke" in step) ids.push(step.invoke.ruleId);
    else if ("gate" in step)
      ids.push(...invokedRuleIds(step.gate.pass ?? []), ...invokedRuleIds(step.gate.fail ?? []));
    else if ("foreach" in step) ids.push(...invokedRuleIds(step.foreach.steps));
    else if ("repeat" in step) ids.push(...invokedRuleIds(step.repeat.steps));
    else if ("parallel" in step)
      for (const branch of step.parallel.branches) ids.push(...invokedRuleIds(branch.steps));
    else if ("wait" in step)
      ids.push(
        ...invokedRuleIds(step.wait.onSignal ?? []),
        ...invokedRuleIds(step.wait.onTimeout ?? []),
      );
  }
  return ids;
}

function unsupportedRule(
  rule: RuleDefinition,
  diagnostics: readonly RuleCompatibilityDiagnostic[],
): FrameworkError {
  return new FrameworkError({
    code: ERROR_CODES.persistenceUnsupported,
    message: `Rule ${rule.key} requires contracts this runtime does not support.`,
    details: {
      ruleId: rule.id,
      diagnostics: diagnostics.map((diagnostic) => ({
        kind: diagnostic.kind,
        key: diagnostic.key,
        support: diagnostic.support,
        message: diagnostic.message,
      })),
    },
  });
}
