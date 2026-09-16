import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { Kernel } from "../kernel/kernel.ts";
import type { ViewQueryResult } from "../kernel/views.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { BlockInput, BlockModule } from "./model.ts";
import { BlockRegistry } from "./registry.ts";

type Renderer = (input: BlockInput) => string;

describe("Block registry", () => {
  it("keeps renderers lazy, caches successful modules, and retries failed loads", async () => {
    expect.hasAssertions();
    let loads = 0;
    const registry = new BlockRegistry<Renderer>([
      {
        definition: { key: "table", label: "Table", category: "data" },
        async load(): Promise<BlockModule<Renderer>> {
          loads += 1;
          return { default: ({ data }) => `table:${data.total}` };
        },
      },
    ]);

    expect(registry.list()).toEqual([{ key: "table", label: "Table", category: "data" }]);
    expect(loads).toBe(0);
    expect((await registry.load("table")).default).toBe((await registry.load("table")).default);
    expect(loads).toBe(1);
    await expect(registry.load("missing")).rejects.toMatchObject({
      code: ERROR_CODES.resourceNotFound,
    });
    let attempts = 0;
    registry.register({
      definition: { key: "flaky", label: "Flaky", category: "test" },
      async load() {
        attempts += 1;
        if (attempts === 1) throw new Error("Chunk unavailable");
        return { default: ({ data }) => `recovered:${data.total}` };
      },
    });
    await expect(registry.load("flaky")).rejects.toThrow("Chunk unavailable");
    expect(typeof (await registry.load("flaky")).default).toBe("function");
    expect(attempts).toBe(2);
  });

  it("renders Table and Kanban Views over the same attached Collection", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace: space, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const origin = { workspaceId: space.id, actorId: user.id };
    const { workspace: app } = await kernel.createWorkspace(origin, { name: "Delivery" });
    const target = { ...origin, workspaceId: app.id };
    await kernel.applySpec(origin, {
      ...space.spec,
      collections: [
        {
          id: "collection-project",
          key: "project",
          label: "Project",
          fields: [
            { id: "field-name", key: "name", label: "Name", type: "text" },
            { id: "field-stage", key: "stage", label: "Stage", type: "text" },
          ],
        },
      ],
    });
    await kernel.applySpec(target, {
      ...app.spec,
      sources: [{ id: "source-projects", key: "shared_projects", label: "Shared projects" }],
      views: [
        {
          id: "view-project-table",
          key: "project_table",
          label: "Project table",
          source: "shared_projects",
          presentation: { block: "table" },
        },
        {
          id: "view-project-board",
          key: "project_board",
          label: "Project board",
          source: "shared_projects",
          presentation: { block: "kanban", config: { groupBy: "stage" } },
        },
      ],
    });
    await kernel.createAttachment(origin, {
      collectionKey: "project",
      targetId: app.id,
      key: "shared_projects",
    });
    await kernel.createRecord(origin, "project", { name: "Launch", stage: "active" });
    const registry = renderers();

    const table = await renderView(registry, await kernel.queryView(target, "project_table"));
    const kanban = await renderView(registry, await kernel.queryView(target, "project_board"));
    expect(table).toBe("table:Launch");
    expect(kanban).toBe("kanban:active:1");
    expect((await kernel.getSource(target, "shared_projects"))?.capabilities.suggestions).toBe(
      false,
    );
    await kernel.close();
  });
});

function renderers(): BlockRegistry<Renderer> {
  return new BlockRegistry([
    {
      definition: { key: "table", label: "Table", category: "data" },
      load: async () => ({
        default: ({ data }) => `table:${textValue(data.rows[0]?.values.name)}`,
      }),
    },
    {
      definition: { key: "kanban", label: "Kanban", category: "data" },
      load: async () => ({
        default: ({ data }) => `kanban:${textValue(data.rows[0]?.values.stage)}:${data.total}`,
      }),
    },
  ]);
}

async function renderView(
  registry: BlockRegistry<Renderer>,
  result: ViewQueryResult,
): Promise<string> {
  if (!result.presentation) throw new Error("Fixture View has no presentation.");
  const module = await registry.load(result.presentation.block);
  return module.default({
    data: result.data,
    ...(result.presentation.config === undefined ? {} : { config: result.presentation.config }),
  });
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
