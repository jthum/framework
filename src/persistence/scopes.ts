import type { ScopeHandle } from "../kernel/model.ts";

/** Instance binding, not a portable Collection definition. */
export interface CollectionScope {
  readonly collectionId: string;
  readonly scope: ScopeHandle;
}

export interface ScopeStore {
  get(workspaceId: string, collectionId: string): Promise<ScopeHandle | null>;
  list(workspaceId: string): Promise<CollectionScope[]>;
  set(workspaceId: string, collectionId: string, scope: ScopeHandle | null): Promise<void>;
}

export class MemoryScopeStore implements ScopeStore {
  private readonly workspaces = new Map<string, Map<string, ScopeHandle>>();

  async get(workspaceId: string, collectionId: string): Promise<ScopeHandle | null> {
    return structuredClone(this.workspaces.get(workspaceId)?.get(collectionId) ?? null);
  }

  async list(workspaceId: string): Promise<CollectionScope[]> {
    return [...(this.workspaces.get(workspaceId) ?? [])].map(([collectionId, scope]) => ({
      collectionId,
      scope: structuredClone(scope),
    }));
  }

  async set(workspaceId: string, collectionId: string, scope: ScopeHandle | null): Promise<void> {
    if (scope === null) {
      this.workspaces.get(workspaceId)?.delete(collectionId);
      return;
    }
    let bindings = this.workspaces.get(workspaceId);
    if (!bindings) this.workspaces.set(workspaceId, (bindings = new Map()));
    bindings.set(collectionId, structuredClone(scope));
  }

  reconcile(workspaceId: string, collectionIds: ReadonlySet<string>): void {
    const bindings = this.workspaces.get(workspaceId);
    for (const id of bindings?.keys() ?? []) if (!collectionIds.has(id)) bindings?.delete(id);
    if (bindings?.size === 0) this.workspaces.delete(workspaceId);
  }
}
