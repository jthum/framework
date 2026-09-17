import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import type { CollectionRecord, RecordStore } from "../persistence/records.ts";
import type { CollectionDefinition, FieldDefinition, JsonValue } from "../spec/model.ts";
import type { SqliteConnection, SqliteDatabase, SqliteParameters } from "./gateway.ts";

interface SchemaRow {
  workspace_id: string;
  collection_id: string;
  table_name: string;
  definition_json: string;
}

type DataRow = Record<string, null | number | string | Uint8Array>;

export class SqliteRecordStore implements RecordStore {
  constructor(private readonly database: SqliteDatabase) {}

  async initialize(): Promise<void> {
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS framework_record_schemas (
        workspace_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        table_name TEXT NOT NULL UNIQUE,
        definition_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, collection_id)
      );
    `);
  }

  applySchema(workspaceId: string, collections: readonly CollectionDefinition[]): Promise<void> {
    return this.database.transaction((connection) =>
      this.applySchemaWith(connection, workspaceId, collections),
    );
  }

  async applySchemaWith(
    connection: SqliteConnection,
    workspaceId: string,
    collections: readonly CollectionDefinition[],
  ): Promise<void> {
    const existing = await connection.all<SchemaRow>(
      "SELECT * FROM framework_record_schemas WHERE workspace_id = ?",
      [workspaceId],
    );
    const byId = new Map(existing.map((row) => [row.collection_id, row]));
    const desired = new Set(collections.map((collection) => collection.id));
    for (const row of existing) {
      if (desired.has(row.collection_id)) continue;
      await connection.execute(`DROP TABLE ${quoteIdentifier(row.table_name)}`);
      await connection.run(
        "DELETE FROM framework_record_schemas WHERE workspace_id = ? AND collection_id = ?",
        [workspaceId, row.collection_id],
      );
    }
    for (const collection of collections) {
      const previousRow = byId.get(collection.id);
      if (!previousRow) {
        await createCollectionTable(connection, workspaceId, collection);
        continue;
      }
      const previous = JSON.parse(previousRow.definition_json) as CollectionDefinition;
      await reconcileFields(connection, previousRow.table_name, previous, collection);
      await connection.run(
        "UPDATE framework_record_schemas SET definition_json = ? WHERE workspace_id = ? AND collection_id = ?",
        [JSON.stringify(collection), workspaceId, collection.id],
      );
    }
  }

  async create(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void> {
    return this.database.transaction((connection) =>
      this.createWith(connection, workspaceId, collection, record),
    );
  }

  async createWith(
    connection: SqliteConnection,
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void> {
    const table = await requireTableWith(connection, workspaceId, collection.id);
    const columns: string[] = [
      ...systemColumns.map((column) => column.name),
      ...collection.fields.map(fieldColumn),
    ];
    const parameters: SqliteParameters = [
      record.id,
      record.collectionId,
      record.createdAt,
      record.updatedAt,
      record.createdBy,
      record.updatedBy,
      ...collection.fields.map((field) => encodeValue(record.values[field.key])),
    ];
    try {
      await connection.run(
        `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        parameters,
      );
    } catch (error) {
      if (isConstraintError(error)) throw resourceConflict("Record already exists.");
      throw error;
    }
  }

  async get(
    workspaceId: string,
    collection: CollectionDefinition,
    recordId: string,
  ): Promise<CollectionRecord | null> {
    const table = await this.requireTable(workspaceId, collection.id);
    const row = await this.database.get<DataRow>(
      `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("_id")} = ?`,
      [recordId],
    );
    return row ? decodeRecord(row, collection) : null;
  }

  async getMany(
    workspaceId: string,
    collection: CollectionDefinition,
    recordIds: readonly string[],
  ): Promise<CollectionRecord[]> {
    if (recordIds.length === 0) return [];
    const table = await this.requireTable(workspaceId, collection.id);
    const rows = await this.database.all<DataRow>(
      `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("_id")} IN (${recordIds.map(() => "?").join(", ")})`,
      recordIds,
    );
    const byId = new Map(
      rows.map((row) => [requireString(row._id), decodeRecord(row, collection)]),
    );
    return recordIds.flatMap((id) => {
      const record = byId.get(id);
      return record === undefined ? [] : [record];
    });
  }

  async list(workspaceId: string, collection: CollectionDefinition): Promise<CollectionRecord[]> {
    const table = await this.requireTable(workspaceId, collection.id);
    const rows = await this.database.all<DataRow>(
      `SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier("_created_at")}, ${quoteIdentifier("_id")}`,
    );
    return rows.map((row) => decodeRecord(row, collection));
  }

  async update(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void> {
    if (!(await this.get(workspaceId, collection, record.id))) {
      throw resourceNotFound("Record", record.id);
    }
    const table = await this.requireTable(workspaceId, collection.id);
    const values: Array<readonly [string, null | number | string | Uint8Array]> = [
      ["_updated_at", record.updatedAt],
      ["_updated_by", record.updatedBy],
      ...collection.fields.map(
        (field) => [fieldColumn(field), encodeValue(record.values[field.key])] as const,
      ),
    ];
    await this.database.run(
      `UPDATE ${quoteIdentifier(table)} SET ${values.map(([column]) => `${quoteIdentifier(column)} = ?`).join(", ")} WHERE ${quoteIdentifier("_id")} = ?`,
      [...values.map(([, value]) => value), record.id],
    );
  }

  async delete(
    workspaceId: string,
    collection: CollectionDefinition,
    recordId: string,
  ): Promise<void> {
    if (!(await this.get(workspaceId, collection, recordId))) {
      throw resourceNotFound("Record", recordId);
    }
    const table = await this.requireTable(workspaceId, collection.id);
    await this.database.run(
      `DELETE FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("_id")} = ?`,
      [recordId],
    );
  }

  private async requireTable(workspaceId: string, collectionId: string): Promise<string> {
    return requireTableWith(this.database, workspaceId, collectionId);
  }
}

