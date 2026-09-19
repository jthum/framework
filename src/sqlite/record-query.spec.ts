import { describe, expect, it, vi } from "vite-plus/test";
import { Kernel } from "../kernel/kernel.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { SourceQueryDefinition } from "../spec/model.ts";
import { SqlitePersistenceAdapter } from "./catalog.ts";
import { openNodeSqlite } from "./node.ts";
import { SqliteRecordStore } from "./records.ts";

describe("SQLite Source queries", () => {
  it("resolves selected relationships only after the SQL page is chosen", async () => {
    const kernel = await Kernel.open({
      persistence: new SqlitePersistenceAdapter(() => openNodeSqlite()),
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Related page",
      user: { name: "Owner" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.applySpec(context, {
      ...workspace.spec,
      collections: [
        {
          id: "companies",
          key: "company",
          label: "Company",
          fields: [{ id: "company-name", key: "name", label: "Name", type: "text" }],
        },
        {
          id: "clients",
          key: "client",
          label: "Client",
          fields: [
            { id: "client-name", key: "name", label: "Name", type: "text" },
            { id: "client-status", key: "status", label: "Status", type: "text" },
            { id: "client-tags", key: "tags", label: "Tags", type: "json" },
            {
              id: "client-company",
              key: "company",
              label: "Company",
              type: "reference",
              sourceId: "companies",
            },
          ],
        },
        {
          id: "projects",
          key: "project",
          label: "Project",
          fields: [
            { id: "project-name", key: "name", label: "Name", type: "text" },
            {
              id: "project-client",
              key: "client",
              label: "Client",
              type: "reference",
              sourceId: "clients",
            },
            {
              id: "project-clients",
              key: "clients",
              label: "Clients",
              type: "reference",
              sourceId: "clients",
              multiple: true,
            },
          ],
        },
      ],
    });
    const parent = await kernel.createRecord(context, "company", { name: "North" });
    const client = await kernel.createRecord(context, "client", {
      name: "Acme",
      status: null,
      company: parent.id,
      tags: ["priority"],
    });
    const other = await kernel.createRecord(context, "client", {
      name: "Beta",
      company: parent.id,
      tags: ["new", "partner"],
    });
    await kernel.createRecord(context, "project", {
      name: "First",
      client: client.id,
      clients: [client.id, other.id],
    });
    await kernel.createRecord(context, "project", {
      name: "Second",
      client: client.id,
      clients: [client.id],
    });
    await kernel.createRecord(context, "project", {
      name: "Third",
      client: other.id,
      clients: [other.id],
    });
    const list = vi.spyOn(SqliteRecordStore.prototype, "list").mockImplementation(() => {
      throw new Error("Relationship projection must not load the Collection.");
    });
    try {
      const result = await kernel.querySource(context, "project", {
        select: [
          { path: ["project-name"], as: "project" },
          { path: ["project-client", "client-name"], as: "client" },
        ],
        limit: 1,
      });
      expect(result.total).toBe(3);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.values.client).toBe("Acme");
      const related = await kernel.querySource(context, "project", {
        filter: { path: ["project-client", "client-name"], operator: "contains", value: "e" },
        sort: [{ path: ["project-client", "client-name"], direction: "desc" }],
        select: [
          { path: ["project-name"], as: "project" },
          { path: ["project-client", "client-name"], as: "client" },
        ],
        limit: 2,
      });
      expect(related.total).toBe(3);
      expect(related.rows.map((row) => row.values.client)).toEqual(["Beta", "Acme"]);
      const grouped = await kernel.querySource(context, "project", {
        aggregate: {
          group: {
            path: ["project-client"],
            labelPath: ["project-client", "client-name"],
            as: "client",
          },
          measures: [{ as: "count", operation: "count" }],
          sort: [{ key: "count", direction: "desc" }],
        },
      });
      expect(grouped.rows.map((row) => row.values)).toEqual([
        { client: "Acme", count: 2 },
        { client: "Beta", count: 1 },
      ]);
      const plural = await kernel.querySource(context, "project", {
        filter: { path: ["project-clients", "client-name"], operator: "eq", value: "Beta" },
        sort: [{ path: ["project-name"], direction: "asc" }],
        select: [
          { path: ["project-name"], as: "project" },
          { path: ["project-clients", "client-name"], as: "clients" },
        ],
      });
      expect(plural.rows.map((row) => row.values)).toEqual([
        { project: "First", clients: ["Acme", "Beta"] },
        { project: "Third", clients: ["Beta"] },
      ]);
      const flattened = await kernel.querySource(context, "project", {
        filter: { path: ["project-name"], operator: "eq", value: "First" },
        select: [
          { path: ["project-clients", "client-tags"], as: "tags" },
          {
            path: ["project-clients", "client-company", "company-name"],
            as: "companies",
          },
        ],
      });
      expect(flattened.rows[0]?.values).toEqual({
        tags: ["priority", "new", "partner"],
        companies: ["North", "North"],
      });
      const nested = await kernel.querySource(context, "project", {
        filter: {
          path: ["project-client", "client-company", "company-name"],
          operator: "eq",
          value: "North",
        },
        select: [
          { path: ["project-name"], as: "project" },
          { path: ["project-client", "client-company", "company-name"], as: "company" },
        ],
      });
      expect(nested.total).toBe(3);
      expect(nested.rows.map((row) => row.values.company)).toEqual(["North", "North", "North"]);
      const nullable = await kernel.querySource(context, "project", {
        filter: { path: ["project-client", "client-status"], operator: "eq", value: null },
        select: [{ path: ["project-client", "client-status"], as: "status" }],
      });
      expect(nullable.rows.map((row) => row.values)).toEqual([{ status: null }, { status: null }]);
      const absent = await kernel.querySource(context, "project", {
        filter: { path: ["project-client", "client-status"], operator: "eq" },
      });
      expect(absent.total).toBe(1);
      expect(list).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      await kernel.close();
    }
  });

  it("answers filtered pages without calling the all-rows RecordStore path", async () => {
    const fixture = await sample(new SqlitePersistenceAdapter(() => openNodeSqlite()));
    const list = vi.spyOn(SqliteRecordStore.prototype, "list").mockImplementation(() => {
      throw new Error("A Source query must not materialize the Collection.");
    });
    try {
      await expect(
        fixture.kernel.querySource(fixture.context, "task", {
          filter: { path: ["status"], operator: "eq", value: "open" },
          limit: 1,
        }),
      ).resolves.toMatchObject({ total: 2, rows: [expect.any(Object)] });
      expect(list).not.toHaveBeenCalled();
    } finally {
      list.mockRestore();
      await fixture.kernel.close();
    }
  });

  it("matches the portable evaluator for filtered pages, sorting, selection, and aggregates", async () => {
    const queries: SourceQueryDefinition[] = [
      {
        filter: { path: ["status"], operator: "eq", value: "open" },
        sort: [{ path: ["score"], direction: "desc" }],
        limit: 1,
      },
      {
        filter: { path: ["status"], operator: "eq", value: 42 },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["score"], operator: "eq", value: "5" },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["score"], operator: "neq", value: "5" },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["name"], operator: "contains", value: "a" },
        sort: [{ path: ["name"], direction: "asc" }],
        select: [{ path: ["name"], as: "title" }],
        offset: 1,
        limit: 1,
      },
      {
        filter: { path: ["score"], operator: "gte", value: 3 },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: {
          any: [
            { path: ["status"], operator: "empty" },
            { path: ["status"], operator: "neq", value: "open" },
          ],
        },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { not: { path: ["status"], operator: "eq", value: "open" } },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["status"], operator: "eq", value: null },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["status"], operator: "eq" },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["status"], operator: "neq", value: null },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["tags"], operator: "contains", value: "blue" },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["tags"], operator: "eq", value: "blue" },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        filter: { path: ["tags"], operator: "neq", value: "blue" },
        sort: [{ path: ["name"], direction: "asc" }],
      },
      {
        sort: [
          { path: ["tags"], direction: "asc" },
          { path: ["name"], direction: "asc" },
        ],
      },
      {
        sort: [{ path: ["score"], direction: "asc" }],
      },
      {
        sort: [
          { path: ["status"], direction: "asc" },
          { path: ["name"], direction: "asc" },
        ],
      },
      {
        sort: [
          { path: ["active"], direction: "asc" },
          { path: ["name"], direction: "asc" },
        ],
      },
      {
        aggregate: {
          group: { path: ["status"], as: "status" },
          measures: [
            {
              as: "average_pair",
              operation: "avg",
              paths: [["count"], ["quantity"]],
            },
          ],
          sort: [
            { key: "status", direction: "asc" },
            { key: "average_pair", direction: "asc" },
          ],
        },
      },
      {
        aggregate: {
          group: { path: ["status"], as: "status" },
          measures: [
            { as: "count", operation: "count" },
            { as: "score", operation: "sum", path: ["score"] },
          ],
          sort: [
            { key: "count", direction: "desc" },
            { key: "status", direction: "asc" },
          ],
        },
        limit: 2,
      },
    ];
    const memory = await sample(new MemoryPersistenceAdapter());
    const sqlite = await sample(new SqlitePersistenceAdapter(() => openNodeSqlite()));
    try {
      for (const query of queries) {
        const expected = await memory.kernel.querySource(memory.context, "task", query);
        const actual = await sqlite.kernel.querySource(sqlite.context, "task", query);
        expect(actual.columns).toEqual(expected.columns);
        expect(actual.total, JSON.stringify(query)).toBe(expected.total);
        expect(
          actual.rows.map((row) => row.values),
          JSON.stringify(query),
        ).toEqual(expected.rows.map((row) => row.values));
      }
    } finally {
      await memory.kernel.close();
      await sqlite.kernel.close();
    }
  });
});

