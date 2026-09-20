import { describe, expect, it } from "vite-plus/test";
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { createPageActions } from "./page-authoring.js";

describe("Page authoring", () => {
  it("saves and reorders managed Pages while retaining host-owned Pages", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    await client.applySpec({
      ...root.workspace.spec,
      pages: [
        { id: "page-home", key: "home", label: "Home", layout: [] },
        { id: "page-projects", key: "projects", label: "Projects", layout: [] },
      ],
    });
    let changed = 0;
    const actions = createPageActions(client, {
      include: (page) => page.key !== "home",
      onChange: () => void (changed += 1),
    });
    await actions.save({
      id: "replacement-is-ignored",
      key: "projects",
      label: "All projects",
      layout: [{ id: "group-main", kind: "group", children: [] }],
    });
    await actions.save({ id: "page-reports", key: "reports", label: "Reports", layout: [] });
    await actions.replace([
      { id: "page-reports", key: "reports", label: "Reports", layout: [] },
      {
        id: "page-projects",
        key: "projects",
        label: "All projects",
        layout: [{ id: "group-main", kind: "group", children: [] }],
      },
    ]);
    expect((await client.getWorkspace()).spec.pages.map((page) => page.key)).toEqual([
      "home",
      "reports",
      "projects",
    ]);
    await actions.remove("reports");
    expect((await client.getWorkspace()).spec.pages.map((page) => page.key)).toEqual([
      "home",
      "projects",
    ]);
    expect(changed).toBe(4);
    await kernel.close();
  });
});
