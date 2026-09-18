import { describe, expect, it } from "vite-plus/test";
import { collectInferenceRun, type InferenceRuntime } from "../kernel/inference-runtime.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "../kernel/environment.ts";
import { Kernel } from "../kernel/kernel.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec } from "../spec/model.ts";
import { createWorkspaceClient } from "./workspace-client.ts";

describe("WorkspaceClient", () => {
  it("retains the bound Actor and checks current authorization on every operation", async () => {
    expect.hasAssertions();
    let allowed = true;
    const actorIds: string[] = [];
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      authorizer: {
        async authorize(request) {
          actorIds.push(request.context.actorId);
          return { allowed };
        },
      },
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    context.actorId = "changed_by_caller";

    await expect(client.listPages()).resolves.toEqual([]);
    allowed = false;
    await expect(client.listPages()).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
    expect(actorIds).toEqual([root.user.id, root.user.id]);
    await kernel.close();
  });

  it("binds interface operations to one validated context without owning the Kernel", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    const spec = createEmptySpec({ id: "spec", key: "space", label: "Space" });
    const next = {
      ...spec,
      collections: [
        {
          id: "collection_notes",
          key: "note",
          label: "Note",
          fields: [{ id: "field_title", key: "title", label: "Title", type: "text" as const }],
        },
      ],
      pages: [{ id: "page_home", key: "home", label: "Home", layout: [] }],
    };

    await client.applySpec(next);
    const record = await client.createRecord("note", { title: "Hello" });

    await expect(client.getWorkspace()).resolves.toMatchObject({ spec: next });
    await expect(client.listRecords("note")).resolves.toEqual([record]);
    await expect(client.getPage("home")).resolves.toMatchObject({ id: "page_home" });

    // The client does not close or otherwise own the shared Kernel.
    await expect(kernel.getWorkspace(context)).resolves.toMatchObject({ id: root.workspace.id });
    await kernel.close();
  });

  it("rejects an invalid context before returning a client", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });

    await expect(
      createWorkspaceClient(kernel, {
        workspaceId: root.workspace.id,
        actorId: "missing_actor",
      }),
    ).rejects.toMatchObject({ code: "RESOURCE.NOT_FOUND" });
    await kernel.close();
  });
  it("executes Actions and short Rules as the bound Actor and rechecks authorization", async () => {
    expect.hasAssertions();
    let allowed = true;
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      authorizer: { authorize: async () => ({ allowed }) },
    });
    try {
      const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
      const client = await createWorkspaceClient(kernel, {
        workspaceId: root.workspace.id,
        actorId: root.user.id,
      });
      const spec = createEmptySpec({ id: "spec", key: "space", label: "Space" });
      await client.applySpec({
        ...spec,
        collections: [
          {
            id: "notes",
            key: "note",
            label: "Note",
            fields: [{ id: "title", key: "title", label: "Title", type: "text" }],
          },
        ],
        rules: [
          {
            id: "count",
            key: "count",
            label: "Count",
            steps: [
              {
                id: "list",
                action: { key: "records.list", input: { sourceId: "notes" }, as: "notes" },
              },
            ],
          },
        ],
      });
      const created = await client.executeAction("records.create", {
        sourceId: "notes",
        values: { title: "Hello" },
      });
      expect(created).toMatchObject({ sourceId: "notes", createdBy: root.user.id });
      expect((await client.runRule("count")).vars.notes).toHaveLength(1);
      allowed = false;
      await expect(
        client.executeAction("records.create", { sourceId: "notes", values: { title: "Blocked" } }),
      ).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
      await expect(client.runRule("count")).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
    } finally {
      await kernel.close();
    }
  });

  it("streams inference through the bound Actor context", async () => {
    const runtime: InferenceRuntime = {
      async *run(context) {
        yield { type: "completed", output: { actorId: context.actor.id } };
      },
    };
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: defineEnvironmentProfile({
        ...LOCAL_BROWSER_ENVIRONMENT,
        inference: true,
      }),
      inference: runtime,
    });
    try {
      const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
      const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
      const client = await createWorkspaceClient(kernel, owner);

      await expect(client.listInferenceTools()).resolves.toEqual(expect.any(Array));
      const events = await client.runInference({ messages: [{ role: "user", content: "Hello" }] });
      await expect(collectInferenceRun(events)).resolves.toEqual({ actorId: root.user.id });
    } finally {
      await kernel.close();
    }
  });

  it("manages Agent and model configuration through the bound client", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    try {
      const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
      const client = await createWorkspaceClient(kernel, {
        workspaceId: root.workspace.id,
        actorId: root.user.id,
      });
      const created = await client.createAgent({
        name: "Planner",
        instructions: "Plan work.",
        provider: "example",
        model: "model-1",
      });
      const alternate = await client.createModelConfig({
        name: "Alternate",
        provider: "example",
        model: "model-2",
      });

      await expect(client.listAgents()).resolves.toEqual([created.actor]);
      await expect(client.getModelConfig(alternate.id)).resolves.toEqual(alternate);
      await expect(
        client.configureAgent(created.actor.id, {
          modelConfigId: alternate.id,
          instructions: "Plan carefully.",
          tools: { search: false },
        }),
      ).resolves.toMatchObject({
        actorId: created.actor.id,
        modelConfigId: alternate.id,
        instructions: "Plan carefully.",
      });
      await expect(client.deleteModelConfig(created.model.id)).resolves.toBeUndefined();
    } finally {
      await kernel.close();
    }
  });
});
