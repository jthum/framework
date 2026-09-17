import { resourceConflict } from "../errors/error.ts";
import type { ExecutionContext } from "../kernel/model.ts";
import type { JsonValue, RuleDefinition } from "../spec/model.ts";

/** Instance state, not portable Spec. The Rule snapshot fixes the meaning of a resumed run. */
export interface RuleExecution {
  readonly id: string;
  readonly context: ExecutionContext;
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
  create(execution: RuleExecution): Promise<void>;
  get(workspaceId: string, id: string): Promise<RuleExecution | null>;
  /** Atomically replace revision N with N+1; stale resumes must fail. */
  update(execution: RuleExecution, expectedRevision: number): Promise<void>;
}

export function assertExecutionRevision(execution: RuleExecution, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 0 || execution.revision !== expected + 1)
    throw resourceConflict("An execution update must advance its revision by exactly one.");
}

export class MemoryExecutionStore implements ExecutionStore {
  private readonly executions = new Map<string, RuleExecution>();

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
    if (
      !current ||
      current.revision !== expectedRevision ||
      current.context.workspaceId !== execution.context.workspaceId ||
      current.context.actorId !== execution.context.actorId ||
      JSON.stringify(current.rule) !== JSON.stringify(execution.rule) ||
      current.createdAt !== execution.createdAt
    )
      throw resourceConflict("RuleExecution changed or its identity does not match.");
    this.executions.set(execution.id, structuredClone(execution));
  }
}
