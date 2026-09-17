import { describe, expect, it } from "vite-plus/test";
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
});
