# Getting started

This guide builds the smallest useful host: an in-memory Kernel, one Workspace, one Collection,
one View, and a context-bound client. The complete executable version is
[`examples/minimal-host.ts`](../examples/minimal-host.ts).

## Install

During local development, point the host at a checkout:

```json
{
  "dependencies": {
    "@jthum/framework": "link:../framework"
  }
}
```

A Git dependency can be used when the package is built or prepared by the consuming toolchain.
Framework is currently private and pre-release; there is no registry release contract yet.

## Open a Kernel

```ts
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";

const kernel = await Kernel.open({
  persistence: new MemoryPersistenceAdapter(),
});

const { workspace, user } = await kernel.createRootWorkspace({
  name: "Example workspace",
  user: { name: "Owner" },
});

const client = await createWorkspaceClient(kernel, {
  workspaceId: workspace.id,
  actorId: user.id,
});
```

`Kernel` owns runtime orchestration. The adapter owns physical persistence. `WorkspaceClient`
binds interface operations to one validated Workspace and Actor while rechecking authorization on
every call.

## Apply a portable Spec

```ts
import { SPEC_VERSION, type Spec } from "@jthum/framework/spec";

const spec: Spec = {
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

await client.applySpec(spec);
```

IDs are opaque stable identities. Keys are readable semantic handles. A key may be renamed without
changing the ID; references inside the Spec use stable IDs where rename safety matters.

## Work through the client

```ts
await client.createRecord("task", { title: "Read the Framework guide" });
const result = await client.queryView("open_tasks");

console.log(result.data.rows);
```

Use the context-bound client from UI components and transport handlers, including its focused
Workspace, Actor, Membership, Attachment, and scope-management interfaces. Use the Kernel directly
only at trusted composition boundaries and for host extensions that do not belong in a public
client contract.

Always close the Kernel when its owning process or request scope ends:

```ts
await kernel.close();
```

## Choose the next layer

- Persist locally or on a server: implement `PersistenceAdapter`, or use the SQLite adapter.
- Build an interface: use the granular Svelte entry points or write a custom UI against
  `WorkspaceClient`.
- Add domain behavior: register Actions and Conditions, then reference them from Rules.
- Share selected data: declare a Source binding and create an instance Attachment.
- Distribute optional resources: expose host-selected Catalog sources.
- Add application-specific Spec: use a host-owned document envelope described in
  [Extensions](extensions.md).

The host owns authentication, routing, navigation, transport, deployment, and product policy.
