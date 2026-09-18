import type { ScopeConfig, ScopeHandle } from "../kernel/model.ts";

export interface ScopeEntry {
  readonly workspaceId: string;
  readonly scope: ScopeHandle;
  readonly config: ScopeConfig;
}

/** Instance-owned configuration for module entities. */
export interface ScopeStore {
  get(workspaceId: string, scope: ScopeHandle): Promise<ScopeConfig | null>;
  list(workspaceId: string): Promise<ScopeEntry[]>;
  set(workspaceId: string, scope: ScopeHandle, config: ScopeConfig): Promise<void>;
  delete(workspaceId: string, scope: ScopeHandle): Promise<void>;
}

export class MemoryScopeStore implements ScopeStore {
  private readonly entries = new Map<string, ScopeEntry>();

  async get(workspaceId: string, scope: ScopeHandle): Promise<ScopeConfig | null> {
    return structuredClone(this.entries.get(scopeKey(workspaceId, scope))?.config ?? null);
  }

  async list(workspaceId: string): Promise<ScopeEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => structuredClone(entry));
  }

  async set(workspaceId: string, scope: ScopeHandle, config: ScopeConfig): Promise<void> {
    this.entries.set(scopeKey(workspaceId, scope), structuredClone({ workspaceId, scope, config }));
  }

  async delete(workspaceId: string, scope: ScopeHandle): Promise<void> {
    this.entries.delete(scopeKey(workspaceId, scope));
  }

  deleteWorkspace(workspaceId: string): void {
    for (const [key, entry] of this.entries)
      if (entry.workspaceId === workspaceId) this.entries.delete(key);
  }

  snapshot(): ReadonlyMap<string, ScopeEntry> {
    return structuredClone(this.entries);
  }

  restore(snapshot: ReadonlyMap<string, ScopeEntry>): void {
    this.entries.clear();
    for (const [key, entry] of snapshot) this.entries.set(key, structuredClone(entry));
  }
}

function scopeKey(workspaceId: string, scope: ScopeHandle): string {
  return JSON.stringify([workspaceId, scope.kind, scope.id]);
}
