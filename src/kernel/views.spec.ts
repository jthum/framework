import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import { Kernel } from "./kernel.ts";

describe("View service", () => {
  it("applies declared caller parameters without mutating the stored View", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.applySpec(context, {
      ...workspace.spec,
      collections: [
        {
          id: "collection-project",
          key: "project",
          label: "Project",
          fields: [
            { id: "field-name", key: "name", label: "Name", type: "text" },
            { id: "field-status", key: "status", label: "Status", type: "text" },
          ],
        },
      ],
      views: [
        {
          id: "view-projects",
          key: "projects",
          label: "Projects",
          source: "project",
          parameters: [{ key: "status", label: "Status", path: ["field-status"] }],
          query: { select: [{ path: ["field-name"], as: "name" }] },
        },
      ],
    });
    await kernel.createRecord(context, "project", { name: "Launch", status: "active" });
    await kernel.createRecord(context, "project", { name: "Archive", status: "done" });
    expect(
      (
        await kernel.queryView(context, "projects", { parameters: { status: "active" } })
      ).data.rows.map((row) => row.values),
    ).toEqual([{ name: "Launch" }]);
    expect((await kernel.queryView(context, "projects")).data.rows).toHaveLength(2);
    await expect(
      kernel.queryView(context, "projects", { parameters: { unknown: true } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    expect(await kernel.getView(context, "projects")).toMatchObject({
      query: { select: [{ as: "name" }] },
    });
    await kernel.close();
  });

  it("authorizes View listing and individual reads explicitly", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    let denyViews = false;
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      authorizer: {
        async authorize(request) {
          requests.push(request);
          return { allowed: !(denyViews && request.operation.startsWith("views.")) };
        },
      },
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.applySpec(context, {
      ...workspace.spec,
      collections: [{ id: "collection-project", key: "project", label: "Project", fields: [] }],
      views: [
        {
          id: "view-projects",
          key: "projects",
          label: "Projects",
          source: "project",
        },
      ],
    });
    denyViews = true;

    await expect(kernel.listViews(context)).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    await expect(kernel.queryView(context, "projects")).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    expect(requests.slice(-2)).toEqual([
      expect.objectContaining({
        operation: "views.list",
        resource: { kind: "workspace", id: workspace.id, workspaceId: workspace.id },
      }),
      expect.objectContaining({
        operation: "views.read",
        resource: { kind: "view", id: "view-projects", workspaceId: workspace.id },
      }),
    ]);
    await kernel.close();
  });
});
