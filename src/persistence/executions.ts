import { resourceConflict } from "../errors/error.ts";
import type { ExecutionContext, ScopeHandle } from "../kernel/model.ts";
import type { JsonValue, RuleDefinition } from "../spec/model.ts";

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

/** Trusted persistence port. Actor-facing authorization belongs to the Kernel. */
export interface ExecutionStore {
  hasActiveScope(workspaceId: string, scope: ScopeHandle): Promise<boolean>;
  create(execution: RuleExecution): Promise<void>;
  get(workspaceId: string, id: string): Promise<RuleExecution | null>;
  list(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly RuleExecution[]>;
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

/** Compare portable JSON structurally: object property order is not definition identity. */
function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  );
}

export class MemoryExecutionStore implements ExecutionStore {
  private readonly executions = new Map<string, RuleExecution>();

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
  ): Promise<readonly RuleExecution[]> {
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
        .slice(offset, offset + limit),
    );
  }

  async create(execution: RuleExecution): Promise<void> {
    if (execution.revision !== 0)
      throw resourceConflict("A new execution must have revision zero.");
    if (this.executions.has(execution.id)) throw resourceConflict("RuleExecution already exists.");
    this.executions.set(execution.id, structuredClone(execution));
  }

  async get(workspaceId: string, id: string): Promise<RuleExecution | null> {
    const execution = this.executions.get(id);
    return execution?.context.workspaceId === workspaceId ? structuredClone(execution) : null;
  }

  async update(execution: RuleExecution, expectedRevision: number): Promise<void> {
    assertExecutionRevision(execution, expectedRevision);
    const current = this.executions.get(execution.id);
    assertExecutionUpdate(current, execution, expectedRevision);
    this.executions.set(execution.id, structuredClone(execution));
  }

  deleteWorkspace(workspaceId: string): void {
    for (const [id, execution] of this.executions)
      if (execution.context.workspaceId === workspaceId) this.executions.delete(id);
  }
}
