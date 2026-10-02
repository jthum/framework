import { ERROR_CODES, FrameworkError, invalidInput, resourceNotFound } from "../errors/error.ts";
import { fieldsForEntity, validateEntityQuery } from "../persistence/module-query.ts";
import {
  assertEntityId,
  entitySchema,
  normalizeEntity,
  moduleSchemaSignature,
  moduleEntityAdditions,
  patchEntity,
  validateModuleSchema,
  valueAt,
} from "../persistence/module-schema.ts";
import { assertWorkspaceId, TransactionalModuleStore } from "../persistence/module-store.ts";
import {
  MODULE_CAPABILITIES,
  entityAnd,
  entityEqual,
  type EntityField,
  type EntityId,
  type EntityQuery,
  type EntityRow,
  type EntitySchema,
  type ModulePersistence,
  type ModuleSchema,
  type ModuleStore,
  type ModuleTransaction,
} from "../persistence/modules.ts";
import type { SqliteConnection, SqliteDatabase, SqliteValue } from "./gateway.ts";
import {
  compileModuleQuery,
  decodeModuleRow,
  moduleColumn,
  modulePlaceholder,
  moduleTable,
  moduleValue,
  quoteModuleIdentifier as quote,
} from "./module-query.ts";

const encodeField = (field: EntityField, value: unknown): SqliteValue =>
  field.type === "json" && value !== undefined ? JSON.stringify(value) : moduleValue(value);

/** Host entity storage shares the configured provider's session and transaction lifetime. */
export class SqliteModulePersistence implements ModulePersistence {
  readonly capabilities = MODULE_CAPABILITIES;
  private closed = false;
  constructor(private readonly database: SqliteDatabase) {}
  close(): void {
    this.closed = true;
  }
  private assertOpen(): void {
    if (this.closed) throw invalidInput("The persistence session is closed.");
  }
  async initialize(): Promise<void> {
    await this.database
      .execute(`CREATE TABLE IF NOT EXISTS module_schemas (id TEXT PRIMARY KEY, definition TEXT NOT NULL CHECK(json_valid(definition))) STRICT;
      CREATE TABLE IF NOT EXISTS module_sequences (module_id TEXT NOT NULL, entity_id TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(module_id,entity_id)) STRICT;`);
  }
  async open(input: ModuleSchema): Promise<ModuleStore> {
    this.assertOpen();
    const schema = validateModuleSchema(input, this.capabilities);
    await this.database.transaction(async (connection) => {
      this.assertOpen();
      const existing = await connection.get<{ definition: string }>(
        "SELECT definition FROM module_schemas WHERE id = ?",
        [schema.id],
      );
      const additions = moduleEntityAdditions(
        existing ? (JSON.parse(existing.definition) as ModuleSchema) : undefined,
        schema,
      );
      if (!existing || additions.length) {
        for (const name of additions) {
          const definition = schema.entities[name]!;
          await connection.execute(entityDdl(schema, name, definition));
          await connection.run(
            "INSERT INTO module_sequences (module_id,entity_id,sequence) VALUES (?,?,0)",
            [schema.id, name],
          );
        }
        const triggers = nullifyReferencesDdl(schema, additions);
        if (triggers) await connection.execute(triggers);
        await connection.run(
          "INSERT INTO module_schemas (id,definition) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
          [schema.id, moduleSchemaSignature(schema)],
        );
      }
    });
    return {
      workspace: (workspaceId) => {
        assertWorkspaceId(workspaceId);
        return new TransactionalModuleStore(async (work) => {
          this.assertOpen();
          return this.database.transaction(async (connection) => {
            this.assertOpen();
            const tx = new SqliteModuleTransaction(connection, schema, workspaceId);
            try {
              return await work(tx);
            } catch (error) {
              if (
                error instanceof Error &&
                /(?:UNIQUE|FOREIGN KEY|CHECK|NOT NULL) constraint failed/i.test(error.message)
              )
                throw new FrameworkError(
                  {
                    code: ERROR_CODES.resourceConflict,
                    message: "The entity conflicts with a storage constraint.",
                  },
                  { cause: error },
                );
              throw error;
            } finally {
              tx.finish();
            }
          });
        });
      },
    };
  }
  async deleteWorkspaceWith(connection: SqliteConnection, workspaceId: string): Promise<void> {
    const modules = await connection.all<{ definition: string }>(
      "SELECT definition FROM module_schemas",
    );
    // Defer cross-entity/self references while all rows in this Workspace are removed atomically.
    await connection.execute("PRAGMA defer_foreign_keys = ON");
    for (const module of modules) {
      const schema = JSON.parse(module.definition) as ModuleSchema;
      for (const entity of Object.keys(schema.entities))
        await connection.run(
          `DELETE FROM ${quote(moduleTable(schema.id, entity))} WHERE workspace_id = ?`,
          [workspaceId],
        );
    }
  }
}

