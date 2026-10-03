import { ERROR_CODES, FrameworkError } from "../errors/error.ts";
import { type PersistenceSession, type CollectionSeed } from "../persistence/catalog.ts";
import { type Spec } from "../spec/model.ts";
import { assertValidSpec } from "../spec/validate.ts";
import { type Clock } from "./defaults.ts";
import { type Workspace, type ScopeConfig, type ExecutionContext } from "./model.ts";
import { type CatalogAuthority } from "./catalog-authority.ts";
import { readScopeConfig, assertDistinctScopeIds, mergeScopeConfig } from "./scopes.ts";

export class SpecLifecycleService {
  constructor(
    private readonly persistence: Pick<
      PersistenceSession,
      "scopes" | "executions" | "applyWorkspaceSpec" | "applyScopeConfig" | "deleteScope"
    >,
    private readonly clock: Clock,
    private readonly authority: Pick<
      CatalogAuthority,
      | "assertContext"
      | "assertAuthorized"
      | "requireWorkspace"
      | "resolveWorkspace"
      | "assertSchemaCompatible"
    >,
  ) {}

  async apply(
    context: ExecutionContext,
    input: unknown,
    seeds: readonly CollectionSeed[] = [],
  ): Promise<Workspace> {
    await this.authority.assertContext(context);
    assertValidSpec(input);
    const current = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "spec.update",
      resource: {
        kind: "workspace",
        id: context.workspaceId,
        workspaceId: context.workspaceId,
      },
    });
    const spec: Spec = structuredClone(input);
    for (const entry of await this.persistence.scopes.list(current.id)) {
      assertDistinctScopeIds(entry.config, spec);
      assertValidSpec(mergeScopeConfig(spec, entry.config));
    }
    await this.authority.assertSchemaCompatible(context, current, spec);
    const workspace: Workspace = {
      ...current,
      spec,
      updatedAt: this.clock.now(),
    };
    await this.persistence.applyWorkspaceSpec(workspace, seeds);
    return workspace;
  }

  async applyScope(
    context: ExecutionContext,
    input: unknown,
    seeds: readonly CollectionSeed[] = [],
  ): Promise<ScopeConfig> {
    await this.authority.assertContext(context);
    if (!context.scope)
      throw new FrameworkError({
        code: ERROR_CODES.validationInvalidInput,
        message: "Scope configuration requires a scope context.",
      });
    await this.authority.assertAuthorized({
      context,
      operation: "scopes.update",
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
    const workspace = await this.authority.requireWorkspace(context.workspaceId);
    const config = readScopeConfig(input);
    assertDistinctScopeIds(config, workspace.spec);
    assertValidSpec(mergeScopeConfig(workspace.spec, config));
    for (const entry of await this.persistence.scopes.list(workspace.id)) {
      if (entry.scope.kind === context.scope.kind && entry.scope.id === context.scope.id) continue;
      assertDistinctScopeIds(config, entry.config);
    }
    const current = await this.authority.resolveWorkspace(context);
    await this.authority.assertSchemaCompatible(
      context,
      current,
      mergeScopeConfig(workspace.spec, config),
    );
    await this.persistence.applyScopeConfig(workspace, context.scope, config, seeds);
    return config;
  }

  async deleteScope(context: ExecutionContext): Promise<void> {
    await this.authority.assertContext(context);
    if (!context.scope)
      throw new FrameworkError({
        code: ERROR_CODES.validationInvalidInput,
        message: "Deleting scope configuration requires a scope context.",
      });
    await this.authority.assertAuthorized({
      context,
      operation: "scopes.delete",
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
    if (await this.persistence.executions.hasActiveScope(context.workspaceId, context.scope))
      throw new FrameworkError({
        code: ERROR_CODES.resourceConflict,
        message: "Scope has active Rule executions.",
      });
    await this.persistence.deleteScope(
      await this.authority.requireWorkspace(context.workspaceId),
      context.scope,
    );
  }
}
