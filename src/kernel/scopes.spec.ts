import { describe, expect, it } from "vite-plus/test";
import { createWorkspaceClient } from "../client/workspace-client.ts";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { Kernel } from "./kernel.ts";
import { emptyScopeConfig } from "./scopes.ts";

describe.each([
  ["Memory", () => new MemoryPersistenceAdapter()],
  [
    "SQLite",
    () => {
      const database = openNodeSqlite();
      return new SqlitePersistenceAdapter(() => database);
    },
  ],
  [
    "SQLite scope databases",
    () => {
      const database = openNodeSqlite();
      return new SqlitePersistenceAdapter(() => database, {
        scopeDatabases: { open: () => openNodeSqlite() },
      });
    },
  ],
  [
    "SQLite Workspace databases",
    () => {
      const database = openNodeSqlite();
      return new SqlitePersistenceAdapter(() => database, {
        workspaceDatabases: { open: () => openNodeSqlite() },
      });
    },
  ],
  [
    "SQLite Workspace and scope databases",
    () => {
      const database = openNodeSqlite();
      return new SqlitePersistenceAdapter(() => database, {
        workspaceDatabases: { open: () => openNodeSqlite() },
        scopeDatabases: { open: () => openNodeSqlite() },
      });
    },
  ],
] as const)("%s module scope", (_name, persistence) => {
  it("composes on-demand local definitions with shared Workspace definitions", async () => {
    const adapter = persistence();
    const kernel = await Kernel.open({ persistence: adapter });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Team",
        user: { name: "Jane" },
      });
      const root = { workspaceId: workspace.id, actorId: user.id };
      const alpha = { ...root, scope: { kind: "topic", id: "alpha" } };
      const beta = { ...root, scope: { kind: "topic", id: "beta" } };
      await kernel.applySpec(root, {
        ...workspace.spec,
        collections: [{ id: "people", key: "people", label: "People", fields: [] }],
      });
      expect(await kernel.getScopeConfig(alpha)).toEqual(emptyScopeConfig());
      await kernel.applyScopeConfig(alpha, localConfig("alpha"));
      await kernel.applyScopeConfig(beta, localConfig("beta"));
      await expect(kernel.applyScopeConfig(beta, localConfig("alpha"))).rejects.toMatchObject({
        code: ERROR_CODES.validationInvalidInput,
      });
      const alphaTask = await kernel.createRecord(alpha, "notes", {});
      const betaTask = await kernel.createRecord(beta, "notes", {});

      expect((await kernel.listSources(root)).map((source) => source.key)).toEqual(["people"]);
      expect((await kernel.listSources(alpha)).map((source) => source.key)).toEqual([
        "people",
        "notes",
      ]);
      expect((await kernel.listViews(alpha)).map((view) => view.key)).toEqual(["notes"]);
      expect((await kernel.listForms(alpha)).map((form) => form.key)).toEqual(["new_note"]);
      expect((await kernel.listPages(alpha)).map((page) => page.key)).toEqual(["notes"]);
      expect((await kernel.queryView(alpha, "notes")).data.rows.map((row) => row.id)).toEqual([
        alphaTask.id,
      ]);
      expect((await kernel.queryView(beta, "notes")).data.rows.map((row) => row.id)).toEqual([
        betaTask.id,
      ]);
      await expect(kernel.querySource(root, "notes")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      const client = await createWorkspaceClient(kernel, alpha);
      expect((await client.queryView("notes")).data.rows.map((row) => row.id)).toEqual([
        alphaTask.id,
      ]);
      expect((await kernel.getWorkspace(root))?.spec.collections.map((item) => item.key)).toEqual([
        "people",
      ]);

      const session = await adapter.open();
      const execution = {
        id: "waiting-alpha",
        context: alpha,
        rule: { id: "wait-rule", key: "wait_rule", label: "Wait", steps: [] },
        revision: 0,
        status: "waiting" as const,
        checkpoint: {},
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-18T00:00:00Z",
      };
      await session.executions.create(execution);
      await expect(kernel.deleteScopeConfig(alpha)).rejects.toMatchObject({
        code: ERROR_CODES.resourceConflict,
      });
      await expect(
        session.executions.update({ ...execution, context: beta, revision: 1 }, 0),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      await session.executions.update({ ...execution, revision: 1, status: "completed" }, 0);

      await kernel.deleteScopeConfig(alpha);
      expect(await kernel.getScopeConfig(alpha)).toEqual(emptyScopeConfig());
      await expect(kernel.querySource(alpha, "notes")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      expect((await kernel.queryView(beta, "notes")).data.rows.map((row) => row.id)).toEqual([
        betaTask.id,
      ]);
    } finally {
      await kernel.close();
    }
  });

  it("carries scope through Events and Rules without granting authority", async () => {
    const seen: unknown[] = [];
    const kernel = await Kernel.open({
      persistence: persistence(),
      actions: [{ key: "topic.mark", run: ({ context }) => void seen.push(context) }],
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Team",
        user: { name: "Jane" },
      });
      const root = { workspaceId: workspace.id, actorId: user.id };
      const scoped = { ...root, scope: { kind: "topic", id: "alpha" } };
      await kernel.applyScopeConfig(scoped, {
        ...emptyScopeConfig(),
        rules: [
          {
            id: "on-post",
            key: "on_post",
            label: "On post",
            trigger: { event: "message.posted" },
            steps: [{ id: "mark", action: { key: "topic.mark" } }],
          },
        ],
      });
      await kernel.dispatchEvent(scoped, { event: "message.posted", payload: { text: "Hello" } });
      expect(seen).toEqual([scoped]);
      await kernel.dispatchEvent(root, { event: "message.posted", payload: { text: "Outside" } });
      expect(seen).toHaveLength(1);

      const reader = await kernel.createActor(root, { name: "Reader", kind: "user" });
      await kernel.addMembership(root, {
        actorId: reader.id,
        workspaceId: workspace.id,
        permissions: ["read"],
      });
      await expect(
        kernel.applyScopeConfig({ ...scoped, actorId: reader.id }, emptyScopeConfig()),
      ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
      await expect(kernel.applyScopeConfig(root, emptyScopeConfig())).rejects.toMatchObject({
        code: ERROR_CODES.validationInvalidInput,
      });
    } finally {
      await kernel.close();
    }
  });
});

function localConfig(suffix: string) {
  const collectionId = `${suffix}-notes`;
  return {
    ...emptyScopeConfig(),
    collections: [{ id: collectionId, key: "notes", label: "Notes", fields: [] }],
    views: [{ id: `${suffix}-view`, key: "notes", label: "Notes", source: "notes", query: {} }],
    forms: [
      {
        id: `${suffix}-form`,
        key: "new_note",
        label: "New note",
        mode: "create" as const,
        collectionId,
        fieldIds: [],
      },
    ],
    pages: [{ id: `${suffix}-page`, key: "notes", label: "Notes", layout: [] }],
  };
}
