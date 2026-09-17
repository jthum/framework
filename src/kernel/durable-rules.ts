import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { ExecutionStore, RuleExecution } from "../persistence/executions.ts";
import type {
  FieldDefinition,
  JsonValue,
  RuleActionCall,
  RuleDefinition,
  RuleStep,
} from "../spec/model.ts";
import { checkRuleCompatibility, type RuleRuntimeProfile } from "./rule-compatibility.ts";
import type { Clock, IdGenerator } from "./defaults.ts";
import type { ExecutionContext } from "./model.ts";
import type { RunRuleInput, RuleStepTrace } from "./rules.ts";

export interface ActorRequest {
  readonly id: string;
  readonly executionId: string;
  readonly actorId: string;
  readonly label: string;
  readonly fields: readonly FieldDefinition[];
  status: "pending" | "responded" | "expired";
  readonly createdAt: string;
  respondedAt?: string;
  values?: Record<string, JsonValue>;
}

export interface ResumeRuleInput {
  readonly signal?: string;
  readonly payload?: Readonly<Record<string, JsonValue>>;
}

interface Scope {
  trigger: Record<string, JsonValue>;
  actor: Record<string, JsonValue>;
  vars: Record<string, JsonValue>;
  meta: Record<string, JsonValue>;
}

interface State {
  remaining: number;
  depth: number;
  trace: RuleStepTrace[];
  compensations: Array<{
    action: RuleActionCall;
    input: Readonly<Record<string, JsonValue>>;
    context: ExecutionContext;
    ruleId: string;
    stepId: string;
  }>;
}

type LoopStep = Extract<RuleStep, { foreach: unknown } | { repeat: unknown }>;
type Frame =
  | { kind: "steps"; ruleId: string; steps: readonly RuleStep[]; index: number; scope: number }
  | {
      kind: "loop";
      ruleId: string;
      step: LoopStep;
      index: number;
      items: readonly JsonValue[];
      scope: number;
    }
  | { kind: "return"; ruleId: string; stepId: string; from: number; to: number; as?: string };

interface Pending {
  readonly step: Extract<RuleStep, { wait: unknown } | { delay: unknown }>;
  readonly ruleId: string;
  readonly scope: number;
  readonly dueAt?: string;
  readonly requestId?: string;
}

interface Checkpoint {
  readonly rules: Record<string, RuleDefinition>;
  readonly scopes: Scope[];
  readonly frames: Frame[];
  readonly state: State;
  readonly requests: ActorRequest[];
  pending?: Pending;
  failure?: string;
}

interface ExecutionHooks {
  readonly maxSteps: number;
  readonly maxDepth: number;
  profile(): RuleRuntimeProfile;
  scope(context: ExecutionContext, rule: RuleDefinition, input: RunRuleInput): Promise<Scope>;
  leaf(
    context: ExecutionContext,
    rule: RuleDefinition,
    step: RuleStep,
    scope: Scope,
    state: State,
  ): Promise<void>;
  test(
    predicate: Extract<RuleStep, { gate: unknown }>["gate"]["predicate"],
    scope: Scope,
  ): Promise<boolean>;
  read(path: string, scope: Scope): JsonValue | undefined;
  values(
    input: Readonly<Record<string, import("../spec/model.ts").RuleValue>>,
    scope: Scope,
  ): Record<string, JsonValue>;
  actor(
    context: ExecutionContext,
    rule: RuleDefinition,
    stepId: string,
    binding: string | undefined,
    scope: Scope,
  ): Promise<ExecutionContext>;
  compensate(state: State): Promise<void>;
  validateResponse(
    context: ExecutionContext,
    fields: readonly FieldDefinition[],
    values: Readonly<Record<string, JsonValue>>,
  ): Promise<Record<string, JsonValue>>;
}

/** Cooperative durable execution. A waiting->running CAS claims work before any resumed effect. */
export class DurableRuleService {
  constructor(
    private readonly store: ExecutionStore,
    private readonly catalog: import("../persistence/catalog.ts").CatalogRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hooks: ExecutionHooks,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (
      request: import("./authorization.ts").AuthorizationRequest,
    ) => Promise<void>,
  ) {}

