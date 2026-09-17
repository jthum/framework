import { describe, expect, it } from "vite-plus/test";
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { createFormActions } from "./form-authoring.js";

describe("Form authoring", () => {
  it("authors record and standalone Forms without replacing stable identities", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    const project = {
      id: "collection-project",
      key: "project",
      label: "Project",
      fields: [
        { id: "field-title", key: "title", label: "Title", type: "text" as const },
        { id: "field-budget", key: "budget", label: "Budget", type: "number" as const },
      ],
    };
    await client.applySpec({ ...root.workspace.spec, collections: [project] });
    let changed = 0;
    const sources = [
      {
        id: project.id,
        key: project.key,
        label: project.label,
        fields: project.fields.map((field) => ({ ...field })),
      },
    ];
    const actions = createFormActions(client, {
      sources,
      onChange: () => void (changed += 1),
    });

    await actions.save({
      id: "form-project",
      key: "project_form",
      label: "Project form",
      mode: "create",
      type: "project",
      fields: ["title"],
    });
    await actions.save({
      id: "ignored-replacement",
      key: "project_form",
      label: "Edit project",
      mode: "edit",
      type: "project",
      fields: ["budget", "title"],
    });
    expect((await client.getWorkspace()).spec.forms[0]).toMatchObject({
      id: "form-project",
      mode: "edit",
      collectionId: "collection-project",
      fieldIds: ["field-budget", "field-title"],
    });

    const email = actions.prepareField("email", {
      label: "Email",
      type: "text",
      format: "email",
      required: true,
    });
    await actions.save({
      id: "form-contact",
      key: "contact_us",
      label: "Contact us",
      mode: "standalone",
      inputs: [email],
    });
    const standalone = (await client.getWorkspace()).spec.forms[1];
    expect(standalone).toMatchObject({
      id: "form-contact",
      mode: "standalone",
      fields: [{ id: email.id, key: "email", format: "email", required: true }],
    });
    await actions.remove("contact_us");
    expect((await client.getWorkspace()).spec.forms).toHaveLength(1);
    expect(changed).toBe(4);
    await kernel.close();
  });
});
