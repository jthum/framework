import {
  ERROR_CODES,
  FrameworkError,
  invalidInput,
  resourceConflict,
  resourceNotFound,
  asFrameworkError,
} from "../errors/error.ts";
import type { ExecutionStore, RuleExecution } from "../persistence/executions.ts";
import { setOwnValue } from "../spec/json.ts";
import { durationMilliseconds } from "../spec/duration.ts";
import type {
  FieldDefinition,
  JsonValue,
  RuleActionCall,
  RuleDefinition,
  RuleStep,
} from "../spec/model.ts";
import {
  checkRuleCompatibility,
  requiresDurableExecution,
  type RuleRuntimeProfile,
} from "./rule-compatibility.ts";
import type { Clock, IdGenerator } from "./defaults.ts";
import type { ExecutionContext, ScopeHandle } from "./model.ts";
import type { RunRuleInput, RuleStepTrace } from "./rules.ts";
import { ruleOutputMismatch } from "../spec/rule-output.ts";

export interface ActorRequest {
  readonly id: string;
  readonly executionId: string;
  readonly actorId: string;
  readonly label: string;
  readonly description?: string;
  readonly fields: readonly FieldDefinition[];
  status: "pending" | "responded" | "expired" | "cancelled";
  readonly createdAt: string;
  respondedAt?: string;
  values?: Record<string, JsonValue>;
}

export interface ResumeRuleInput {
  readonly waitId?: string;
  readonly signal?: string;
  readonly payload?: Readonly<Record<string, JsonValue>>;
}

