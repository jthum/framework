import { invalidInput } from "../errors/error.ts";
import type {
  EntityId,
  EntityQuery,
  EntityRow,
  ModuleTransaction,
  ModuleWorkspaceStore,
} from "./modules.ts";

/** Shared public facade; providers implement one transaction boundary, not two CRUD paths. */
export class TransactionalModuleStore implements ModuleWorkspaceStore {
  constructor(private readonly run: ModuleWorkspaceStore["transaction"]) {}
  transaction<T>(work: (transaction: ModuleTransaction) => Promise<T>): Promise<T> {
    return this.run(work);
  }
  get<T extends object = EntityRow>(entity: string, id: EntityId): Promise<T | null> {
    return this.transaction((tx) => tx.get<T>(entity, id));
  }
  query<T extends object = EntityRow>(query: EntityQuery): Promise<T[]> {
    return this.transaction((tx) => tx.query<T>(query));
  }
  insert<T extends object = EntityRow>(entity: string, row: object): Promise<T> {
    return this.transaction((tx) => tx.insert<T>(entity, row));
  }
  insertMany<T extends object = EntityRow>(entity: string, rows: readonly object[]): Promise<T[]> {
    return this.transaction((tx) => tx.insertMany<T>(entity, rows));
  }
  update<T extends object = EntityRow>(entity: string, id: EntityId, patch: object): Promise<T> {
    return this.transaction((tx) => tx.update<T>(entity, id, patch));
  }
  delete(entity: string, id: EntityId): Promise<void> {
    return this.transaction((tx) => tx.delete(entity, id));
  }
  upsert<T extends object = EntityRow>(
    entity: string,
    keys: readonly string[],
    row: object,
  ): Promise<T> {
    return this.transaction((tx) => tx.upsert<T>(entity, keys, row));
  }
}

export function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== "string" || !workspaceId)
    throw invalidInput("Bind module storage to a Workspace before using it.");
}
