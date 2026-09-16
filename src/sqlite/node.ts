import { DatabaseSync } from "node:sqlite";

import type { SqliteConnection, SqliteDatabase, SqliteParameters, SqliteValue } from "./gateway.ts";

export function openNodeSqlite(path = ":memory:"): SqliteDatabase {
  return new NodeSqliteDatabase(new DatabaseSync(path));
}

class NodeSqliteDatabase implements SqliteDatabase, SqliteConnection {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly database: DatabaseSync) {}

  async execute(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  async run(sql: string, parameters: SqliteParameters = []): Promise<void> {
    this.database.prepare(sql).run(...toNodeParameters(parameters));
  }

  async get<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T | null> {
    return (
      (this.database.prepare(sql).get(...toNodeParameters(parameters)) as T | undefined) ?? null
    );
  }

  async all<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T[]> {
    return this.database.prepare(sql).all(...toNodeParameters(parameters)) as T[];
  }

  transaction<T>(work: (connection: SqliteConnection) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      this.database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(this);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async close(): Promise<void> {
    await this.queue;
    this.database.close();
  }
}

function toNodeParameters(parameters: SqliteParameters): Array<SqliteValue> {
  return [...parameters];
}
