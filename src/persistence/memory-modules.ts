import { invalidInput, resourceConflict, resourceNotFound } from "../errors/error.ts";
import { validateEntityQuery } from "./module-query.ts";
import { evaluateEntityQuery } from "./module-evaluator.ts";
import {
  assertEntityId,
  entitySchema,
  normalizeEntity,
  moduleSchemaSignature,
  setAt,
  patchEntity,
  validateModuleSchema,
  valueAt,
} from "./module-schema.ts";
import { assertWorkspaceId, TransactionalModuleStore } from "./module-store.ts";
import {
  MODULE_CAPABILITIES,
  type EntityId,
  type EntityQuery,
  type EntityRow,
  type ModulePersistence,
  type ModuleSchema,
  type ModuleStore,
  type ModuleTransaction,
} from "./modules.ts";

interface EntityState {
  rows: Map<string, EntityRow>;
  sequence: number;
}
interface ModuleState {
  schema: ModuleSchema;
  entities: Map<string, EntityState>;
}
const identity = (workspaceId: string, id: EntityId): string => JSON.stringify([workspaceId, id]);

/** Adapter lifetime state, shared by sessions; serialized snapshots make transactions atomic. */
export class MemoryModuleDatabase {
  private readonly modules = new Map<string, ModuleState>();
  private queue: Promise<unknown> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  register(schema: ModuleSchema): void {
    const existing = this.modules.get(schema.id);
    if (existing && moduleSchemaSignature(existing.schema) !== moduleSchemaSignature(schema))
      throw resourceConflict(
        "The module schema changed. Reset development storage before opening it.",
      );
    if (!existing)
      this.modules.set(schema.id, {
        schema,
        entities: new Map(
          Object.keys(schema.entities).map((name) => [name, { rows: new Map(), sequence: 0 }]),
        ),
      });
  }
  state(module: string): ModuleState {
    return this.modules.get(module)!;
  }
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.run(async () => {
      for (const module of this.modules.values())
        for (const entity of module.entities.values())
          for (const [key, row] of entity.rows)
            if (row.workspaceId === workspaceId) entity.rows.delete(key);
    });
  }
  async drain(): Promise<void> {
    await this.queue;
  }
}

export class MemoryModulePersistence implements ModulePersistence {
  readonly capabilities = MODULE_CAPABILITIES;
  private closed = false;
  constructor(private readonly database: MemoryModuleDatabase) {}
  close(): void {
    this.closed = true;
  }
  private assertOpen(): void {
    if (this.closed) throw invalidInput("The persistence session is closed.");
  }
  async open(input: ModuleSchema): Promise<ModuleStore> {
    this.assertOpen();
    const schema = validateModuleSchema(input, this.capabilities);
    await this.database.run(async () => {
      this.assertOpen();
      this.database.register(schema);
    });
    return {
      workspace: (workspaceId) => {
        assertWorkspaceId(workspaceId);
        return new TransactionalModuleStore(async (work) => {
          this.assertOpen();
          return this.database.run(async () => {
            this.assertOpen();
            const tx = new MemoryModuleTransaction(this.database.state(schema.id), workspaceId);
            try {
              return await work(tx);
            } catch (error) {
              tx.rollback();
              throw error;
            } finally {
              tx.finish();
            }
          });
        });
      },
    };
  }
}

