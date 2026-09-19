import { FrameworkError, resourceConflict, resourceNotFound } from "../errors/error.ts";
import type { CollectionRecord, RecordQueryRelation, RecordStore } from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  JsonValue,
  SourceFilter,
  SourceQueryDefinition,
} from "../spec/model.ts";
import type { SqliteConnection, SqliteDatabase, SqliteParameters } from "./gateway.ts";
import {
  decodeField,
  encodeField,
  explicitNulls,
  fieldSqlType,
  nullFieldIds,
  isStructuredField,
} from "./field-storage.ts";
import { compileFilter, querySqliteRecords } from "./record-query.ts";
import { queryRelatedSqliteRecords, type PhysicalQueryRelation } from "./related-query.ts";

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
      await createCreationIndex(connection, previousRow.table_name);
      const previous = JSON.parse(previousRow.definition_json) as CollectionDefinition;
      await reconcileFields(connection, previousRow.table_name, previous, collection);
      await connection.run(
        "UPDATE framework_record_schemas SET definition_json = ? WHERE workspace_id = ? AND collection_id = ?",
        [JSON.stringify(collection), workspaceId, collection.id],
      );
    }
  }

  async deleteWorkspaceWith(connection: SqliteConnection, workspaceId: string): Promise<void> {
    const rows = await connection.all<SchemaRow>(
      "SELECT * FROM framework_record_schemas WHERE workspace_id = ?",
      [workspaceId],
    );
    for (const row of rows)
      await connection.execute(`DROP TABLE ${quoteIdentifier(row.table_name)}`);
    await connection.run("DELETE FROM framework_record_schemas WHERE workspace_id = ?", [
      workspaceId,
    ]);
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
      "_null_fields",
      ...collection.fields.map(fieldColumn),
    ];
    const parameters: SqliteParameters = [
      record.id,
      record.collectionId,
      record.createdAt,
      record.updatedAt,
      record.createdBy,
      record.updatedBy,
      nullFieldIds(collection.fields, record.values),
      ...collection.fields.map((field) => encodeField(field, record.values[field.key])),
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

  /** Idempotent initial data for replaying an accepted lifecycle operation. */
  async seedWith(
    connection: SqliteConnection,
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void> {
    const table = await requireTableWith(connection, workspaceId, collection.id);
    const row = await connection.get<DataRow>(
      `SELECT * FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("_id")} = ?`,
      [record.id],
    );
    if (!row) return this.createWith(connection, workspaceId, collection, record);
    const canonical = (value: unknown) =>
      JSON.stringify(value, (_key, item: unknown) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
            )
          : item,
      );
    if (canonical(decodeRecord(row, collection)) !== canonical(record))
      throw resourceConflict("Lifecycle seed conflicts with an existing record.");
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

  async query(workspaceId: string, collection: CollectionDefinition, query: SourceQueryDefinition) {
    const table = await this.requireTable(workspaceId, collection.id);
    return querySqliteRecords(this.database, table, collection, query);
  }

  async queryRelated(
    workspaceId: string,
    collection: CollectionDefinition,
    query: SourceQueryDefinition,
    relations: readonly RecordQueryRelation[],
  ) {
    const rootTable = await this.requireTable(workspaceId, collection.id);
    const physical = await Promise.all(
      relations.map(async (relation) => ({
        ...relation,
        table: await this.requireTable(relation.workspaceId, relation.collection.id),
      })),
    );
    return queryRelatedSqliteRecords(this.database, rootTable, collection, query, physical);
  }

  /** Routed SQLite uses one root connection and attaches other record files only while querying. */
  async queryRelatedRouted(
    workspaceId: string,
    collection: CollectionDefinition,
    query: SourceQueryDefinition,
    relations: readonly PhysicalQueryRelation[],
    attachments: readonly { schema: string; name: string }[],
  ) {
    const rootTable = await this.requireTable(workspaceId, collection.id);
    const attached: string[] = [];
    try {
      for (const item of attachments) {
        try {
          await this.database.run(`ATTACH DATABASE ? AS ${quoteIdentifier(item.schema)}`, [
            item.name,
          ]);
        } catch {
          throw new FrameworkError({
            code: "SOURCE.CAPABILITY_UNSUPPORTED",
            message: "This SQLite connection cannot attach a related record database.",
          });
        }
        attached.push(item.schema);
      }
      return await queryRelatedSqliteRecords(
        this.database,
        rootTable,
        collection,
        query,
        relations,
      );
    } finally {
      for (const schema of attached.reverse())
        await this.database.execute(`DETACH DATABASE ${quoteIdentifier(schema)}`);
    }
  }

  async tableFor(workspaceId: string, collectionId: string): Promise<string> {
    return this.requireTable(workspaceId, collectionId);
  }

  get databaseHandle(): SqliteDatabase {
    return this.database;
  }

  async listFiltered(
    workspaceId: string,
    collection: CollectionDefinition,
    filter: SourceFilter,
  ): Promise<CollectionRecord[]> {
    const table = await this.requireTable(workspaceId, collection.id);
    const parameters: Array<null | number | string | Uint8Array> = [];
    const where = compileFilter(filter, collection, parameters);
    const rows = await this.database.all<DataRow>(
      `SELECT * FROM ${quoteIdentifier(table)} WHERE ${where} ORDER BY ${quoteIdentifier("_created_at")}, ${quoteIdentifier("_id")}`,
      parameters,
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
      ["_null_fields", nullFieldIds(collection.fields, record.values)],
      ...collection.fields.map(
        (field) => [fieldColumn(field), encodeField(field, record.values[field.key])] as const,
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
  await createRecordTable(connection, table, collection);
  await createCreationIndex(connection, table);
  await connection.run(
    "INSERT INTO framework_record_schemas (workspace_id, collection_id, table_name, definition_json) VALUES (?, ?, ?, ?)",
    [workspaceId, collection.id, table, JSON.stringify(collection)],
  );
}

async function createRecordTable(
  connection: SqliteConnection,
  table: string,
  collection: CollectionDefinition,
): Promise<void> {
  const columns = [
    ...systemColumns.map((column) => `${quoteIdentifier(column.name)} ${column.sql}`),
    `${quoteIdentifier("_null_fields")} TEXT NOT NULL DEFAULT '[]'`,
    ...collection.fields.map(
      (field) => `${quoteIdentifier(fieldColumn(field))} ${fieldSqlType(field)}`,
    ),
  ];
  await connection.execute(`CREATE TABLE ${quoteIdentifier(table)} (${columns.join(", ")})`);
}

async function createCreationIndex(connection: SqliteConnection, table: string): Promise<void> {
  // _id is the primary key and serves relationship joins. Ordinary Fields stay
  // unindexed by default; add workload-specific indexes only when queries need them.
  await connection.execute(
    `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${table}_created`)} ON ${quoteIdentifier(table)} (${quoteIdentifier("_created_at")}, ${quoteIdentifier("_id")})`,
  );
}

async function reconcileFields(
  connection: SqliteConnection,
  table: string,
  previous: CollectionDefinition,
  next: CollectionDefinition,
): Promise<void> {
  const oldFields = new Map(previous.fields.map((field) => [field.id, field]));
  if (
    next.fields.some((field) => {
      const old = oldFields.get(field.id);
      return (
        old &&
        (fieldSqlType(old) !== fieldSqlType(field) ||
          isStructuredField(old) !== isStructuredField(field) ||
          (old.type === "datetime") !== (field.type === "datetime") ||
          (old.type === "boolean") !== (field.type === "boolean"))
      );
    })
  ) {
    await rebuildRecordTable(connection, table, previous, next);
    return;
  }
  const previousIds = new Set(previous.fields.map((field) => field.id));
  const nextIds = new Set(next.fields.map((field) => field.id));
  for (const field of next.fields) {
    if (!previousIds.has(field.id)) {
      await connection.execute(
        `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(fieldColumn(field))} ${fieldSqlType(field)}`,
      );
      const fallback = schemaDefault(next, field.id);
      if (fallback !== undefined) {
        await connection.run(
          `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(fieldColumn(field))} = ?`,
          [encodeField(field, fallback)],
        );
        if (fallback === null) {
          await connection.run(
            `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier("_null_fields")} = json_insert(${quoteIdentifier("_null_fields")}, '$[#]', ?)`,
            [field.id],
          );
        }
      }
    }
  }
  for (const field of previous.fields) {
    if (!nextIds.has(field.id)) {
      await connection.execute(
        `ALTER TABLE ${quoteIdentifier(table)} DROP COLUMN ${quoteIdentifier(fieldColumn(field))}`,
      );
      await connection.run(
        `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier("_null_fields")} = (SELECT json_group_array(value) FROM json_each(${quoteIdentifier("_null_fields")}) WHERE value <> ?)`,
        [field.id],
      );
    }
  }
}

/** A live Field storage-kind edit rebuilds its table transactionally, without reading old formats. */
async function rebuildRecordTable(
  connection: SqliteConnection,
  table: string,
  previous: CollectionDefinition,
  next: CollectionDefinition,
): Promise<void> {
  const replacement = `${table}_rebuild`;
  await createRecordTable(connection, replacement, next);
  const oldFields = new Map(previous.fields.map((field) => [field.id, field]));
  const columns = [
    ...systemColumns.map((column) => column.name),
    "_null_fields",
    ...next.fields.map(fieldColumn),
  ];
  let after = "";
  while (true) {
    const rows = await connection.all<DataRow>(
      `SELECT * FROM ${quoteIdentifier(table)} WHERE "_id" > ? ORDER BY "_id" LIMIT 250`,
      [after],
    );
    if (!rows.length) break;
    for (const row of rows) {
      const record = decodeRecord(row, previous);
      const values: Record<string, JsonValue> = {};
      for (const field of next.fields) {
        const old = oldFields.get(field.id);
        const value = old ? record.values[old.key] : schemaDefault(next, field.id);
        if (value !== undefined) values[field.key] = value;
      }
      await connection.run(
        `INSERT INTO ${quoteIdentifier(replacement)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        [
          record.id,
          record.collectionId,
          record.createdAt,
          record.updatedAt,
          record.createdBy,
          record.updatedBy,
          nullFieldIds(next.fields, values),
          ...next.fields.map((field) => encodeField(field, values[field.key])),
        ],
      );
    }
    after = requireString(rows.at(-1)?._id);
  }
  await connection.execute(`DROP TABLE ${quoteIdentifier(table)}`);
  await connection.execute(
    `ALTER TABLE ${quoteIdentifier(replacement)} RENAME TO ${quoteIdentifier(table)}`,
  );
  await createCreationIndex(connection, table);
}

function schemaDefault(collection: CollectionDefinition, fieldId: string): JsonValue | undefined {
  const field = collection.fields.find((candidate) => candidate.id === fieldId);
  if (field?.default !== undefined) return field.default;
  return collection.lifecycle?.fieldId === fieldId ? collection.lifecycle.initial : undefined;
}

function decodeRecord(row: DataRow, collection: CollectionDefinition): CollectionRecord {
  const values: Record<string, JsonValue> = {};
  const nulls = explicitNulls(row._null_fields);
  for (const field of collection.fields) {
    const value = row[fieldColumn(field)];
    const decoded = decodeField(field, value, nulls.has(field.id));
    if (decoded !== undefined) values[field.key] = decoded;
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
