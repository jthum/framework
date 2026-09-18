import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type { ExecutionContext } from "./model.ts";

export type RecordPolicyOperation = "create" | "read" | "update" | "delete";

export interface RecordPolicyRequest {
  readonly context: ExecutionContext;
  readonly workspaceId: string;
  readonly collection: CollectionDefinition;
  readonly operation: RecordPolicyOperation;
  readonly current?: CollectionRecord;
  readonly values?: RecordValues;
}

/** Optional row-level module policy. Collection ACL remains the coarse authorization boundary. */
export interface RecordPolicy {
  readonly collectionId: string;
  authorize(request: RecordPolicyRequest): boolean | Promise<boolean>;
}

export class RecordPolicyService {
  private readonly policies = new Map<string, RecordPolicy>();

  constructor(policies: readonly RecordPolicy[] = []) {
    for (const policy of policies) {
      if (this.policies.has(policy.collectionId))
        throw resourceConflict(
          `Record policy for Collection ${policy.collectionId} is already registered.`,
        );
      this.policies.set(policy.collectionId, policy);
    }
  }

  async assert(request: RecordPolicyRequest): Promise<void> {
    if (await this.allowed(request)) return;
    throw new FrameworkError({
      code: ERROR_CODES.permissionDenied,
      message: "The Actor is not allowed to access this record in the current scope.",
    });
  }

  async filter(
    context: ExecutionContext,
    workspaceId: string,
    collection: CollectionDefinition,
    records: readonly CollectionRecord[],
  ): Promise<CollectionRecord[]> {
    const policy = this.policies.get(collection.id);
    if (!policy) return [...records];
    const accepted = await Promise.all(
      records.map(async (current) => ({
        current,
        allowed: await policy.authorize({
          context,
          workspaceId,
          collection,
          operation: "read",
          current,
        }),
      })),
    );
    return accepted.filter((item) => item.allowed).map((item) => item.current);
  }

  private async allowed(request: RecordPolicyRequest): Promise<boolean> {
    const policy = this.policies.get(request.collection.id);
    return policy ? policy.authorize(request) : true;
  }
}
