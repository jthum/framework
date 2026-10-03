import { afterEach, expect, it, vi } from "vite-plus/test";

const fixture = vi.hoisted(() => {
  let next = 0;
  return {
    size: 0,
    capacity: 24,
    sqlite: {
      open_v2: vi.fn(async (_name: string, _flags: unknown, _vfs: string) => ++next),
      close: vi.fn(async (_database: number) => {}),
      exec: vi.fn(async (_database: number, _sql: string) => {}),
      vfs_register: vi.fn(),
    },
  };
});

vi.mock("wa-sqlite", () => ({ Factory: () => fixture.sqlite, SQLITE_ROW: 100 }));
vi.mock("wa-sqlite/dist/wa-sqlite.mjs", () => ({ default: async () => ({}) }));
vi.mock("wa-sqlite/dist/wa-sqlite-async.mjs", () => ({ default: async () => ({}) }));
vi.mock("wa-sqlite/dist/wa-sqlite.wasm?url", () => ({ default: "sync.wasm" }));
vi.mock("wa-sqlite/dist/wa-sqlite-async.wasm?url", () => ({ default: "async.wasm" }));
vi.mock("wa-sqlite/src/examples/AccessHandlePoolVFS.js", () => ({
  AccessHandlePoolVFS: class {
    readonly name = "test-opfs";
    readonly isReady = Promise.resolve();
    getSize(): number {
      return fixture.size;
    }
    getCapacity(): number {
      return fixture.capacity;
    }
    async reset(): Promise<void> {
      fixture.size = 0;
    }
    async addCapacity(count: number): Promise<void> {
      fixture.capacity += count;
    }
  },
}));

afterEach(() => vi.unstubAllGlobals());

it("enables foreign keys on every reopened OPFS connection and closes a failed initialization", async () => {
  let nextRequest = 0;
  const pending = new Map<number, (message: { error?: string }) => void>();
  const worker: {
    onmessage?: (event: { data: Record<string, unknown> }) => void;
    postMessage: (message: { id: number; error?: string }) => void;
  } = {
    postMessage: (message) => {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    },
  };
  vi.stubGlobal("self", worker);
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({}) } });
  await import("./worker.ts");
  const request = (data: Record<string, unknown>): Promise<void> =>
    new Promise((resolve, reject) => {
      const id = ++nextRequest;
      pending.set(id, (message) => (message.error ? reject(new Error(message.error)) : resolve()));
      worker.onmessage?.({ data: { id, ...data } });
    });
  await request({
    method: "init",
    options: { namespace: "test", initialCapacity: 24, capacityIncrement: 24, minimumHeadroom: 4 },
  });
  await request({ method: "open", db: "catalog.db" });
  fixture.size = 23;
  await request({ method: "open", db: "records.db" });
  await request({ method: "open", db: "catalog.db" });
  const operationalConnections = fixture.sqlite.exec.mock.calls
    .filter(([, sql]) => sql === "PRAGMA foreign_keys = ON;")
    .map(([connection]) => connection);
  expect(operationalConnections).toHaveLength(3);
  expect(new Set(operationalConnections).size).toBe(3);
  expect(fixture.sqlite.close.mock.calls).toContainEqual([operationalConnections[0]]);
  fixture.sqlite.exec.mockImplementationOnce(async () => {
    throw new Error("pragma failed");
  });
  await expect(request({ method: "open", db: "failed.db" })).rejects.toThrow("pragma failed");
  const failedConnection = await fixture.sqlite.open_v2.mock.results.at(-1)!.value;
  expect(fixture.sqlite.close.mock.calls).toContainEqual([failedConnection]);
});
