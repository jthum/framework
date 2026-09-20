// wa-sqlite's example VFS modules do not currently publish complete TypeScript declarations.
// @ts-nocheck
import SQLiteAsyncFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import SQLiteSyncFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import { Factory, SQLITE_ROW } from "wa-sqlite";
import { AccessHandlePoolVFS } from "wa-sqlite/src/examples/AccessHandlePoolVFS.js";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { MemoryAsyncVFS } from "wa-sqlite/src/examples/MemoryAsyncVFS.js";
import asyncWasmUrl from "wa-sqlite/dist/wa-sqlite-async.wasm?url";
import syncWasmUrl from "wa-sqlite/dist/wa-sqlite.wasm?url";

import { BROWSER_SQLITE_LOCKED } from "./constants.ts";

const DEFAULT_INITIAL_CAPACITY = 24;
const DEFAULT_CAPACITY_INCREMENT = 24;
const DEFAULT_MINIMUM_HEADROOM = 4;
const OPFS_HEADER_PATH_BYTES = 512;
const OPFS_HEADER_BYTES = 4096;

let options = null;
let sqlite3 = null;
let backend = "memory";
let selectedVfs = null;
let vfsInstance = null;
const databases = new Map();
const activeTransactions = new Set();

async function boot() {
  if (sqlite3) return sqlite3;
  if (!options) throw new Error("Browser SQLite worker has not been initialized.");
  const opfs = await tryOpfs();
  if (opfs) {
    sqlite3 = opfs.sqlite;
    backend = "opfs";
    selectedVfs = opfs.vfsName;
    vfsInstance = opfs.vfs;
    return sqlite3;
  }
  const module = await SQLiteAsyncFactory({
    locateFile: (file) => (String(file).endsWith(".wasm") ? asyncWasmUrl : file),
  });
  sqlite3 = Factory(module);
  backend = await registerAsyncVfs(sqlite3);
  return sqlite3;
}

async function tryOpfs() {
  if (!globalThis.navigator?.storage?.getDirectory) return null;
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const module = await SQLiteSyncFactory({
        locateFile: (file) => (String(file).endsWith(".wasm") ? syncWasmUrl : file),
      });
      const sqlite = Factory(module);
      const vfs = new AccessHandlePoolVFS(`/${options.namespace}`);
      await vfs.isReady;
      const extra = options.initialCapacity - vfs.getCapacity();
      if (extra > 0) await vfs.addCapacity(extra);
      sqlite.vfs_register(vfs, false);
      await probe(sqlite, vfs.name, vfs);
      return { sqlite, vfsName: vfs.name, vfs };
    } catch (error) {
      lastError = error;
      if (!isOpfsLockError(error) || attempt === 7) break;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  if (isOpfsLockError(lastError)) {
    throw new Error(
      `${BROWSER_SQLITE_LOCKED}: storage is locked by another tab or worker. Close other instances and retry.`,
    );
  }
  console.warn("OPFS SQLite unavailable; trying a fallback backend.", lastError);
  return null;
}

function isOpfsLockError(error) {
  if (!error) return false;
  const name = error.name ?? "";
  const message = String(error.message ?? error);
  return (
    name === "NoModificationAllowedError" ||
    name === "InvalidStateError" ||
    name === "InvalidAccessError" ||
    /access handle|already (?:open|opened)|exclusiv|locked|busy/i.test(message)
  );
}

async function registerAsyncVfs(sqlite) {
  const candidates = [];
  if (typeof indexedDB !== "undefined") {
    candidates.push({
      backend: "indexeddb",
      create: () => new IDBBatchAtomicVFS(options.namespace),
    });
  }
  candidates.push({ backend: "memory", create: () => new MemoryAsyncVFS() });

  let lastError;
  for (const candidate of candidates) {
    try {
      const vfs = candidate.create();
      if (vfs.isReady) await vfs.isReady;
      sqlite.vfs_register(vfs, false);
      await probe(sqlite, vfs.name, vfs);
      selectedVfs = vfs.name;
      vfsInstance = vfs;
      return candidate.backend;
    } catch (error) {
      lastError = error;
      console.warn(`${candidate.backend} SQLite unavailable.`, error);
    }
  }
  throw lastError ?? new Error("No browser SQLite VFS could be registered.");
}