async function sample(persistence: MemoryPersistenceAdapter | SqlitePersistenceAdapter) {
  const kernel = await Kernel.open({ persistence });
  const { workspace, user } = await kernel.createRootWorkspace({
    name: "Query sample",
    user: { name: "Owner" },
  });
  const context = { workspaceId: workspace.id, actorId: user.id };
  await kernel.applySpec(context, {
    ...workspace.spec,
    collections: [
      {
        id: "tasks",
        key: "task",
        label: "Task",
        fields: [
          { id: "name", key: "name", label: "Name", type: "text" },
          { id: "status", key: "status", label: "Status", type: "text" },
          { id: "score", key: "score", label: "Score", type: "number" },
          {
            id: "count",
            key: "count",
            label: "Count",
            type: "number",
            validation: { integer: true },
          },
          {
            id: "quantity",
            key: "quantity",
            label: "Quantity",
            type: "number",
            validation: { integer: true },
          },
          { id: "active", key: "active", label: "Active", type: "boolean" },
          { id: "tags", key: "tags", label: "Tags", type: "json" },
        ],
      },
    ],
  });
  await kernel.createRecord(context, "task", {
    name: "Alpha",
    status: "open",
    score: 5,
    count: 5,
    quantity: 6,
    active: true,
    tags: ["blue", "urgent"],
  });
  await kernel.createRecord(context, "task", {
    name: "Beta",
    status: "done",
    score: 3,
    count: 3,
    quantity: 4,
    active: false,
    tags: ["red"],
  });
  await kernel.createRecord(context, "task", {
    name: "Gamma",
    status: "open",
    score: 8,
    count: 7,
    quantity: 8,
    active: true,
    tags: ["blue"],
  });
  await kernel.createRecord(context, "task", {
    name: "Delta",
    score: 1,
    count: 1,
    quantity: 2,
    tags: [],
  });
  await kernel.createRecord(context, "task", {
    name: "Epsilon",
    status: null,
    score: 2,
    count: 9,
    quantity: 10,
    active: false,
  });
  await kernel.createRecord(context, "task", {
    name: "Zeta",
    status: "done",
    score: -2,
    count: 11,
    quantity: 12,
    active: true,
  });
  await kernel.createRecord(context, "task", {
    name: "Eta",
    status: "",
    count: 13,
    quantity: 14,
    tags: [],
  });
  return { kernel, context };
}