/** Stable UI projection; continuation frames and variable scopes remain Kernel-owned. */
export interface RuleExecutionDetails {
  readonly id: string;
  readonly actorId: string;
  /** Original module placement. Informational, never an authorization grant. */
  readonly scope?: ScopeHandle;
  readonly rule: { readonly id: string; readonly key: string; readonly label: string };
  readonly status: RuleExecution["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly trace: readonly (RuleStepTrace & { readonly label?: string })[];
  /** Root Rule variables at this checkpoint. No internal continuation scopes. */
  readonly vars?: Readonly<Record<string, JsonValue>>;
  readonly result?: JsonValue;
  readonly failure?: string;
  readonly waiting?: {
    readonly id: string;
    readonly stepId: string;
    readonly kind: "delay" | "signal" | "request" | "timeout";
    readonly dueAt?: string;
    readonly signal?: string;
    readonly requestId?: string;
  };
  /** Every pending branch wait, including concurrent ActorRequests. */
  readonly waits?: readonly NonNullable<RuleExecutionDetails["waiting"]>[];
  readonly branches?: readonly {
    readonly stepId: string;
    readonly branchId: string;
    readonly status: ForkBranch["status"];
    readonly failure?: string;
  }[];
}

export type RuleExecutionSummary = Pick<
  RuleExecutionDetails,
  "id" | "actorId" | "scope" | "rule" | "status" | "createdAt" | "updatedAt"
>;

/** Trusted host projection notifications, not an Event outbox or an authorization shortcut. */
export interface RuleExecutionChange {
  readonly context: ExecutionContext;
  readonly execution: RuleExecutionDetails;
  readonly trigger: Readonly<Record<string, JsonValue>>;
}
export interface RuleExecutionObserver {
  /** Awaited after creation but before the first effect. Failure stops this run without replay. */
  created?(change: RuleExecutionChange): Promise<void>;
  /** Post-commit projection work. Failure must never change the committed execution outcome. */
  changed(change: RuleExecutionChange): Promise<void>;
  failed(error: unknown, change: RuleExecutionChange): void;
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
  activeBranch?: string;
  compensations: Array<{
    action: RuleActionCall;
    input: Readonly<Record<string, JsonValue>>;
    context: ExecutionContext;
    ruleId: string;
    stepId: string;
    branchId?: string;
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
      itemScope?: number;
      collected?: JsonValue[];
    }
  | {
      kind: "return";
      ruleId: string;
      nestedRuleId: string;
      stepId: string;
      from: number;
      to: number;
      as?: string;
    }
  | { kind: "join"; fork: number; ruleId: string; scope: number };

interface Pending {
  readonly id: string;
  readonly step: Extract<RuleStep, { wait: unknown } | { delay: unknown }>;
  readonly ruleId: string;
  readonly scope: number;
  readonly dueAt?: string;
  readonly requestId?: string;
}

interface Lane {
  frames: Frame[];
  pending?: Pending;
}

interface ForkBranch extends Lane {
  readonly id: string;
  readonly laneId: string;
  readonly key: string;
  readonly scope: number;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  failure?: string;
}

interface Fork {
  readonly step: Extract<RuleStep, { parallel: unknown } | { foreach: unknown }>;
  readonly parentScope: number;
  readonly branches: ForkBranch[];
}

interface Checkpoint {
  readonly rules: Record<string, RuleDefinition>;
  readonly scopes: Scope[];
  readonly frames: Frame[];
  readonly state: State;
  readonly requests: ActorRequest[];
  readonly forks: Fork[];
  pending?: Pending;
  failure?: string;
  result?: JsonValue;
}

interface ExecutionHooks {
  readonly maxSteps: number;
  readonly maxDepth: number;
  profile(): RuleRuntimeProfile;
  actionKeys(context: ExecutionContext): Promise<ReadonlySet<string>>;
  scope(context: ExecutionContext, rule: RuleDefinition, input: RunRuleInput): Promise<Scope>;
  leaf(
    context: ExecutionContext,
    rule: RuleDefinition,
    step: RuleStep,
    scope: Scope,
    state: State,
  ): Promise<void>;
  compound(
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
  value(input: import("../spec/model.ts").RuleValue, scope: Scope): JsonValue;
  actor(
    context: ExecutionContext,
    rule: RuleDefinition,
    stepId: string,
    binding: string | import("../spec/model.ts").RuleBinding | undefined,
    scope: Scope,
  ): Promise<ExecutionContext>;
  compensate(state: State): Promise<void>;
  compensateBranch(state: State, branchId: string): Promise<void>;
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
    private readonly resolveWorkspace: (
      context: ExecutionContext,
    ) => Promise<import("./model.ts").Workspace>,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hooks: ExecutionHooks,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (
      request: import("./authorization.ts").AuthorizationRequest,
    ) => Promise<void>,
    private readonly observer?: RuleExecutionObserver,
    private readonly maxCheckpointBytes = 8 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxCheckpointBytes) || maxCheckpointBytes < 1)
      throw invalidInput("Checkpoint byte budget must be a positive safe integer.");
  }

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
        parallel: enabled ? "supported" : "unsupported",
      },
      notes: {
        ...base.notes,
        parallel:
          "Durable branches can hold independent waits and join after all branches settle. Pending waits are resumed individually.",
      },
    };
  }

  /** Preflight a root Rule and every nested invocation before an Event causes side effects. */
  async assertCompatible(
    context: ExecutionContext,
    rule: RuleDefinition,
    rules: readonly RuleDefinition[],
  ): Promise<void> {
    await this.snapshotRules(context, rule, rules);
  }

  async start(
    context: ExecutionContext,
    key: string,
    input: RunRuleInput = {},
  ): Promise<RuleExecution> {
    await this.assertContext(context);
    const workspace = await this.resolveWorkspace(context);
    const rule = workspace.spec.rules.find((item) => item.key === key);
    if (!rule) throw resourceNotFound("Rule", key);
    await this.checkAuthority(context, "rules.run", "rule", rule.id);
    if (rule.enabled === false) throw resourceConflict("The Rule is disabled.");
    const rules = await this.snapshotRules(context, rule, workspace.spec.rules);
    const checkpoint: Checkpoint = {
      rules,
      scopes: [await this.hooks.scope(context, rule, input)],
      frames: [{ kind: "steps", ruleId: rule.id, steps: rule.steps, index: 0, scope: 0 }],
      state: { remaining: this.hooks.maxSteps, depth: 0, trace: [], compensations: [] },
      requests: [],
      forks: [],
    };
    const stamp = this.clock.now();
    const execution: RuleExecution = {
      id: this.ids.create("execution"),
      context: { ...context },
      rule: rules[rule.id]!,
      revision: 0,
      status: "running",
      checkpoint: encode(checkpoint, this.maxCheckpointBytes),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.store.create(execution);
    try {
      await this.observer?.created?.(this.change(execution));
    } catch (error) {
      checkpoint.failure =
        "The host could not prepare this execution. No Rule effects were started.";
      await this.save(execution, checkpoint, "failed");
      throw error;
    }
    return this.drive(execution, checkpoint);
  }

  private async snapshotRules(
    context: ExecutionContext,
    root: RuleDefinition,
    definitions: readonly RuleDefinition[],
  ): Promise<Record<string, RuleDefinition>> {
    const profile = this.profile();
    const availableActions = await this.hooks.actionKeys(context);
    const actions = new Set([...profile.actions, ...availableActions]);
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    const snapshot: Record<string, RuleDefinition> = {};
    const collect = (definition: RuleDefinition): void => {
      if (Object.hasOwn(snapshot, definition.id)) return;
      const compatibility = checkRuleCompatibility(definition, {
        ...profile,
        actions,
        events: new Set(definition.trigger ? [definition.trigger.event] : []),
      });
      if (!compatibility.compatible)
        throw unsupported("The Rule is not compatible with durable execution.");
      setOwnValue(snapshot, definition.id, structuredClone(definition));
      visitSteps(definition.steps, (step) => {
        if ("delay" in step) deadline(this.clock.now(), step.delay.duration);
        if ("wait" in step && step.wait.timeout !== undefined)
          deadline(this.clock.now(), step.wait.timeout);
        if (
          ("foreach" in step || "repeat" in step) &&
          ("foreach" in step ? step.foreach.onItemFailure : step.repeat.onItemFailure) ===
            "continue" &&
          requiresDurableExecution(
            { ...definition, steps: "foreach" in step ? step.foreach.steps : step.repeat.steps },
            definitions,
          )
        )
          throw unsupported("A wait cannot occur inside a loop that continues after item failure.");
        if ("invoke" in step) {
          const nested = byId.get(step.invoke.ruleId);
          if (!nested) throw resourceNotFound("Rule", step.invoke.ruleId);
          collect(nested);
        }
      });
    };
    collect(root);
    return snapshot;
  }

  async get(context: ExecutionContext, id: string): Promise<RuleExecution | null> {
    await this.assertContext(context);
    await this.checkAuthority(context, "executions.read", "execution", id);
    const execution = await this.store.get(context.workspaceId, id);
    if (execution && execution.context.actorId !== context.actorId)
      await this.checkAuthority(context, "executions.inspect", "execution", id);
    return execution;
  }

  async details(context: ExecutionContext, id: string): Promise<RuleExecutionDetails | null> {
    const execution = await this.get(context, id);
    return execution ? describe(execution) : null;
  }

  async detailsMany(
    context: ExecutionContext,
    ids: readonly string[],
  ): Promise<readonly RuleExecutionDetails[]> {
    await this.assertContext(context);
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((id) => typeof id !== "string" || !id))
      throw invalidInput("Choose up to 100 executions.");
    const rows = await this.store.getMany(context.workspaceId, [...new Set(ids)]);
    const result: RuleExecutionDetails[] = [];
    for (const execution of rows) {
      try {
        await this.checkAuthority(context, "executions.read", "execution", execution.id);
        if (execution.context.actorId !== context.actorId)
          await this.checkAuthority(context, "executions.inspect", "execution", execution.id);
      } catch (error) {
        if (error instanceof FrameworkError && error.code === ERROR_CODES.permissionDenied)
          continue;
        throw error;
      }
      result.push(describe(execution));
    }
    return result;
  }

  async list(
    context: ExecutionContext,
    limit = 20,
    offset = 0,
  ): Promise<readonly RuleExecutionSummary[]> {
    await this.assertContext(context);
    await this.checkAuthority(context, "executions.list", "execution", context.workspaceId);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw resourceConflict(
        "Execution pagination requires a limit of 1–100 and a non-negative offset.",
      );
    return (await this.store.list(context.workspaceId, context.actorId, limit, offset)).map(
      (execution) => ({
        id: execution.id,
        actorId: execution.context.actorId,
        ...(execution.context.scope ? { scope: structuredClone(execution.context.scope) } : {}),
        rule: { id: execution.rule.id, key: execution.rule.key, label: execution.rule.label },
        status: execution.status,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      }),
    );
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
  async listPendingRequests(
    context: ExecutionContext,
    limit = 30,
    offset = 0,
  ): Promise<readonly ActorRequest[]> {
    await this.assertContext(context);
    await this.checkAuthority(context, "actor_requests.list", "workspace", context.workspaceId);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw invalidInput(
        "ActorRequest pagination requires a limit of 1–100 and a non-negative offset.",
      );
    return this.store.listPendingRequests(context.workspaceId, context.actorId, limit, offset);
  }

  /** Assigned requests in one execution; no execution ownership is implied. */
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
    const all = pendingLanes(checkpoint);
    const matches =
      all.length === 1 && !input.waitId
        ? all
        : all.filter(({ pending }) =>
            input.waitId
              ? pending.id === input.waitId
              : input.signal
                ? "wait" in pending.step && pending.step.wait.signal === input.signal
                : true,
          );
    if (matches.length !== 1) throw resourceConflict("Specify exactly one pending wait to resume.");
    const { lane, pending } = matches[0]!;
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
    this.finishWait(checkpoint, lane, due, input.payload ?? {});
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
    const entry = pendingLanes(checkpoint).find(({ pending }) => pending.requestId === requestId);
    const pending = entry?.pending;
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
    this.finishWait(checkpoint, entry!.lane, false, prepared);
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
    for (const request of checkpoint.requests)
      if (request.status === "pending") request.status = "cancelled";
    for (const fork of checkpoint.forks)
      for (const branch of fork.branches)
        if (
          branch.status === "queued" ||
          branch.status === "waiting" ||
          branch.status === "running"
        )
          branch.status = "cancelled";
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
    lane: Lane,
    timeout: boolean,
    payload: Readonly<Record<string, JsonValue>>,
  ): void {
    const pending = lane.pending!;
    const scope = checkpoint.scopes[pending.scope]!;
    if ("wait" in pending.step) {
      const wait = pending.step.wait;
      if (wait.as) setOwnValue(scope.vars, wait.as, { ...payload });
      const steps = timeout ? (wait.onTimeout ?? []) : (wait.onSignal ?? []);
      lane.frames.push({
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
    delete lane.pending;
  }

  private async drive(initial: RuleExecution, checkpoint: Checkpoint): Promise<RuleExecution> {
    const run = { execution: initial, saving: false };
    delete checkpoint.state.activeBranch;
    try {
      const status = await this.driveLane(checkpoint, checkpoint, run);
      if (status === "waiting") {
        // Publish pending waits only when the entire driver is quiescent, including parallel lanes.
        // A failed/uncertain checkpoint acknowledgement must never trigger compensation or replay.
        run.saving = true;
        return await this.save(run.execution, checkpoint, "waiting");
      }
      const root = checkpoint.rules[run.execution.rule.id]!;
      if (root.result !== undefined)
        checkpoint.result = this.hooks.value(root.result, checkpoint.scopes[0]!);
      const mismatch = root.output && ruleOutputMismatch(root.output, checkpoint.result);
      if (mismatch)
        throw new FrameworkError({
          code: ERROR_CODES.validationInvalidInput,
          message: `Rule ${root.key} returned an invalid result: ${mismatch}`,
        });
      run.saving = true;
      return await this.save(run.execution, checkpoint, "completed");
    } catch (error) {
      if (run.saving) throw error;
      const fault = asFrameworkError(error);
      checkpoint.failure = `[${fault.code}] ${fault.message}${fault.errorId ? ` (${fault.errorId})` : ""}`;
      for (const request of checkpoint.requests)
        if (request.status === "pending") request.status = "cancelled";
      for (const fork of checkpoint.forks)
        for (const branch of fork.branches)
          if (
            branch.status === "queued" ||
            branch.status === "waiting" ||
            branch.status === "running"
          )
            branch.status = "cancelled";
      // A failed save or revoked claim cannot safely trigger further side effects.
      const latest = await this.store.get(run.execution.context.workspaceId, run.execution.id);
      if (latest?.revision !== run.execution.revision || latest.status !== "running") throw error;
      try {
        await this.hooks.compensate(checkpoint.state);
      } catch (compensationError) {
        const compensationFault = asFrameworkError(compensationError);
        checkpoint.failure += `; compensation failed: [${compensationFault.code}] ${compensationFault.message}`;
      }
      await this.save(run.execution, checkpoint, "failed");
      throw error;
    }
  }

  private async driveLane(
    checkpoint: Checkpoint,
    lane: Lane,
    run: { execution: RuleExecution; saving: boolean },
  ): Promise<"waiting" | "done"> {
    while (lane.frames.length) {
      if (lane.frames.length > this.hooks.maxDepth * 3)
        throw resourceConflict("Durable Rule nesting limit exceeded.");
      const frame = lane.frames.at(-1)!;
      const scope =
        "scope" in frame ? checkpoint.scopes[frame.scope]! : checkpoint.scopes[frame.to]!;
      const rule = checkpoint.rules[frame.ruleId]!;
      if (frame.kind === "return") {
        const nested = checkpoint.rules[frame.nestedRuleId]!;
        const nestedScope = checkpoint.scopes[frame.from]!;
        const nestedResult =
          nested.result === undefined ? undefined : this.hooks.value(nested.result, nestedScope);
        const mismatch = nested.output && ruleOutputMismatch(nested.output, nestedResult);
        if (mismatch)
          throw new FrameworkError({
            code: ERROR_CODES.validationInvalidInput,
            message: `Rule ${nested.key} returned an invalid result: ${mismatch}`,
          });
        if (frame.as) {
          setOwnValue(
            scope.vars,
            frame.as,
            nestedResult === undefined ? { ...nestedScope.vars } : nestedResult,
          );
        }
        checkpoint.state.trace.push({
          stepId: frame.stepId,
          kind: "invoke",
          status: "completed",
        });
        lane.frames.pop();
      } else if (frame.kind === "loop") {
        if (frame.itemScope !== undefined) {
          const itemScope = checkpoint.scopes[frame.itemScope]!;
          if ("foreach" in frame.step && frame.step.foreach.collect)
            frame.collected!.push(this.hooks.value(frame.step.foreach.collect.value, itemScope));
          if (
            "repeat" in frame.step &&
            frame.step.repeat.until &&
            (await this.hooks.test(frame.step.repeat.until, itemScope))
          )
            frame.index = frame.items.length;
          delete frame.itemScope;
        }
        if (frame.index >= frame.items.length) {
          if ("foreach" in frame.step && frame.step.foreach.collect)
            setOwnValue(scope.vars, frame.step.foreach.collect.as, frame.collected ?? []);
          checkpoint.state.trace.push({
            stepId: frame.step.id,
            kind: "foreach" in frame.step ? "foreach" : "repeat",
            status: "completed",
          });
          lane.frames.pop();
        } else {
          const config = "foreach" in frame.step ? frame.step.foreach : frame.step.repeat;
          const itemScope = "foreach" in frame.step ? structuredClone(scope) : scope;
          if (--checkpoint.state.remaining < 0)
            throw resourceConflict("Durable Rule step budget exceeded.");
          setOwnValue(
            itemScope.vars,
            config.as ?? ("foreach" in frame.step ? "item" : "index"),
            frame.items[frame.index++]!,
          );
          frame.itemScope =
            "foreach" in frame.step ? checkpoint.scopes.push(itemScope) - 1 : frame.scope;
          lane.frames.push({
            kind: "steps",
            ruleId: rule.id,
            steps: config.steps,
            index: 0,
            scope: frame.itemScope,
          });
        }
      } else if (frame.kind === "join") {
        const status = await this.driveFork(checkpoint, checkpoint.forks[frame.fork]!, run);
        if (status === "waiting") return "waiting";
        lane.frames.pop();
      } else if (frame.index >= frame.steps.length) lane.frames.pop();
      else {
        const step = frame.steps[frame.index++]!;
        if ("action" in step || "compute" in step) {
          checkpoint.state.depth = lane.frames.length;
          await this.hooks.leaf(run.execution.context, rule, step, scope, checkpoint.state);
        } else {
          if (--checkpoint.state.remaining < 0)
            throw resourceConflict("Durable Rule step limit exceeded.");
          if ("gate" in step) {
            const passed = await this.hooks.test(step.gate.predicate, scope);
            checkpoint.state.trace.push({ stepId: step.id, kind: "gate", status: "completed" });
            lane.frames.push({
              kind: "steps",
              ruleId: rule.id,
              steps: passed ? (step.gate.pass ?? []) : (step.gate.fail ?? []),
              index: 0,
              scope: frame.scope,
            });
          } else if (
            ("foreach" in step &&
              step.foreach.mode === "parallel" &&
              requiresDurableExecution(
                { ...rule, steps: step.foreach.steps },
                Object.values(checkpoint.rules),
              )) ||
            ("foreach" in step && step.foreach.onItemFailure === "continue") ||
            ("repeat" in step && step.repeat.onItemFailure === "continue")
          ) {
            if (
              "foreach" in step &&
              step.foreach.mode === "parallel" &&
              requiresDurableExecution(
                { ...rule, steps: step.foreach.steps },
                Object.values(checkpoint.rules),
              )
            )
              this.startFork(checkpoint, lane, rule, step, frame.scope);
            else
              await this.hooks.compound(run.execution.context, rule, step, scope, checkpoint.state);
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
            if (count < 0 || count > Math.min(config.max ?? 100, 1000, checkpoint.state.remaining))
              throw resourceConflict("Durable loop exceeds its bound or has an invalid source.");
            const items =
              "foreach" in step ? raw : Array.from({ length: count }, (_, index) => index);
            if (!Array.isArray(items)) throw resourceConflict("Foreach source must be an array.");
            lane.frames.push({
              kind: "loop",
              ruleId: rule.id,
              step,
              items: structuredClone(items),
              index: 0,
              scope: frame.scope,
              ...("foreach" in step && step.foreach.collect ? { collected: [] } : {}),
            });
          } else if ("invoke" in step) {
            const nested = checkpoint.rules[step.invoke.ruleId]!;
            await this.checkAuthority(run.execution.context, "rules.run", "rule", nested.id);
            if (nested.enabled === false) throw resourceConflict("Nested Rule is disabled.");
            const nestedScope = await this.hooks.scope(run.execution.context, nested, {
              input: this.hooks.values(step.invoke.input ?? {}, scope),
            });
            const from = checkpoint.scopes.push(nestedScope) - 1;
            lane.frames.push({
              kind: "return",
              ruleId: rule.id,
              nestedRuleId: nested.id,
              stepId: step.id,
              from,
              to: frame.scope,
              ...(step.invoke.as ? { as: step.invoke.as } : {}),
            });
            lane.frames.push({
              kind: "steps",
              ruleId: nested.id,
              steps: nested.steps,
              index: 0,
              scope: from,
            });
          } else if ("wait" in step || "delay" in step) {
            const duration = "delay" in step ? step.delay.duration : step.wait.timeout;
            const dueAt = duration === undefined ? undefined : deadline(this.clock.now(), duration);
            let requestId: string | undefined;
            if ("wait" in step && step.wait.request) {
              const definition = step.wait.request;
              const assigned = await this.hooks.actor(
                run.execution.context,
                rule,
                step.id,
                definition.actor,
                scope,
              );
              const actor = await this.catalog.getActor(assigned.actorId);
              if (actor?.kind !== "user") throw denied("ActorRequests must be assigned to a User.");
              requestId = this.ids.create("actor_request");
              const description =
                definition.description === undefined
                  ? undefined
                  : this.hooks.values({ description: definition.description }, scope).description;
              if (description !== undefined && typeof description !== "string")
                throw invalidInput("Request description must resolve to text.");
              checkpoint.requests.push({
                id: requestId,
                executionId: run.execution.id,
                actorId: actor.id,
                label: definition.label,
                ...(description === undefined ? {} : { description }),
                fields: structuredClone(definition.fields),
                status: "pending",
                createdAt: this.clock.now(),
              });
            }
            lane.pending = {
              id: this.ids.create("wait"),
              step,
              ruleId: rule.id,
              scope: frame.scope,
              ...(dueAt ? { dueAt } : {}),
              ...(requestId ? { requestId } : {}),
            };
            return "waiting";
          } else if ("parallel" in step) {
            if (
              requiresDurableExecution(
                { ...rule, steps: step.parallel.branches.flatMap((branch) => branch.steps) },
                Object.values(checkpoint.rules),
              )
            )
              this.startFork(checkpoint, lane, rule, step, frame.scope);
            else
              await this.hooks.compound(run.execution.context, rule, step, scope, checkpoint.state);
          } else throw unsupported("Unknown durable Rule step.");
        }
      }
      run.saving = true;
      run.execution = await this.save(run.execution, checkpoint, "running");
      run.saving = false;
    }
    return "done";
  }

  private async driveFork(
    checkpoint: Checkpoint,
    fork: Fork,
    run: { execution: RuleExecution; saving: boolean },
  ): Promise<"waiting" | "done"> {
    let waiting = false;
    const limit = "foreach" in fork.step ? (fork.step.foreach.concurrency ?? 4) : Infinity;
    let active = fork.branches.filter((branch) => branch.status === "waiting").length;
    for (const branch of fork.branches) {
      if (
        branch.status === "completed" ||
        branch.status === "failed" ||
        branch.status === "cancelled"
      )
        continue;
      if (branch.pending) {
        waiting = true;
        continue;
      }
      if (branch.status === "queued" && active >= limit) {
        waiting = true;
        continue;
      }
      if (branch.status === "waiting") active--;
      branch.status = "running";
      const previousBranch = checkpoint.state.activeBranch;
      checkpoint.state.activeBranch = branch.laneId;
      try {
        branch.status =
          (await this.driveLane(checkpoint, branch, run)) === "done" ? "completed" : "waiting";
      } catch (error) {
        if (run.saving) throw error;
        branch.status = "failed";
        const fault = asFrameworkError(error);
        branch.failure = `[${fault.code}] ${fault.message}`;
        if ("foreach" in fork.step || fork.step.parallel.join !== "any") throw error;
        await this.hooks.compensateBranch(checkpoint.state, branch.laneId);
      } finally {
        if (previousBranch === undefined) delete checkpoint.state.activeBranch;
        else checkpoint.state.activeBranch = previousBranch;
      }
      if (branch.status === "waiting") {
        active++;
        waiting = true;
      }
    }
    if (waiting) return "waiting";
    if (
      "parallel" in fork.step &&
      fork.step.parallel.join === "any" &&
      !fork.branches.some((branch) => branch.status === "completed")
    )
      throw resourceConflict("Every parallel branch failed.");
    const parent = checkpoint.scopes[fork.parentScope]!;
    if ("foreach" in fork.step) {
      const collection = fork.step.foreach.collect;
      if (collection)
        setOwnValue(
          parent.vars,
          collection.as,
          fork.branches.map((branch) =>
            this.hooks.value(collection.value, checkpoint.scopes[branch.scope]!),
          ),
        );
    } else {
      for (const branch of fork.branches)
        if (branch.status === "completed")
          setOwnValue(
            parent.vars,
            branch.key,
            structuredClone(checkpoint.scopes[branch.scope]!.vars),
          );
    }
    checkpoint.state.trace.push({
      stepId: fork.step.id,
      kind: "foreach" in fork.step ? "foreach" : "parallel",
      status: "completed",
    });
    return "done";
  }

  private startFork(
    checkpoint: Checkpoint,
    lane: Lane,
    rule: RuleDefinition,
    step: Fork["step"],
    parentScope: number,
  ): void {
    const scope = checkpoint.scopes[parentScope]!;
    const items = "foreach" in step ? this.hooks.read(step.foreach.source.$ref, scope) : undefined;
    if ("foreach" in step && !Array.isArray(items))
      throw resourceConflict("Parallel foreach source must be an array.");
    if (
      "foreach" in step &&
      (items as JsonValue[]).length >
        Math.min(step.foreach.max ?? 100, 1000, checkpoint.state.remaining)
    )
      throw resourceConflict("Parallel foreach exceeds its bound.");
    const branches: ForkBranch[] =
      "parallel" in step
        ? step.parallel.branches.map((branch) => {
            const index = checkpoint.scopes.push(structuredClone(scope)) - 1;
            return {
              id: branch.id,
              laneId: `${checkpoint.state.activeBranch ? `${checkpoint.state.activeBranch}/` : ""}${checkpoint.forks.length}:${branch.id}`,
              key: branch.key ?? branch.id,
              scope: index,
              status: "queued",
              frames: [
                { kind: "steps", ruleId: rule.id, steps: branch.steps, index: 0, scope: index },
              ],
            };
          })
        : (items as JsonValue[]).map((item, ordinal) => {
            const index = checkpoint.scopes.push(structuredClone(scope)) - 1;
            setOwnValue(checkpoint.scopes[index]!.vars, step.foreach.as ?? "item", item);
            return {
              id: `${step.id}:${ordinal}`,
              laneId: `${checkpoint.state.activeBranch ? `${checkpoint.state.activeBranch}/` : ""}${checkpoint.forks.length}:${step.id}:${ordinal}`,
              key: String(ordinal),
              scope: index,
              status: "queued",
              frames: [
                {
                  kind: "steps",
                  ruleId: rule.id,
                  steps: step.foreach.steps,
                  index: 0,
                  scope: index,
                },
              ],
            };
          });
    const fork = checkpoint.forks.push({ step, parentScope, branches }) - 1;
    lane.frames.push({ kind: "join", fork, ruleId: rule.id, scope: parentScope });
  }

  private async save(
    execution: RuleExecution,
    checkpoint: Checkpoint,
    status: RuleExecution["status"],
  ): Promise<RuleExecution> {
    const next: RuleExecution = {
      ...execution,
      revision: execution.revision + 1,
      checkpoint: encode(checkpoint, this.maxCheckpointBytes),
      status,
      updatedAt: this.clock.now(),
    };
    await this.store.update(next, execution.revision);
    if (this.observer) {
      const change = this.change(next);
      try {
        await this.observer.changed(change);
      } catch (error) {
        // Even a broken diagnostic callback cannot turn committed success into failure/replay.
        try {
          this.observer.failed(error, change);
        } catch {
          /* Observer-owned reporting only. */
        }
      }
    }
    return next;
  }

  private change(execution: RuleExecution): RuleExecutionChange {
    return {
      context: structuredClone(execution.context),
      execution: describe(execution),
      trigger: structuredClone(decode(execution).scopes[0]!.trigger),
    };
  }

  private checkAuthority(
    context: ExecutionContext,
    operation: string,
    kind: "rule" | "execution" | "actor_request" | "workspace",
    id: string,
  ): Promise<void> {
    return this.authorize({
      context,
      operation,
      resource: { kind, id, workspaceId: context.workspaceId },
    });
  }
}

function encode(checkpoint: Checkpoint, maxBytes: number): Readonly<Record<string, JsonValue>> {
  if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > maxBytes)
    throw new FrameworkError({
      code: ERROR_CODES.ruleCheckpointLimit,
      message: "The Workflow exceeded its checkpoint storage budget.",
      details: { maxBytes },
    });
  return structuredClone(checkpoint) as unknown as Readonly<Record<string, JsonValue>>;
}
function pendingLanes(checkpoint: Checkpoint): Array<{ lane: Lane; pending: Pending }> {
  const entries: Array<{ lane: Lane; pending: Pending }> = [];
  if (checkpoint.pending) entries.push({ lane: checkpoint, pending: checkpoint.pending });
  for (const fork of checkpoint.forks)
    for (const branch of fork.branches)
      if (branch.pending) entries.push({ lane: branch, pending: branch.pending });
  return entries;
}
function describe(execution: RuleExecution): RuleExecutionDetails {
  const checkpoint = decode(execution);
  const waits = pendingLanes(checkpoint).map(({ pending }) => ({
    id: pending.id,
    stepId: pending.step.id,
    kind: pending.requestId
      ? ("request" as const)
      : "delay" in pending.step
        ? ("delay" as const)
        : pending.step.wait.signal
          ? ("signal" as const)
          : ("timeout" as const),
    ...(pending.dueAt ? { dueAt: pending.dueAt } : {}),
    ...("wait" in pending.step && pending.step.wait.signal
      ? { signal: pending.step.wait.signal }
      : {}),
    ...(pending.requestId ? { requestId: pending.requestId } : {}),
  }));
  const labels = new Map<string, string>();
  for (const definition of Object.values(checkpoint.rules))
    visitSteps(definition.steps, (step) => {
      labels.set(
        step.id,
        "action" in step
          ? step.action.key.replaceAll(".", " › ")
          : "invoke" in step
            ? `Run ${checkpoint.rules[step.invoke.ruleId]?.label ?? "workflow"}`
            : "gate" in step
              ? "Check conditions"
              : "compute" in step
                ? `Set ${Object.keys(step.compute.assign).join(", ")}`
                : "wait" in step
                  ? (step.wait.request?.label ??
                    (step.wait.signal ? `Wait for ${step.wait.signal}` : "Wait until timeout"))
                  : "delay" in step
                    ? `Wait ${step.delay.duration}`
                    : "foreach" in step
                      ? "For each item"
                      : "repeat" in step
                        ? "Repeat steps"
                        : "Parallel branches",
      );
    });
  return {
    id: execution.id,
    actorId: execution.context.actorId,
    ...(execution.context.scope ? { scope: structuredClone(execution.context.scope) } : {}),
    rule: { id: execution.rule.id, key: execution.rule.key, label: execution.rule.label },
    status: execution.status,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    trace: checkpoint.state.trace.map((step) => ({
      ...step,
      ...(labels.has(step.stepId) ? { label: labels.get(step.stepId)! } : {}),
    })),
    vars: checkpoint.scopes[0]!.vars,
    ...(execution.status === "completed" && checkpoint.result !== undefined
      ? { result: checkpoint.result }
      : {}),
    ...(checkpoint.failure ? { failure: checkpoint.failure } : {}),
    ...(waits.length ? { waits } : {}),
    ...(waits.length === 1 ? { waiting: waits[0] } : {}),
    ...(checkpoint.forks.length
      ? {
          branches: checkpoint.forks.flatMap((fork) =>
            fork.branches.map((branch) => ({
              stepId: fork.step.id,
              branchId: branch.id,
              status: branch.status,
              ...(branch.failure ? { failure: branch.failure } : {}),
            })),
          ),
        }
      : {}),
  };
}
function decode(execution: RuleExecution): Checkpoint {
  return structuredClone(execution.checkpoint) as unknown as Checkpoint;
}
function deadline(now: string, duration: number | string): string {
  const milliseconds = durationMilliseconds(duration) ?? NaN;
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
