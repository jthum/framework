export type SqliteValue = null | number | string | Uint8Array;
export type SqliteParameters = readonly SqliteValue[];

export interface SqliteConnection {
  execute(sql: string): Promise<void>;
  run(sql: string, parameters?: SqliteParameters): Promise<void>;
  get<T extends object>(sql: string, parameters?: SqliteParameters): Promise<T | null>;
  all<T extends object>(sql: string, parameters?: SqliteParameters): Promise<T[]>;
}

export interface SqliteDatabase extends SqliteConnection {
  transaction<T>(work: (connection: SqliteConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type OpenSqliteDatabase = () => Promise<SqliteDatabase> | SqliteDatabase;
