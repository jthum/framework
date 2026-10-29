import { resourceConflict } from "../errors/error.ts";
import type { ExecutionContext, ScopeHandle } from "../kernel/model.ts";
import type { JsonValue, RuleDefinition } from "../spec/model.ts";
import type { ActorRequest } from "../kernel/durable-rules.ts";
import { canonicalJson } from "../spec/json.ts";

/** Instance state, not portable Spec. The Rule snapshot fixes the meaning of a resumed run. */
export interface RuleExecution {
  readonly id: string;
  readonly context: ExecutionContext;
  /** Immutable definition snapshot captured when this execution starts. */
  readonly rule: RuleDefinition;
  readonly revision: number;
  readonly status: "running" | "waiting" | "completed" | "failed";
  /** Kernel-owned serializable continuation, including frames, scope and execution budget. */
  readonly checkpoint: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Bounded history projection. Fetch an execution explicitly for its snapshot and checkpoint. */
export interface RuleExecutionSummary {
  readonly id: string;
  readonly actorId: string;
  /** Original module placement. Informational, never an authorization grant. */
  readonly scope?: ScopeHandle;
  readonly rule: Pick<RuleDefinition, "id" | "key" | "label">;
  readonly status: RuleExecution["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Trusted persistence port. Actor-facing authorization belongs to the Kernel. */
export interface ExecutionStore {
  /** Bounded assigned attention, including requests in another Actor's execution. */
  listPendingRequests(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly ActorRequest[]>;
  hasActiveScope(workspaceId: string, scope: ScopeHandle): Promise<boolean>;
  create(execution: RuleExecution): Promise<void>;
  get(workspaceId: string, id: string): Promise<RuleExecution | null>;
  getMany(workspaceId: string, ids: readonly string[]): Promise<readonly RuleExecution[]>;
  /** History only: never include full definitions, inputs or continuation state. */
  list(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly RuleExecutionSummary[]>;
  /** Atomically replace revision N with N+1; stale resumes must fail. */
  update(execution: RuleExecution, expectedRevision: number): Promise<void>;
}

export function assertExecutionRevision(execution: RuleExecution, expected: number): void {
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    !Number.isSafeInteger(execution.revision) ||
    execution.revision !== expected + 1
  )
    throw resourceConflict("An execution update must advance its revision by exactly one.");
}

export function assertExecutionUpdate(
  current: RuleExecution | null | undefined,
  next: RuleExecution,
  expectedRevision: number,
): void {
  assertExecutionRevision(next, expectedRevision);
  if (
    !current ||
    current.id !== next.id ||
    current.revision !== expectedRevision ||
    current.context.workspaceId !== next.context.workspaceId ||
    current.context.actorId !== next.context.actorId ||
    canonicalJson(current.context.scope) !== canonicalJson(next.context.scope) ||
    canonicalJson(current.rule) !== canonicalJson(next.rule) ||
    current.createdAt !== next.createdAt
  )
    throw resourceConflict("RuleExecution changed or its identity does not match.");
}

export class MemoryExecutionStore implements ExecutionStore {
  private readonly executions = new Map<string, RuleExecution>();

  async listPendingRequests(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly ActorRequest[]> {
    const requests = [...this.executions.values()]
      .filter(
        (execution) =>
          execution.context.workspaceId === workspaceId && execution.status === "waiting",
      )
      .flatMap((execution) =>
        Array.isArray(execution.checkpoint.requests)
          ? (execution.checkpoint.requests as unknown as readonly ActorRequest[])
          : [],
      )
      .filter((request) => request.actorId === actorId && request.status === "pending")
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      );
    return structuredClone(requests.slice(offset, offset + limit));
  }

  async hasActiveScope(workspaceId: string, scope: ScopeHandle): Promise<boolean> {
    return [...this.executions.values()].some(
      (item) =>
        item.context.workspaceId === workspaceId &&
        item.context.scope?.kind === scope.kind &&
        item.context.scope.id === scope.id &&
        (item.status === "running" || item.status === "waiting"),
    );
  }

  snapshot(): ReadonlyMap<string, RuleExecution> {
    return structuredClone(this.executions);
  }

  restore(snapshot: ReadonlyMap<string, RuleExecution>): void {
    this.executions.clear();
    for (const [id, execution] of snapshot) this.executions.set(id, structuredClone(execution));
  }

  async list(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly RuleExecutionSummary[]> {
    return structuredClone(
      [...this.executions.values()]
        .filter(
          (item) => item.context.workspaceId === workspaceId && item.context.actorId === actorId,
        )
        .sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.id < b.id
              ? 1
              : a.id === b.id
                ? 0
                : -1
            : a.createdAt < b.createdAt
              ? 1
              : -1,
        )
        .slice(offset, offset + limit)
        .map((execution) => ({
          id: execution.id,
          actorId: execution.context.actorId,
          ...(execution.context.scope ? { scope: execution.context.scope } : {}),
          rule: { id: execution.rule.id, key: execution.rule.key, label: execution.rule.label },
          status: execution.status,
          createdAt: execution.createdAt,
          updatedAt: execution.updatedAt,
        })),
    );
  }

  async create(execution: RuleExecution): Promise<void> {
    if (execution.revision !== 0)
      throw resourceConflict("A new execution must have revision zero.");
    if (this.executions.has(execution.id)) throw resourceConflict("RuleExecution already exists.");
    this.executions.set(execution.id, structuredClone(execution));
  }

  async getMany(workspaceId: string, ids: readonly string[]): Promise<readonly RuleExecution[]> {
    return structuredClone(
      [...new Set(ids)].flatMap((id) => {
        const execution = this.executions.get(id);
        return execution?.context.workspaceId === workspaceId ? [execution] : [];
      }),
    );
  }

  async get(workspaceId: string, id: string): Promise<RuleExecution | null> {
    const execution = this.executions.get(id);
    return execution?.context.workspaceId === workspaceId ? structuredClone(execution) : null;
  }

  async update(execution: RuleExecution, expectedRevision: number): Promise<void> {
    const current = this.executions.get(execution.id);
    assertExecutionUpdate(current, execution, expectedRevision);
    this.executions.set(execution.id, structuredClone(execution));
  }

  deleteWorkspace(workspaceId: string): void {
    for (const [id, execution] of this.executions)
      if (execution.context.workspaceId === workspaceId) this.executions.delete(id);
  }
}
