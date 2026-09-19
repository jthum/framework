import { DatabaseSync } from "node:sqlite";

import type { SqliteConnection, SqliteDatabase, SqliteParameters, SqliteValue } from "./gateway.ts";

export function openNodeSqlite(path = ":memory:"): SqliteDatabase {
  return new NodeSqliteDatabase(new DatabaseSync(path), path);
}

class NodeSqliteDatabase implements SqliteDatabase {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly connection: NodeSqliteConnection;

  readonly name?: string;

  constructor(database: DatabaseSync, path: string) {
    this.connection = new NodeSqliteConnection(database);
    if (path !== ":memory:") this.name = path;
  }

  execute(sql: string): Promise<void> {
    return this.schedule(() => this.connection.execute(sql));
  }

  run(sql: string, parameters: SqliteParameters = []): Promise<void> {
    return this.schedule(() => this.connection.run(sql, parameters));
  }

  get<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T | null> {
    return this.schedule(() => this.connection.get<T>(sql, parameters));
  }

  all<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T[]> {
    return this.schedule(() => this.connection.all<T>(sql, parameters));
  }

  transaction<T>(work: (connection: SqliteConnection) => Promise<T>): Promise<T> {
    return this.schedule(async () => {
      await this.connection.execute("BEGIN IMMEDIATE");
      try {
        const result = await work(this.connection);
        await this.connection.execute("COMMIT");
        return result;
      } catch (error) {
        await this.connection.execute("ROLLBACK");
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    await this.queue;
    this.connection.close();
  }

  private schedule<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

class NodeSqliteConnection implements SqliteConnection {
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

  close(): void {
    this.database.close();
  }
}

function toNodeParameters(parameters: SqliteParameters): Array<SqliteValue> {
  return [...parameters];
}
