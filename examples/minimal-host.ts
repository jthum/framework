import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { SPEC_VERSION, type Spec } from "@jthum/framework/spec";

export const exampleSpec: Spec = {
  version: SPEC_VERSION,
  id: "01J0000000000001",
  key: "task_tracker",
  label: "Task tracker",
  collections: [
    {
      id: "01J0000000000002",
      key: "task",
      label: "Task",
      collectionLabel: "Tasks",
      titleFieldId: "01J0000000000003",
      fields: [
        {
          id: "01J0000000000003",
          key: "title",
          label: "Title",
          type: "text",
          required: true,
        },
        {
          id: "01J0000000000004",
          key: "done",
          label: "Done",
          type: "boolean",
          default: false,
        },
      ],
    },
  ],
  sources: [],
  views: [
    {
      id: "01J0000000000005",
      key: "open_tasks",
      label: "Open tasks",
      source: "task",
      query: {
        filter: {
          path: ["01J0000000000004"],
          operator: "eq",
          value: false,
        },
      },
      presentation: { block: "table" },
    },
  ],
  forms: [],
  pages: [],
  rules: [],
};

export async function openMinimalHost() {
  const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
  const { workspace, user } = await kernel.createRootWorkspace({
    name: "Example workspace",
    user: { name: "Owner" },
  });
  const client = await createWorkspaceClient(kernel, {
    workspaceId: workspace.id,
    actorId: user.id,
  });

  await client.applySpec(exampleSpec);

  return { kernel, client, workspace, user };
}
