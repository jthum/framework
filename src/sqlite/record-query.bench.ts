import { afterAll, beforeAll, bench } from "vite-plus/test";
import type { CollectionDefinition, SourceQueryDefinition } from "../spec/model.ts";
import { openNodeSqlite } from "./node.ts";
import { SqliteRecordStore } from "./records.ts";

/** Opt-in workload sample: `vp test bench src/sqlite/record-query.bench.ts`.
 * Timings are observations, not pass/fail thresholds or performance claims.
 */
const collection: CollectionDefinition = {
  id: "orders",
  key: "orders",
  label: "Orders",
  fields: [
    { id: "status", key: "status", label: "Status", type: "text" },
    { id: "score", key: "score", label: "Score", type: "number" },
    { id: "title", key: "title", label: "Title", type: "text" },
  ],
};

const filter: SourceQueryDefinition = {
  filter: { path: ["status"], operator: "eq", value: "status_42" },
  limit: 50,
};
const sort: SourceQueryDefinition = {
  sort: [{ path: ["score"], direction: "asc" }],
  limit: 50,
};
const aggregate: SourceQueryDefinition = {
  aggregate: {
    group: { path: ["status"], as: "status" },
    measures: [
      { as: "count", operation: "count" },
      { as: "total", operation: "sum", path: ["score"] },
    ],
  },
};

const baseline = openNodeSqlite();
const indexed = openNodeSqlite();
let baseStore: SqliteRecordStore;
let indexedStore: SqliteRecordStore;

beforeAll(async () => {
  baseStore = await seed(baseline, false);
  indexedStore = await seed(indexed, true);
}, 30_000);

afterAll(async () => {
  await baseline.close();
  await indexed.close();
});

bench(
  "selective filter / default indexes",
  async () => {
    await baseStore.query("ws", collection, filter);
  },
  { time: 250, warmupTime: 50 },
);

bench(
  "selective filter / explicit status index",
  async () => {
    await indexedStore.query("ws", collection, filter);
  },
  { time: 250, warmupTime: 50 },
);

bench(
  "nullable numeric sort / default indexes",
  async () => {
    await baseStore.query("ws", collection, sort);
  },
  { time: 250, warmupTime: 50 },
);

bench(
  "group and sum / default indexes",
  async () => {
    await baseStore.query("ws", collection, aggregate);
  },
  { time: 250, warmupTime: 50 },
);

async function seed(
  database: ReturnType<typeof openNodeSqlite>,
  addIndex: boolean,
): Promise<SqliteRecordStore> {
  const store = new SqliteRecordStore(database);
  await store.initialize();
  await store.applySchema("ws", [collection]);
  await database.transaction(async (connection) => {
    for (let index = 0; index < 3_000; index += 1) {
      await store.createWith(connection, "ws", collection, {
        id: String(index).padStart(6, "0"),
        collectionId: collection.id,
        values: {
          status: `status_${index % 100}`,
          ...(index % 11 ? { score: (index % 200) - 100 } : {}),
          title: `Order ${index}`,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: "actor",
        updatedBy: "actor",
      });
    }
  });
  if (addIndex) {
    const table = await store.tableFor("ws", collection.id);
    const field = `_field_${[...new TextEncoder().encode("status")].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    await database.execute(`CREATE INDEX "bench_status" ON "${table}" ("${field}")`);
  }
  return store;
}