function entityDdl(schema: ModuleSchema, name: string, entity: EntitySchema): string {
  const table = moduleTable(schema.id, name);
  const columns = [
    "workspace_id TEXT NOT NULL",
    "id ANY NOT NULL CHECK(typeof(id) IN ('integer','text'))",
  ];
  const constraints: string[] = ["PRIMARY KEY(workspace_id,id)"];
  for (const [path, field] of Object.entries(entity.fields)) {
    const column = quote(moduleColumn(path));
    const type =
      field.type === "number"
        ? field.generated
          ? "INTEGER"
          : "REAL"
        : field.type === "boolean"
          ? "INTEGER"
          : field.type === "id"
            ? "ANY"
            : "TEXT";
    const checks =
      field.type === "json"
        ? [`json_valid(${column})`]
        : field.type === "boolean"
          ? [`${column} IN (0,1)`]
          : field.type === "id"
            ? [`typeof(${column}) IN ('integer','text') OR ${column} IS NULL`]
            : [];
    if (field.values)
      checks.push(
        `${column} IN (${field.values.map((value) => (typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(Number(value)))).join(",") || "NULL"})`,
      );
    columns.push(
      `${column} ${type}${field.optional ? "" : " NOT NULL"}${checks.length ? ` CHECK(${checks.join(" AND ")})` : ""}`,
    );
    if (field.references)
      constraints.push(
        `FOREIGN KEY(workspace_id,${column}) REFERENCES ${quote(moduleTable(schema.id, field.references.entity))}(workspace_id,id) ON DELETE ${field.references.onDelete === "cascade" ? "CASCADE" : "NO ACTION"}`,
      );
  }
  const indexes = (entity.indexes ?? []).map(
    (index, ordinal) =>
      `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quote(`${table}__i_${ordinal}`)} ON ${quote(table)}(workspace_id,${index.fields.map((field) => (index.unique ? `json_array(${quote(moduleColumn(field))})` : quote(moduleColumn(field)))).join(",")});`,
  );
  return `CREATE TABLE ${quote(table)} (${[...columns, ...constraints].join(",")}) STRICT; ${indexes.join("\n")}`;
}

function nullifyReferencesDdl(schema: ModuleSchema, names: readonly string[]): string {
  const triggers: string[] = [];
  for (const [name, entity] of Object.entries(schema.entities))
    if (names.includes(name))
      for (const [path, field] of Object.entries(entity.fields)) {
        if (field.references?.onDelete !== "setNull") continue;
        const table = moduleTable(schema.id, name),
          column = moduleColumn(path);
        // A composite FK's native SET NULL would also clear workspace_id. Null only its ID,
        // including when the target is itself removed by a cascade elsewhere in the module.
        triggers.push(`CREATE TRIGGER ${quote(`${table}__null_${column}`)} BEFORE DELETE ON ${quote(moduleTable(schema.id, field.references.entity))} BEGIN
        UPDATE ${quote(table)} SET ${quote(column)} = NULL WHERE workspace_id = OLD.workspace_id AND ${quote(column)} IS OLD.id;
      END;`);
      }
  return triggers.join("\n");
}