async function probe(sqlite, vfsName, vfs) {
  const name = "__framework_sqlite_probe__";
  const database = await sqlite.open_v2(name, undefined, vfsName);
  try {
    await sqlite.exec(
      database,
      "CREATE TABLE IF NOT EXISTS probe (id TEXT); DROP TABLE IF EXISTS probe;",
    );
  } finally {
    await sqlite.close(database);
    await vfs.xDelete?.(name, 1);
  }
}

async function openDatabase(name) {
  const sqlite = await boot();
  await ensureOpfsHeadroom();
  const existing = databases.get(name);
  if (existing != null) return existing;
  try {
    const database = await sqlite.open_v2(name, undefined, selectedVfs);
    databases.set(name, database);
    return database;
  } catch (error) {
    const usage =
      typeof vfsInstance?.getSize === "function" && typeof vfsInstance?.getCapacity === "function"
        ? ` (${vfsInstance.getSize()}/${vfsInstance.getCapacity()} files in use)`
        : "";
    throw new Error(
      `Could not open SQLite database ${JSON.stringify(name)} on ${backend}${usage}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function ensureOpfsHeadroom() {
  if (
    backend !== "opfs" ||
    !vfsInstance ||
    typeof vfsInstance.getSize !== "function" ||
    typeof vfsInstance.getCapacity !== "function" ||
    typeof vfsInstance.reset !== "function" ||
    typeof vfsInstance.addCapacity !== "function" ||
    activeTransactions.size > 0 ||
    vfsInstance.getCapacity() - vfsInstance.getSize() > options.minimumHeadroom
  )
    return;

  for (const database of databases.values()) await sqlite3.close(database);
  databases.clear();
  await vfsInstance.reset();
  await vfsInstance.addCapacity(options.capacityIncrement);
}

function bindParameters(sqlite, statement, parameters) {
  if (!parameters?.length) return;
  parameters.forEach((value, index) => {
    const position = index + 1;
    if (value == null) sqlite.bind_null(statement, position);
    else if (value instanceof Uint8Array) sqlite.bind_blob(statement, position, value);
    else if (typeof value === "number") sqlite.bind_double(statement, position, value);
    else sqlite.bind_text(statement, position, value);
  });
}

async function execute(databaseName, sql, parameters = []) {
  const sqlite = await boot();
  const database = await openDatabase(databaseName);
  for await (const statement of sqlite.statements(database, sql)) {
    bindParameters(sqlite, statement, parameters);
    while ((await sqlite.step(statement)) === SQLITE_ROW) {
      // Drain rows from statements used through execute/run.
    }
  }
  trackTransaction(databaseName, sql);
}

async function all(databaseName, sql, parameters = []) {
  const sqlite = await boot();
  const database = await openDatabase(databaseName);
  const rows = [];
  for await (const statement of sqlite.statements(database, sql)) {
    bindParameters(sqlite, statement, parameters);
    const columns = sqlite.column_names(statement);
    while ((await sqlite.step(statement)) === SQLITE_ROW) {
      const values = sqlite.row(statement);
      const row = {};
      columns.forEach((column, index) => {
        row[column] = values[index];
      });
      rows.push(row);
    }
  }
  return rows;
}

function trackTransaction(databaseName, sql) {
  const statement = String(sql).trim().toUpperCase();
  if (/^BEGIN\b/.test(statement)) activeTransactions.add(databaseName);
  else if (/^(?:COMMIT|END|ROLLBACK)\b/.test(statement)) activeTransactions.delete(databaseName);
}

async function closeDatabase(name) {
  const sqlite = await boot();
  const database = databases.get(name);
  if (database != null) {
    await sqlite.close(database);
    databases.delete(name);
  }
  activeTransactions.delete(name);
}

async function closeAll() {
  if (sqlite3) {
    for (const database of databases.values()) {
      try {
        await sqlite3.close(database);
      } catch (error) {
        console.warn("Could not close browser SQLite database.", error);
      }
    }
    databases.clear();
    activeTransactions.clear();
  }
  if (vfsInstance && typeof vfsInstance.close === "function") {
    try {
      await vfsInstance.close();
    } catch (error) {
      console.warn("Could not close browser SQLite VFS.", error);
    }
  }
  vfsInstance = null;
  selectedVfs = null;
  sqlite3 = null;
  backend = "memory";
}

async function removeDatabase(name) {
  const sqlite = await boot();
  await closeDatabase(name);
  if (vfsInstance?.xDelete) await vfsInstance.xDelete(name, 1);
  void sqlite;
}

async function inspect() {
  const listed =
    backend === "opfs"
      ? await inspectOpfsDatabases()
      : [...databases.keys()]
          .sort((left, right) => left.localeCompare(right))
          .map((name) => ({ name, open: true }));
  const capacity =
    typeof vfsInstance?.getSize === "function" && typeof vfsInstance?.getCapacity === "function"
      ? { used: vfsInstance.getSize(), total: vfsInstance.getCapacity() }
      : undefined;
  return { databases: listed, ...(capacity ? { capacity } : {}) };
}

async function inspectOpfsDatabases() {
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(options.namespace);
  const open = new Set(databases.keys());
  const listed = [];
  for await (const [, handle] of directory.entries()) {
    if (handle.kind !== "file") continue;
    const file = await handle.getFile();
    const header = new Uint8Array(await file.slice(0, OPFS_HEADER_PATH_BYTES).arrayBuffer());
    const terminator = header.indexOf(0);
    const path = new TextDecoder().decode(
      header.subarray(0, terminator < 0 ? OPFS_HEADER_PATH_BYTES : terminator),
    );
    if (!path) continue;
    const name = path.replace(/^\//, "");
    listed.push({
      name,
      bytes: Math.max(0, file.size - OPFS_HEADER_BYTES),
      open: open.has(name),
    });
  }
  return listed.sort((left, right) => left.name.localeCompare(right.name));
}

async function wipe() {
  await closeAll();
  if (!globalThis.navigator?.storage?.getDirectory) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(options.namespace, { recursive: true });
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}

function configure(input) {
  if (options) return;
  options = {
    namespace: input.namespace,
    initialCapacity: input.initialCapacity ?? DEFAULT_INITIAL_CAPACITY,
    capacityIncrement: input.capacityIncrement ?? DEFAULT_CAPACITY_INCREMENT,
    minimumHeadroom: input.minimumHeadroom ?? DEFAULT_MINIMUM_HEADROOM,
  };
}

async function handleMessage(event) {
  const { id, method, db, sql, parameters } = event.data;
  try {
    if (method === "init") {
      configure(event.data.options);
      await boot();
      self.postMessage({ id, result: { backend } });
      return;
    }
    if (method === "open") await openDatabase(db);
    else if (method === "inspect") {
      self.postMessage({ id, result: await inspect() });
      return;
    } else if (method === "close") await closeDatabase(db);
    else if (method === "execute" || method === "run") await execute(db, sql ?? "", parameters);
    else if (method === "all") {
      self.postMessage({ id, result: await all(db, sql ?? "", parameters) });
      return;
    } else if (method === "remove") await removeDatabase(db);
    else if (method === "wipe") await wipe();
    else if (method === "shutdown") await closeAll();
    else throw new Error(`Unknown browser SQLite worker method ${method}.`);
    self.postMessage({ id, result: true });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

let chain = Promise.resolve();
self.onmessage = (event) => {
  chain = chain.then(
    () => handleMessage(event),
    () => handleMessage(event),
  );
};
