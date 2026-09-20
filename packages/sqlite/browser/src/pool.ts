import type { SqliteConnection, SqliteDatabase, SqliteParameters } from "@jthum/framework/sqlite";

export { BROWSER_SQLITE_LOCKED } from "./constants.ts";

export type BrowserSqliteBackend = "opfs" | "indexeddb" | "memory";

export interface BrowserSqliteOptions {
  /** Isolates this host's files and IndexedDB data from other applications on the same origin. */
  readonly namespace: string;
  readonly initialCapacity?: number;
  readonly capacityIncrement?: number;
  readonly minimumHeadroom?: number;
}

export interface BrowserSqliteDatabaseInfo {
  readonly name: string;
  readonly bytes?: number;
  readonly open: boolean;
}

export interface BrowserSqliteDiagnostics {
  readonly backend: BrowserSqliteBackend;
  readonly databases: readonly BrowserSqliteDatabaseInfo[];
  readonly capacity?: { readonly used: number; readonly total: number };
}

export interface BrowserSqlitePool {
  readonly backend: BrowserSqliteBackend;
  open(name: string): Promise<SqliteDatabase>;
  inspect(): Promise<BrowserSqliteDiagnostics>;
  remove(name: string): Promise<void>;
  close(): Promise<void>;
  wipe(): Promise<void>;
}

type RpcResult = { readonly id: number; readonly result?: unknown; readonly error?: string };

export async function createBrowserSqlitePool(
  options: BrowserSqliteOptions,
): Promise<BrowserSqlitePool> {
  const namespace = normalizeNamespace(options.namespace);
  if (typeof Worker === "undefined") throw new Error("Browser SQLite requires Web Workers.");
  const worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let closed = false;
  const openNames = new Set<string>();

  worker.addEventListener("message", (event: MessageEvent<RpcResult>) => {
    const waiter = pending.get(event.data.id);
    if (!waiter) return;
    pending.delete(event.data.id);
    if (event.data.error) waiter.reject(new Error(event.data.error));
    else waiter.resolve(event.data.result);
  });
  worker.addEventListener("error", (event) => {
    const error = event.error instanceof Error ? event.error : new Error("SQLite worker failed.");
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  function rpc(payload: Record<string, unknown>): Promise<unknown> {
    if (closed) return Promise.reject(new Error("Browser SQLite pool is closed."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, ...payload });
    });
  }

  const init = (await rpc({ method: "init", options: { ...options, namespace } })) as {
    backend: BrowserSqliteBackend;
  };

  async function closeWorker(): Promise<void> {
    if (closed) return;
    try {
      await rpc({ method: "shutdown" });
    } finally {
      closed = true;
      openNames.clear();
      worker.terminate();
      for (const waiter of pending.values())
        waiter.reject(new Error("Browser SQLite pool closed."));
      pending.clear();
    }
  }

  return {
    backend: init.backend,
    async open(name) {
      assertDatabaseName(name);
      if (openNames.has(name))
        throw new Error(
          `SQLite database ${JSON.stringify(name)} already has an active connection.`,
        );
      openNames.add(name);
      try {
        await rpc({ method: "open", db: name });
        return new WorkerSqliteDatabase(name, rpc, () => openNames.delete(name));
      } catch (error) {
        openNames.delete(name);
        throw error;
      }
    },
    async inspect() {
      const result = (await rpc({ method: "inspect" })) as Omit<
        BrowserSqliteDiagnostics,
        "backend"
      >;
      return { backend: init.backend, ...result };
    },
    async remove(name) {
      assertDatabaseName(name);
      if (openNames.has(name))
        throw new Error(`Cannot remove open SQLite database ${JSON.stringify(name)}.`);
      await rpc({ method: "remove", db: name });
    },
    close: closeWorker,
    async wipe() {
      if (closed) return;
      await rpc({ method: "wipe" });
      await deleteIndexedDb(namespace);
      await closeWorker();
    },
  };
}

class WorkerSqliteDatabase implements SqliteDatabase {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    readonly name: string,
    private readonly rpc: (payload: Record<string, unknown>) => Promise<unknown>,
    private readonly release: () => void,
  ) {}

  execute(sql: string): Promise<void> {
    return this.schedule(
      async () => void (await this.rpc({ method: "execute", db: this.name, sql })),
    );
  }

  run(sql: string, parameters: SqliteParameters = []): Promise<void> {
    return this.schedule(
      async () => void (await this.rpc({ method: "run", db: this.name, sql, parameters })),
    );
  }

  get<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T | null> {
    return this.schedule(async () => {
      const rows = (await this.rpc({ method: "all", db: this.name, sql, parameters })) as T[];
      return rows[0] ?? null;
    });
  }

  all<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T[]> {
    return this.schedule(
      async () => (await this.rpc({ method: "all", db: this.name, sql, parameters })) as T[],
    );
  }

  transaction<T>(work: (connection: SqliteConnection) => Promise<T>): Promise<T> {
    return this.schedule(async () => {
      const connection = new WorkerTransactionConnection(this.name, this.rpc);
      await connection.execute("BEGIN IMMEDIATE");
      try {
        const result = await work(connection);
        await connection.execute("COMMIT");
        return result;
      } catch (error) {
        try {
          await connection.execute("ROLLBACK");
        } catch {
          // Preserve the work error when rollback also fails.
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.schedule(async () => {
      if (this.closed) return;
      try {
        await this.rpc({ method: "close", db: this.name });
      } finally {
        this.closed = true;
        this.release();
      }
    });
  }

  private schedule<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`SQLite database ${this.name} is closed.`));
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

class WorkerTransactionConnection implements SqliteConnection {
  constructor(
    private readonly name: string,
    private readonly rpc: (payload: Record<string, unknown>) => Promise<unknown>,
  ) {}

  async execute(sql: string): Promise<void> {
    await this.rpc({ method: "execute", db: this.name, sql });
  }

  async run(sql: string, parameters: SqliteParameters = []): Promise<void> {
    await this.rpc({ method: "run", db: this.name, sql, parameters });
  }

  async get<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T | null> {
    const rows = (await this.rpc({ method: "all", db: this.name, sql, parameters })) as T[];
    return rows[0] ?? null;
  }

  async all<T extends object>(sql: string, parameters: SqliteParameters = []): Promise<T[]> {
    return (await this.rpc({ method: "all", db: this.name, sql, parameters })) as T[];
  }
}

function normalizeNamespace(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Browser SQLite namespace must contain a letter or number.");
  return normalized;
}

function assertDatabaseName(value: string): void {
  if (!value || value.includes("/") || value.includes("\\"))
    throw new Error("SQLite database names must be non-empty file names, not paths.");
}

function deleteIndexedDb(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