class MemoryModuleTransaction implements ModuleTransaction {
  private active = true;
  private snapshot: Map<string, EntityState> | undefined;
  constructor(
    private readonly state: ModuleState,
    private readonly workspaceId: string,
  ) {}
  finish(): void {
    this.active = false;
  }
  rollback(): void {
    if (this.snapshot) this.state.entities = this.snapshot;
  }
  private beforeWrite(): void {
    this.snapshot ??= structuredClone(this.state.entities);
  }
  private entity(name: string): EntityState {
    if (!this.active) throw invalidInput("This module transaction has finished.");
    entitySchema(this.state.schema, name);
    return this.state.entities.get(name)!;
  }
  private rows(entity: string): EntityRow[] {
    return [...this.entity(entity).rows.values()].filter(
      (row) => row.workspaceId === this.workspaceId,
    );
  }
  private check(entity: string, row: EntityRow): void {
    const schema = entitySchema(this.state.schema, entity);
    for (const [field, definition] of Object.entries(schema.fields)) {
      const value = valueAt(row, field);
      if (
        definition.references &&
        value != null &&
        !this.entity(definition.references.entity).rows.has(
          identity(this.workspaceId, value as EntityId),
        )
      )
        throw resourceConflict("The referenced entity does not exist in this Workspace.");
    }
    for (const index of schema.indexes ?? [])
      if (
        index.unique &&
        this.rows(entity).some(
          (other) =>
            other.id !== row.id &&
            index.fields.every(
              (field) => (valueAt(other, field) ?? null) === (valueAt(row, field) ?? null),
            ),
        )
      )
        throw resourceConflict("The entity conflicts with a unique index.");
  }
  async get<T extends object>(entity: string, id: EntityId): Promise<T | null> {
    assertEntityId(id);
    const row = this.entity(entity).rows.get(identity(this.workspaceId, id));
    return row ? (structuredClone(row) as T) : null;
  }
  async query<T extends object>(query: EntityQuery): Promise<T[]> {
    if (!this.active) throw invalidInput("This module transaction has finished.");
    validateEntityQuery(this.state.schema, query, MODULE_CAPABILITIES);
    return evaluateEntityQuery(query, (entity) => this.rows(entity)) as T[];
  }
  async insert<T extends object>(entity: string, input: object): Promise<T> {
    const table = this.entity(entity);
    this.beforeWrite();
    const sequence = ++table.sequence;
    const id = valueAt(input, "id") ?? sequence;
    assertEntityId(id);
    if (typeof id === "number") table.sequence = Math.max(table.sequence, id);
    const key = identity(this.workspaceId, id);
    if (table.rows.has(key)) throw resourceConflict("The entity already exists.");
    const row = normalizeEntity(
      entitySchema(this.state.schema, entity),
      this.workspaceId,
      input,
      id,
      sequence,
    );
    this.check(entity, row);
    table.rows.set(key, row);
    return structuredClone(row) as T;
  }
  async insertMany<T extends object>(entity: string, rows: readonly object[]): Promise<T[]> {
    const result: T[] = [];
    for (const row of rows) result.push(await this.insert<T>(entity, row));
    return result;
  }
  async update<T extends object>(entity: string, id: EntityId, patch: object): Promise<T> {
    const old = await this.get<EntityRow>(entity, id);
    if (!old) throw resourceNotFound("Entity", id);
    const row = patchEntity(entitySchema(this.state.schema, entity), old, patch);
    this.check(entity, row);
    this.beforeWrite();
    this.entity(entity).rows.set(identity(this.workspaceId, id), row);
    return structuredClone(row) as T;
  }
  async delete(entity: string, id: EntityId): Promise<void> {
    if (!(await this.get(entity, id))) return;
    const removals = new Map<string, { entity: string; id: EntityId }>();
    const key = (name: string, value: EntityId) => JSON.stringify([name, value]);
    const pending = [{ entity, id }];
    // Resolve the cascade closure first; restrictions within that closure must not block deletion.
    for (let index = 0; index < pending.length; index++) {
      const target = pending[index]!;
      if (removals.has(key(target.entity, target.id))) continue;
      removals.set(key(target.entity, target.id), target);
      for (const [name, definition] of Object.entries(this.state.schema.entities))
        for (const [field, config] of Object.entries(definition.fields))
          if (
            config.references?.entity === target.entity &&
            config.references.onDelete === "cascade"
          )
            for (const row of this.rows(name))
              if (valueAt(row, field) === target.id)
                pending.push({ entity: name, id: row.id as EntityId });
    }
    const updates = new Map<
      string,
      { entity: string; id: EntityId; patch: Record<string, unknown> }
    >();
    for (const target of removals.values())
      for (const [name, definition] of Object.entries(this.state.schema.entities))
        for (const [field, config] of Object.entries(definition.fields)) {
          if (config.references?.entity !== target.entity) continue;
          for (const row of this.rows(name)) {
            const rowKey = key(name, row.id as EntityId);
            if (removals.has(rowKey) || valueAt(row, field) !== target.id) continue;
            if (config.references.onDelete !== "setNull")
              throw resourceConflict("Another entity still references this entity.");
            const update = updates.get(rowKey) ?? {
              entity: name,
              id: row.id as EntityId,
              patch: {},
            };
            setAt(update.patch, field, null);
            updates.set(rowKey, update);
          }
        }
    for (const update of updates.values())
      await this.update(update.entity, update.id, update.patch);
    this.beforeWrite();
    for (const target of removals.values())
      this.entity(target.entity).rows.delete(identity(this.workspaceId, target.id));
  }
  async upsert<T extends object>(entity: string, keys: readonly string[], row: object): Promise<T> {
    const schema = entitySchema(this.state.schema, entity);
    if (
      !schema.indexes?.some(
        (index) => index.unique && JSON.stringify(index.fields) === JSON.stringify(keys),
      )
    )
      throw invalidInput("Upsert needs a declared unique index.");
    const match = this.rows(entity).find((other) =>
      keys.every((field) => (valueAt(other, field) ?? null) === (valueAt(row, field) ?? null)),
    );
    if (!match) return this.insert<T>(entity, row);
    const { id: _id, workspaceId: _workspace, ...patch } = row as Record<string, unknown>;
    return this.update<T>(entity, match.id as EntityId, patch);
  }
}
