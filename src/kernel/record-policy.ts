import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import type { CollectionDefinition, SourceFilter } from "../spec/model.ts";
import type { ExecutionContext } from "./model.ts";
import { matchesRootFilter } from "./source-query.ts";

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
  /** Queryable read restriction for list/View queries. Required by query-capable stores. */
  readonly readFilter?: (context: ExecutionContext) => SourceFilter | Promise<SourceFilter>;
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

  async readFilter(
    collection: CollectionDefinition,
    context: ExecutionContext,
  ): Promise<SourceFilter | undefined> {
    const policy = this.policies.get(collection.id);
    if (!policy) return undefined;
    if (!policy.readFilter)
      throw new FrameworkError({
        code: "SOURCE.CAPABILITY_UNSUPPORTED",
        message: `Record policy for ${collection.key} has no queryable read restriction.`,
      });
    return structuredClone(await policy.readFilter(context));
  }

  async filter(
    context: ExecutionContext,
    workspaceId: string,
    collection: CollectionDefinition,
    records: readonly CollectionRecord[],
  ): Promise<CollectionRecord[]> {
    const policy = this.policies.get(collection.id);
    if (!policy) return [...records];
    if (policy.readFilter) {
      const filter = await policy.readFilter(context);
      return records.filter((current) => matchesRootFilter(collection, current.values, filter));
    }
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
    if (!policy) return true;
    if (request.operation === "read" && policy.readFilter && request.current)
      return matchesRootFilter(
        request.collection,
        request.current.values,
        await policy.readFilter(request.context),
      );
    return policy.authorize(request);
  }
}