class SqliteModuleTransaction implements ModuleTransaction {
  private active = true;
  constructor(
    private readonly connection: SqliteConnection,
    private readonly schema: ModuleSchema,
    private readonly workspaceId: string,
  ) {}
  finish(): void {
    this.active = false;
  }
  private assertActive(): void {
    if (!this.active) throw invalidInput("This module transaction has finished.");
  }
  async get<T extends object>(entity: string, id: EntityId): Promise<T | null> {
    assertEntityId(id);
    return (
      (await this.query<T>({ from: entity, where: entityEqual("id", id), limit: 1 }))[0] ?? null
    );
  }
  async query<T extends object>(query: EntityQuery): Promise<T[]> {
    this.assertActive();
    validateEntityQuery(this.schema, query, MODULE_CAPABILITIES);
    if (query.sample !== undefined) {
      const countQuery = compileModuleQuery(this.schema, this.workspaceId, {
        from: query.from!,
        ...(query.where ? { where: query.where } : {}),
        aggregate: { total: { op: "count" } },
      });
      const countRow = await this.connection.get<Record<string, unknown>>(
        countQuery.sql,
        countQuery.parameters,
      );
      const total = decodeModuleRow(countQuery.fields, countRow!, true).total as number;
      if (!total) return [];
      const ordinals = [
        ...new Set(
          Array.from({ length: query.sample }, (_, slot) =>
            Math.round(((total - 1) * slot) / (query.sample! - 1)),
          ),
        ),
      ];
      const { sample: _sample, ...base } = query;
      const pieces = ordinals.map((ordinal) =>
        compileModuleQuery(this.schema, this.workspaceId, { ...base, offset: ordinal, limit: 1 }),
      );
      // One count and one batched query; bodies are fetched only for the sampled rows.
      const sql = pieces
        .map(
          (piece, index) =>
            `SELECT *,${ordinals[index]} AS ordinal,${total} AS total FROM (${piece.sql})`,
        )
        .join(" UNION ALL ");
      const rows = await this.connection.all<Record<string, unknown>>(
        sql,
        pieces.flatMap((piece) => [...piece.parameters]),
      );
      return rows.map((row) => ({
        ...decodeModuleRow(pieces[0]!.fields, row, pieces[0]!.projected),
        ordinal: row.ordinal,
        total: row.total,
      })) as T[];
    }
    const compiled = compileModuleQuery(this.schema, this.workspaceId, query);
    const rows = await this.connection.all<Record<string, unknown>>(
      compiled.sql,
      compiled.parameters,
    );
    return rows.map((row) => decodeModuleRow(compiled.fields, row, compiled.projected)) as T[];
  }
  async insert<T extends object>(entity: string, row: object): Promise<T> {
    return (await this.insertMany<T>(entity, [row]))[0]!;
  }
  async insertMany<T extends object>(entity: string, inputs: readonly object[]): Promise<T[]> {
    this.assertActive();
    const definition = entitySchema(this.schema, entity);
    if (!inputs.length) return [];
    const sequence = await this.connection.get<{ sequence: number }>(
      "SELECT sequence FROM module_sequences WHERE module_id = ? AND entity_id = ?",
      [this.schema.id, entity],
    );
    let counter = sequence!.sequence;
    const rows = inputs.map((input) => {
      const ordinal = ++counter;
      const id = valueAt(input, "id") ?? ordinal;
      assertEntityId(id);
      if (typeof id === "number") counter = Math.max(counter, id);
      return normalizeEntity(definition, this.workspaceId, input, id, ordinal);
    });
    await this.connection.run(
      "UPDATE module_sequences SET sequence = ? WHERE module_id = ? AND entity_id = ?",
      [counter, this.schema.id, entity],
    );
    const fields = Object.keys(fieldsForEntity(this.schema, entity));
    const chunkSize = Math.max(1, Math.floor(900 / fields.length));
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const types = fieldsForEntity(this.schema, entity);
      const values = chunk.flatMap((row) =>
        fields.map((field) => encodeField(types[field]!, valueAt(row, field))),
      );
      await this.connection.run(
        `INSERT INTO ${quote(moduleTable(this.schema.id, entity))} (${fields.map((field) => quote(moduleColumn(field))).join(",")}) VALUES ${chunk.map((row) => `(${fields.map((field) => modulePlaceholder(valueAt(row, field))).join(",")})`).join(",")}`,
        values,
      );
    }
    return structuredClone(rows) as T[];
  }
  async update<T extends object>(entity: string, id: EntityId, patch: object): Promise<T> {
    const existing = await this.get<EntityRow>(entity, id);
    if (!existing) throw resourceNotFound("Entity", id);
    const row = patchEntity(entitySchema(this.schema, entity), existing, patch);
    const fields = Object.keys(entitySchema(this.schema, entity).fields);
    if (fields.length)
      await this.connection.run(
        `UPDATE ${quote(moduleTable(this.schema.id, entity))} SET ${fields.map((field) => `${quote(moduleColumn(field))} = ${modulePlaceholder(valueAt(row, field))}`).join(",")} WHERE workspace_id = ? AND id = ?`,
        [
          ...fields.map((field) =>
            encodeField(entitySchema(this.schema, entity).fields[field]!, valueAt(row, field)),
          ),
          this.workspaceId,
          id,
        ],
      );
    return row as T;
  }
  async delete(entity: string, id: EntityId): Promise<void> {
    this.assertActive();
    entitySchema(this.schema, entity);
    assertEntityId(id);
    await this.connection.run(
      `DELETE FROM ${quote(moduleTable(this.schema.id, entity))} WHERE workspace_id = ? AND id = ?`,
      [this.workspaceId, id],
    );
  }
  async upsert<T extends object>(entity: string, keys: readonly string[], row: object): Promise<T> {
    const definition = entitySchema(this.schema, entity);
    if (
      !definition.indexes?.some(
        (index) => index.unique && JSON.stringify(index.fields) === JSON.stringify(keys),
      )
    )
      throw invalidInput("Upsert needs a declared unique index.");
    const existing = (
      await this.query<EntityRow>({
        from: entity,
        where: entityAnd(
          ...keys.map((key) => entityEqual(key, (valueAt(row, key) as EntityId) ?? null)),
        ),
        limit: 1,
      })
    )[0];
    if (!existing) return this.insert<T>(entity, row);
    const { id: _id, workspaceId: _workspaceId, ...patch } = row as Record<string, unknown>;
    return this.update<T>(entity, existing.id as EntityId, patch);
  }
}
