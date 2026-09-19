import { describe, expect, it } from "vite-plus/test";
import type { CollectionDefinition } from "../spec/model.ts";
import type { CollectionRecord } from "../persistence/records.ts";
import { openNodeSqlite } from "./node.ts";
import { SqliteRecordStore } from "./records.ts";
import { compileFilter } from "./record-query.ts";

const column = (id: string) => `_field_${Buffer.from(id).toString("hex")}`;

describe("SQLite native record fields", () => {
  it("stores scalars natively and structured fields as JSON without changing logical records", async () => {
    const db = openNodeSqlite();
    const store = new SqliteRecordStore(db);
    await store.initialize();
    const collection: CollectionDefinition = {
      id: "sample",
      key: "sample",
      label: "Sample",
      fields: [
        { id: "title", key: "title", label: "Title", type: "text" },
        {
          id: "amount",
          key: "amount",
          label: "Amount",
          type: "number",
          format: "currency",
          currency: "USD",
        },
        {
          id: "count",
          key: "count",
          label: "Count",
          type: "number",
          validation: { integer: true },
        },
        { id: "active", key: "active", label: "Active", type: "boolean" },
        { id: "day", key: "day", label: "Day", type: "date" },
        { id: "instant", key: "instant", label: "Instant", type: "datetime" },
        {
          id: "status",
          key: "status",
          label: "Status",
          type: "choice",
          options: [{ id: "open", key: "open", label: "Open" }],
        },
        { id: "owner", key: "owner", label: "Owner", type: "reference", sourceId: "other" },
        {
          id: "labels",
          key: "labels",
          label: "Labels",
          type: "choice",
          multiple: true,
          options: [],
        },
        { id: "data", key: "data", label: "Data", type: "json" },
        { id: "unset", key: "unset", label: "Unset", type: "text" },
        { id: "nil", key: "nil", label: "Nil", type: "text" },
      ],
    };
    await store.applySchema("ws", [collection]);
    const record: CollectionRecord = {
      id: "one",
      collectionId: collection.id,
      values: {
        title: "Acme",
        amount: 12.5,
        count: 7,
        active: true,
        day: "2026-09-19",
        instant: "2026-09-19T10:30:00+05:30",
        status: "open",
        owner: "person-1",
        labels: ["a", "b"],
        data: { x: [1, 2] },
        nil: null,
      },
      createdAt: "2026-09-19T00:00:00Z",
      updatedAt: "2026-09-19T00:00:00Z",
      createdBy: "actor",
      updatedBy: "actor",
    };
    await store.create("ws", collection, record);
    const table = await store.tableFor("ws", collection.id);
    const row = await db.get<Record<string, string | number | null>>(
      `SELECT * FROM "${table}" WHERE "_id" = ?`,
      ["one"],
    );
    expect(row).toMatchObject({
      [column("title")]: "Acme",
      [column("amount")]: 12.5,
      [column("count")]: 7,
      [column("active")]: 1,
      [column("day")]: "2026-09-19",
      [column("instant")]: "2026-09-19T05:00:00.000Z",
      [column("status")]: "open",
      [column("owner")]: "person-1",
      [column("labels")]: '["a","b"]',
      [column("data")]: '{"x":[1,2]}',
      [column("unset")]: null,
      [column("nil")]: null,
    });
    const types = await db.get<Record<string, string>>(
      `SELECT typeof("${column("title")}") AS title, typeof("${column("amount")}") AS amount, typeof("${column("count")}") AS count, typeof("${column("active")}") AS active FROM "${table}"`,
    );
    expect(types).toEqual({ title: "text", amount: "real", count: "integer", active: "integer" });
    expect((await store.get("ws", collection, "one"))?.values).toEqual({
      ...record.values,
      instant: "2026-09-19T05:00:00.000Z",
    });
    const schema = await db.all<{ name: string; type: string }>(`PRAGMA table_info("${table}")`);
    expect(schema.find((item) => item.name === column("amount"))?.type).toBe("REAL");
    expect(schema.find((item) => item.name === column("count"))?.type).toBe("INTEGER");
    const parameters: Array<string | number | null | Uint8Array> = [];
    const filter = compileFilter(
      { path: ["title"], operator: "eq", value: "Acme" },
      collection,
      parameters,
    );
    expect(filter).toContain(`"${column("title")}" = ?`);
    expect(filter).not.toContain("json_");
    const indexes = await db.all<{ name: string }>(`PRAGMA index_list("${table}")`);
    expect(indexes.map((item) => item.name).sort()).toEqual(
      [`${table}_created`, `sqlite_autoindex_${table}_1`].sort(),
    );
    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT * FROM "${table}" WHERE ${filter}`,
      parameters,
    );
    expect(plan.some((item) => item.detail.includes("SCAN"))).toBe(true);
    expect(
      (
        await store.query("ws", collection, {
          filter: { path: ["active"], operator: "eq", value: true },
          sort: [{ path: ["instant"], direction: "asc" }],
        })
      ).rows[0]?.values.active,
    ).toBe(true);
    expect(
      (
        await store.query("ws", collection, {
          filter: { path: ["instant"], operator: "gte", value: "2026-09-19T05:00:00Z" },
        })
      ).total,
    ).toBe(1);
    expect(
      (
        await store.query("ws", collection, {
          filter: { path: ["amount"], operator: "contains", value: "12" },
        })
      ).total,
    ).toBe(0);
    expect(
      (
        await store.query("ws", collection, {
          aggregate: {
            group: { path: ["status"], as: "status" },
            measures: [{ as: "amount", operation: "sum", path: ["amount"] }],
          },
        })
      ).rows[0]?.values,
    ).toEqual({ status: "open", amount: 12.5 });
    await db.close();
  });

  it("rebuilds a live table when a field changes native storage kind", async () => {
    const db = openNodeSqlite();
    const store = new SqliteRecordStore(db);
    await store.initialize();
    const previous: CollectionDefinition = {
      id: "metrics",
      key: "metrics",
      label: "Metrics",
      fields: [{ id: "value", key: "value", label: "Value", type: "number" }],
    };
    const next: CollectionDefinition = {
      ...previous,
      fields: [
        {
          id: "value",
          key: "value",
          label: "Value",
          type: "number",
          validation: { integer: true },
        },
      ],
    };
    await store.applySchema("ws", [previous]);
    await store.create("ws", previous, {
      id: "one",
      collectionId: previous.id,
      values: { value: 2 },
      createdAt: "now",
      updatedAt: "now",
      createdBy: "actor",
      updatedBy: "actor",
    });
    await store.applySchema("ws", [next]);
    const table = await store.tableFor("ws", next.id);
    expect(
      (
        await db.get<{ kind: string }>(
          `SELECT typeof("${column("value")}") AS kind FROM "${table}"`,
        )
      )?.kind,
    ).toBe("integer");
    expect((await store.get("ws", next, "one"))?.values).toEqual({ value: 2 });
    for (const [id, value] of [
      ["a_negative", -2],
      ["b_unset", undefined],
      ["c_zero", 0],
      ["d_positive", 5],
    ] as const) {
      await store.create("ws", next, {
        id,
        collectionId: next.id,
        values: value === undefined ? {} : { value },
        createdAt: "now",
        updatedAt: "now",
        createdBy: "actor",
        updatedBy: "actor",
      });
    }
    expect(
      (
        await store.query("ws", next, {
          sort: [{ path: ["value"], direction: "asc" }],
        })
      ).rows.map((row) => row.id),
    ).toEqual(["a_negative", "b_unset", "c_zero", "one", "d_positive"]);
    await db.execute(
      `CREATE INDEX "workload_value_sort" ON "${table}" (COALESCE("${column("value")}", 0), "_created_at", "_id")`,
    );
    const sortPlan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT "_id" FROM "${table}" ORDER BY COALESCE("${column("value")}", 0), "_created_at", "_id"`,
    );
    expect(sortPlan.some((item) => item.detail.includes("workload_value_sort"))).toBe(true);
    await db.close();
  });
});