  profile(enabled = true): RuleRuntimeProfile {
    const base = this.hooks.profile();
    return {
      ...base,
      key: "kernel.durable",
      label: "Kernel durable runner",
      capabilities: {
        ...base.capabilities,
        durable_waits: enabled ? "supported" : "unsupported",
        signals: enabled ? "supported" : "unsupported",
        actor_requests: enabled ? "supported" : "unsupported",
        parallel: "unsupported",
      },
      notes: {
        ...base.notes,
        parallel:
          "Durable parallel joins are not implemented; the short runner supports deterministic branches.",
      },
    };
  }

  async start(
    context: ExecutionContext,
    key: string,
    input: RunRuleInput = {},
  ): Promise<RuleExecution> {
    await this.assertContext(context);
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    const rule = workspace?.spec.rules.find((item) => item.key === key);
    if (!rule) throw resourceNotFound("Rule", key);
    await this.checkAuthority(context, "rules.run", "rule", rule.id);
    if (rule.enabled === false) throw resourceConflict("The Rule is disabled.");
    const rules: Record<string, RuleDefinition> = {};
    const collect = (definition: RuleDefinition): void => {
      if (rules[definition.id]) return;
      const profile = this.profile();
      const compatibility = checkRuleCompatibility(definition, {
        ...profile,
        events: new Set(definition.trigger ? [definition.trigger.event] : []),
      });
      if (!compatibility.compatible)
        throw unsupported("The Rule is not compatible with durable execution.");
      rules[definition.id] = structuredClone(definition);
      visitSteps(definition.steps, (step) => {
        if ("delay" in step) deadline(this.clock.now(), step.delay.duration);
        if ("wait" in step && step.wait.timeout !== undefined)
          deadline(this.clock.now(), step.wait.timeout);
        if (
          ("foreach" in step && step.foreach.onItemFailure === "continue") ||
          ("repeat" in step && step.repeat.onItemFailure === "continue")
        )
          throw unsupported("Durable per-item failure continuation is not implemented.");
        if ("invoke" in step) {
          const nested = workspace!.spec.rules.find((item) => item.id === step.invoke.ruleId);
          if (!nested) throw resourceNotFound("Rule", step.invoke.ruleId);
          collect(nested);
        }
      });
    };
    collect(rule);
    const checkpoint: Checkpoint = {
      rules,
      scopes: [await this.hooks.scope(context, rule, input)],
      frames: [{ kind: "steps", ruleId: rule.id, steps: rule.steps, index: 0, scope: 0 }],
      state: { remaining: this.hooks.maxSteps, depth: 0, trace: [], compensations: [] },
      requests: [],
    };
    const stamp = this.clock.now();
    const execution: RuleExecution = {
      id: this.ids.create("execution"),
      context: { ...context },
      rule: rules[rule.id]!,
      revision: 0,
      status: "running",
      checkpoint: encode(checkpoint),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.store.create(execution);
    return this.drive(execution, checkpoint);
  }

  async get(context: ExecutionContext, id: string): Promise<RuleExecution | null> {
    await this.assertContext(context);
    await this.checkAuthority(context, "executions.read", "execution", id);
    const execution = await this.store.get(context.workspaceId, id);
    if (execution && execution.context.actorId !== context.actorId)
      await this.checkAuthority(context, "executions.inspect", "execution", id);
    return execution;
  }

  async getRequest(
    context: ExecutionContext,
    executionId: string,
    requestId: string,
  ): Promise<ActorRequest | null> {
    await this.assertContext(context);
    await this.checkAuthority(context, "actor_requests.read", "actor_request", requestId);
    const execution = await this.store.get(context.workspaceId, executionId);
    if (!execution) return null;
    const request = decode(execution).requests.find((item) => item.id === requestId);
    if (request && request.actorId !== context.actorId)
      await this.checkAuthority(context, "actor_requests.inspect", "actor_request", requestId);
    return request ? structuredClone(request) : null;
  }

  /** Assigned requests only; never expose another Actor's execution checkpoint. */
  async listRequests(
    context: ExecutionContext,
    executionId: string,
  ): Promise<readonly ActorRequest[]> {
    await this.assertContext(context);
    await this.checkAuthority(context, "actor_requests.list", "execution", executionId);
    const execution = await this.store.get(context.workspaceId, executionId);
    return execution
      ? decode(execution).requests.filter((request) => request.actorId === context.actorId)
      : [];
  }

  async resume(
    context: ExecutionContext,
    id: string,
    input: ResumeRuleInput = {},
  ): Promise<RuleExecution> {
    const execution = await this.requireWaiting(context, id);
    const checkpoint = decode(execution);
    const pending = checkpoint.pending!;
    const due =
      pending.dueAt !== undefined && Date.parse(this.clock.now()) >= Date.parse(pending.dueAt);
    if (!due) {
      if (pending.requestId)
        throw resourceConflict("Respond to the ActorRequest to resume this execution.");
      if (
        !("wait" in pending.step) ||
        !pending.step.wait.signal ||
        input.signal !== pending.step.wait.signal
      )
        throw resourceConflict("The wait is not due and its signal does not match.");
    }
    this.finishWait(checkpoint, due, input.payload ?? {});
    return this.claimAndDrive(execution, checkpoint);
  }

  async respond(
    context: ExecutionContext,
    executionId: string,
    requestId: string,
    values: Readonly<Record<string, JsonValue>>,
  ): Promise<ActorRequest> {
    await this.assertContext(context);
    await this.checkAuthority(context, "actor_requests.respond", "actor_request", requestId);
    const execution = await this.store.get(context.workspaceId, executionId);
    if (!execution || execution.status !== "waiting")
      throw resourceConflict("The execution is not waiting.");
    const checkpoint = decode(execution);
    const pending = checkpoint.pending;
    const request = checkpoint.requests.find((item) => item.id === requestId);
    if (!request || pending?.requestId !== requestId || request.status !== "pending")
      throw resourceConflict("The ActorRequest is no longer pending.");
    const actor = await this.catalog.getActor(context.actorId);
    if (actor?.kind !== "user" || request.actorId !== context.actorId)
      throw denied("Only the assigned User can satisfy this ActorRequest.");
    if (pending.dueAt && Date.parse(this.clock.now()) >= Date.parse(pending.dueAt))
      throw resourceConflict("The ActorRequest has expired.");
    const prepared = await this.hooks.validateResponse(context, request.fields, values);
    await this.assertContext(execution.context);
    await this.checkAuthority(execution.context, "rules.run", "rule", execution.rule.id);
    if (pending.dueAt && Date.parse(this.clock.now()) >= Date.parse(pending.dueAt))
      throw resourceConflict("The ActorRequest has expired.");
    request.status = "responded";
    request.respondedAt = this.clock.now();
    request.values = prepared;
    this.finishWait(checkpoint, false, prepared);
    await this.claimAndDrive(execution, checkpoint);
    return structuredClone(request);
  }

  /** Explicitly terminate an interrupted run; never automatically replay an uncertain Action. */
  async fail(context: ExecutionContext, id: string): Promise<RuleExecution> {
    await this.assertContext(context);
    await this.checkAuthority(context, "executions.fail", "execution", id);
    const execution = await this.store.get(context.workspaceId, id);
    if (!execution || execution.status !== "running")
      throw resourceConflict("The execution is not running.");
    const checkpoint = decode(execution);
    checkpoint.failure =
      "Interrupted execution terminated explicitly; Action outcome may be uncertain.";
    return this.save(execution, checkpoint, "failed");
  }

  private async requireWaiting(context: ExecutionContext, id: string): Promise<RuleExecution> {
    await this.assertContext(context);
    await this.checkAuthority(context, "rules.resume", "execution", id);
    const execution = await this.store.get(context.workspaceId, id);
    if (!execution) throw resourceNotFound("RuleExecution", id);
    if (execution.status !== "waiting") throw resourceConflict("The execution is not waiting.");
    if (execution.context.actorId !== context.actorId)
      await this.checkAuthority(context, "executions.resumeOther", "execution", id);
    await this.assertContext(execution.context);
    await this.checkAuthority(execution.context, "rules.run", "rule", execution.rule.id);
    return execution;
  }

  private async claimAndDrive(
    execution: RuleExecution,
    checkpoint: Checkpoint,
  ): Promise<RuleExecution> {
    const claimed = await this.save(execution, checkpoint, "running");
    return this.drive(claimed, checkpoint);
  }

  private finishWait(
    checkpoint: Checkpoint,
    timeout: boolean,
    payload: Readonly<Record<string, JsonValue>>,
  ): void {
    const pending = checkpoint.pending!;
    const scope = checkpoint.scopes[pending.scope]!;
    if ("wait" in pending.step) {
      const wait = pending.step.wait;
      if (wait.as) scope.vars[wait.as] = { ...payload };
      const steps = timeout ? (wait.onTimeout ?? []) : (wait.onSignal ?? []);
      checkpoint.frames.push({
        kind: "steps",
        ruleId: pending.ruleId,
        steps,
        index: 0,
        scope: pending.scope,
      });
    }
    if (timeout && pending.requestId) {
      const request = checkpoint.requests.find((item) => item.id === pending.requestId)!;
      request.status = "expired";
    }
    checkpoint.state.trace.push({
      stepId: pending.step.id,
      kind: "wait" in pending.step ? "wait" : "delay",
      status: "completed",
    });
    delete checkpoint.pending;
  }

  private async drive(initial: RuleExecution, checkpoint: Checkpoint): Promise<RuleExecution> {
    let execution = initial;
    let saving = false;
    try {
      while (checkpoint.frames.length) {
        if (checkpoint.frames.length > this.hooks.maxDepth * 3)
          throw resourceConflict("Durable Rule nesting limit exceeded.");
        const frame = checkpoint.frames.at(-1)!;
        const scope =
          "scope" in frame ? checkpoint.scopes[frame.scope]! : checkpoint.scopes[frame.to]!;
        const rule = checkpoint.rules[frame.ruleId]!;
        if (frame.kind === "return") {
          if (frame.as) scope.vars[frame.as] = { ...checkpoint.scopes[frame.from]!.vars };
          checkpoint.state.trace.push({
            stepId: frame.stepId,
            kind: "invoke",
            status: "completed",
          });
          checkpoint.frames.pop();
        } else if (frame.kind === "loop") {
          if (frame.index >= frame.items.length) {
            checkpoint.state.trace.push({
              stepId: frame.step.id,
              kind: "foreach" in frame.step ? "foreach" : "repeat",
              status: "completed",
            });
            checkpoint.frames.pop();
          } else {
            const config = "foreach" in frame.step ? frame.step.foreach : frame.step.repeat;
            scope.vars[config.as ?? ("foreach" in frame.step ? "item" : "index")] =
              frame.items[frame.index++]!;
            checkpoint.frames.push({
              kind: "steps",
              ruleId: rule.id,
              steps: config.steps,
              index: 0,
              scope: frame.scope,
            });
          }
        } else if (frame.index >= frame.steps.length) checkpoint.frames.pop();
        else {
          const step = frame.steps[frame.index++]!;
          if ("action" in step || "compute" in step) {
            checkpoint.state.depth = checkpoint.frames.length;
            await this.hooks.leaf(execution.context, rule, step, scope, checkpoint.state);
          } else {
            if (--checkpoint.state.remaining < 0)
              throw resourceConflict("Durable Rule step limit exceeded.");
            if ("gate" in step) {
              const passed = await this.hooks.test(step.gate.predicate, scope);
              checkpoint.state.trace.push({ stepId: step.id, kind: "gate", status: "completed" });
              checkpoint.frames.push({
                kind: "steps",
                ruleId: rule.id,
                steps: passed ? (step.gate.pass ?? []) : (step.gate.fail ?? []),
                index: 0,
                scope: frame.scope,
              });
            } else if ("foreach" in step || "repeat" in step) {
              const config = "foreach" in step ? step.foreach : step.repeat;
              const raw =
                "foreach" in step
                  ? this.hooks.read(step.foreach.source.$ref, scope)
                  : typeof step.repeat.times === "number"
                    ? step.repeat.times
                    : this.hooks.read(step.repeat.times.$ref, scope);
              if (
                !("foreach" in step) &&
                (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0)
              )
                throw resourceConflict("Repeat count must be a non-negative integer.");
              const count = Array.isArray(raw) ? raw.length : typeof raw === "number" ? raw : -1;
              if (count < 0 || count > (config.max ?? 100))
                throw resourceConflict("Durable loop exceeds its bound or has an invalid source.");
              const items =
                "foreach" in step ? raw : Array.from({ length: count }, (_, index) => index);
              if (!Array.isArray(items)) throw resourceConflict("Foreach source must be an array.");
              checkpoint.frames.push({
                kind: "loop",
                ruleId: rule.id,
                step,
                items: structuredClone(items),
                index: 0,
                scope: frame.scope,
              });
            } else if ("invoke" in step) {
              const nested = checkpoint.rules[step.invoke.ruleId]!;
              await this.checkAuthority(execution.context, "rules.run", "rule", nested.id);
              if (nested.enabled === false) throw resourceConflict("Nested Rule is disabled.");
              const nestedScope = await this.hooks.scope(execution.context, nested, {
                input: this.hooks.values(step.invoke.input ?? {}, scope),
              });
              const from = checkpoint.scopes.push(nestedScope) - 1;
              checkpoint.frames.push({
                kind: "return",
                ruleId: rule.id,
                stepId: step.id,
                from,
                to: frame.scope,
                ...(step.invoke.as ? { as: step.invoke.as } : {}),
              });
              checkpoint.frames.push({
                kind: "steps",
                ruleId: nested.id,
                steps: nested.steps,
                index: 0,
                scope: from,
              });
            } else if ("wait" in step || "delay" in step) {
              const duration = "delay" in step ? step.delay.duration : step.wait.timeout;
              const dueAt =
                duration === undefined ? undefined : deadline(this.clock.now(), duration);
              let requestId: string | undefined;
              if ("wait" in step && step.wait.request) {
                const definition = step.wait.request;
                const assigned = await this.hooks.actor(
                  execution.context,
                  rule,
                  step.id,
                  definition.actor,
                  scope,
                );
                const actor = await this.catalog.getActor(assigned.actorId);
                if (actor?.kind !== "user")
                  throw denied("ActorRequests must be assigned to a User.");
                requestId = this.ids.create("actor_request");
                checkpoint.requests.push({
                  id: requestId,
                  executionId: execution.id,
                  actorId: actor.id,
                  label: definition.label,
                  fields: structuredClone(definition.fields),
                  status: "pending",
                  createdAt: this.clock.now(),
                });
              }
              checkpoint.pending = {
                step,
                ruleId: rule.id,
                scope: frame.scope,
                ...(dueAt ? { dueAt } : {}),
                ...(requestId ? { requestId } : {}),
              };
              return this.save(execution, checkpoint, "waiting");
            } else throw unsupported("Durable parallel joins are not implemented.");
          }
        }
        saving = true;
        execution = await this.save(execution, checkpoint, "running");
        saving = false;
      }
      return this.save(execution, checkpoint, "completed");
    } catch (error) {
      if (saving) throw error;
      checkpoint.failure = error instanceof Error ? error.message : String(error);
      // A failed save or revoked claim cannot safely trigger further side effects.
      const latest = await this.store.get(execution.context.workspaceId, execution.id);
      if (latest?.revision !== execution.revision || latest.status !== "running") throw error;
      try {
        await this.hooks.compensate(checkpoint.state);
      } catch (compensationError) {
        checkpoint.failure += `; compensation failed: ${String(compensationError)}`;
      }
      await this.save(execution, checkpoint, "failed");
      throw error;
    }
  }

  private async save(
    execution: RuleExecution,
    checkpoint: Checkpoint,
    status: RuleExecution["status"],
  ): Promise<RuleExecution> {
    const next: RuleExecution = {
      ...execution,
      revision: execution.revision + 1,
      checkpoint: encode(checkpoint),
      status,
      updatedAt: this.clock.now(),
    };
    await this.store.update(next, execution.revision);
    return next;
  }

  private checkAuthority(
    context: ExecutionContext,
    operation: string,
    kind: "rule" | "execution" | "actor_request",
    id: string,
  ): Promise<void> {
    return this.authorize({
      context,
      operation,
      resource: { kind, id, workspaceId: context.workspaceId },
    });
  }
}

function encode(checkpoint: Checkpoint): Readonly<Record<string, JsonValue>> {
  return structuredClone(checkpoint) as unknown as Readonly<Record<string, JsonValue>>;
}
function decode(execution: RuleExecution): Checkpoint {
  return structuredClone(execution.checkpoint) as unknown as Checkpoint;
}
function deadline(now: string, duration: number | string): string {
  const match =
    typeof duration === "string" ? /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(duration.trim()) : null;
  const milliseconds =
    typeof duration === "number"
      ? duration * 1000
      : match
        ? Number(match[1]) *
          { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[
            match[2] as "ms" | "s" | "m" | "h" | "d"
          ]
        : NaN;
  const timestamp = Date.parse(now) + milliseconds;
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < 0 ||
    !Number.isFinite(timestamp) ||
    Math.abs(timestamp) > 8.64e15
  )
    throw resourceConflict("Unsupported or out-of-range wait duration.");
  return new Date(timestamp).toISOString();
}
function visitSteps(steps: readonly RuleStep[], visit: (step: RuleStep) => void): void {
  for (const step of steps) {
    visit(step);
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
    for (const nested of children) visitSteps(nested, visit);
  }
}
function unsupported(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.persistenceUnsupported, message });
}
function denied(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.permissionDenied, message });
}