async function requireTableWith(
  connection: SqliteConnection,
  workspaceId: string,
  collectionId: string,
): Promise<string> {
  const row = await connection.get<SchemaRow>(
    "SELECT * FROM framework_record_schemas WHERE workspace_id = ? AND collection_id = ?",
    [workspaceId, collectionId],
  );
  if (!row) throw resourceNotFound("Collection", collectionId);
  return row.table_name;
}

const systemColumns = [
  { name: "_id", sql: "TEXT PRIMARY KEY" },
  { name: "_collection_id", sql: "TEXT NOT NULL" },
  { name: "_created_at", sql: "TEXT NOT NULL" },
  { name: "_updated_at", sql: "TEXT NOT NULL" },
  { name: "_created_by", sql: "TEXT NOT NULL" },
  { name: "_updated_by", sql: "TEXT NOT NULL" },
] as const;

async function createCollectionTable(
  connection: SqliteConnection,
  workspaceId: string,
  collection: CollectionDefinition,
): Promise<void> {
  const table = physicalTableName(workspaceId, collection.id);
  const columns = [
    ...systemColumns.map((column) => `${quoteIdentifier(column.name)} ${column.sql}`),
    ...collection.fields.map((field) => `${quoteIdentifier(fieldColumn(field))} TEXT`),
  ];
  await connection.execute(`CREATE TABLE ${quoteIdentifier(table)} (${columns.join(", ")})`);
  await connection.run(
    "INSERT INTO framework_record_schemas (workspace_id, collection_id, table_name, definition_json) VALUES (?, ?, ?, ?)",
    [workspaceId, collection.id, table, JSON.stringify(collection)],
  );
}

async function reconcileFields(
  connection: SqliteConnection,
  table: string,
  previous: CollectionDefinition,
  next: CollectionDefinition,
): Promise<void> {
  const previousIds = new Set(previous.fields.map((field) => field.id));
  const nextIds = new Set(next.fields.map((field) => field.id));
  for (const field of next.fields) {
    if (!previousIds.has(field.id)) {
      await connection.execute(
        `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(fieldColumn(field))} TEXT`,
      );
      const fallback = schemaDefault(next, field.id);
      if (fallback !== undefined) {
        await connection.run(
          `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(fieldColumn(field))} = ?`,
          [encodeValue(fallback)],
        );
      }
    }
  }
  for (const field of previous.fields) {
    if (!nextIds.has(field.id)) {
      await connection.execute(
        `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(fieldColumn(field))}`,
      );
    }
  }
}

function schemaDefault(collection: CollectionDefinition, fieldId: string): JsonValue | undefined {
  const field = collection.fields.find((candidate) => candidate.id === fieldId);
  if (field?.default !== undefined) return field.default;
  return collection.lifecycle?.fieldId === fieldId ? collection.lifecycle.initial : undefined;
}

function decodeRecord(row: DataRow, collection: CollectionDefinition): CollectionRecord {
  const values: Record<string, JsonValue> = {};
  for (const field of collection.fields) {
    const value = row[fieldColumn(field)];
    if (typeof value === "string") values[field.key] = JSON.parse(value) as JsonValue;
  }
  return {
    id: requireString(row._id),
    collectionId: requireString(row._collection_id),
    values,
    createdAt: requireString(row._created_at),
    updatedAt: requireString(row._updated_at),
    createdBy: requireString(row._created_by),
    updatedBy: requireString(row._updated_by),
  };
}

function encodeValue(value: JsonValue | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function fieldColumn(field: FieldDefinition): string {
  return `_field_${toHex(field.id)}`;
}

function physicalTableName(workspaceId: string, collectionId: string): string {
  return `_records_${toHex(workspaceId)}_${toHex(collectionId)}`;
}

function toHex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function requireString(value: DataRow[string] | undefined): string {
  if (typeof value !== "string") throw new TypeError("SQLite record metadata is invalid.");
  return value;
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
