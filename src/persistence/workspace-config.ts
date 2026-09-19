import type { WorkspaceConfig } from "../kernel/workspace-config.ts";

export interface WorkspaceConfigStore {
  get(workspaceId: string): Promise<WorkspaceConfig>;
  update(
    workspaceId: string,
    change: (current: WorkspaceConfig) => WorkspaceConfig,
  ): Promise<WorkspaceConfig>;
}

export class MemoryWorkspaceConfigStore implements WorkspaceConfigStore {
  private readonly configs = new Map<string, WorkspaceConfig>();
  private queue: Promise<unknown> = Promise.resolve();

  async get(workspaceId: string): Promise<WorkspaceConfig> {
    return structuredClone(this.configs.get(workspaceId) ?? { settings: [], actions: [] });
  }

  update(
    workspaceId: string,
    change: (current: WorkspaceConfig) => WorkspaceConfig,
  ): Promise<WorkspaceConfig> {
    const run = this.queue.then(() => {
      const next = structuredClone(
        change(structuredClone(this.configs.get(workspaceId) ?? { settings: [], actions: [] })),
      );
      this.configs.set(workspaceId, next);
      return structuredClone(next);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  deleteWorkspace(workspaceId: string): void {
    this.configs.delete(workspaceId);
  }

  snapshot(): ReadonlyMap<string, WorkspaceConfig> {
    return structuredClone(this.configs);
  }

  restore(snapshot: ReadonlyMap<string, WorkspaceConfig>): void {
    this.configs.clear();
    for (const [key, value] of snapshot) this.configs.set(key, structuredClone(value));
  }
}
