import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import { Kernel } from "./kernel.ts";

describe("View service", () => {
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
