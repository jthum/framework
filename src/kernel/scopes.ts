import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type { ScopeStore } from "../persistence/scopes.ts";
import type { ExecutionContext, ScopeHandle } from "./model.ts";

export function assertScope(scope: ScopeHandle): void {
  if (
    !scope ||
    typeof scope.kind !== "string" ||
    !scope.kind.trim() ||
    typeof scope.id !== "string" ||
    !scope.id.trim()
  )
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "Scope kind and id must be non-empty strings.",
    });
}

export function sameScope(left: ScopeHandle | null, right: ScopeHandle | undefined): boolean {
  return left === null || (left.kind === right?.kind && left.id === right.id);
}

/** Selection isolation is separate from module-specific authorization. */
export async function assertCollectionScope(
  store: ScopeStore,
  context: ExecutionContext,
  collectionId: string,
): Promise<void> {
  if (!sameScope(await store.get(context.workspaceId, collectionId), context.scope))
    throw resourceNotFound("Collection", collectionId);
}
