import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { Spec } from "../spec/model.ts";
import type { AuthorizationRequest, Authorizer } from "./authorization.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { Kernel } from "./kernel.ts";

describe("Kernel Collections and records", () => {
  it("applies a Spec and performs validated record CRUD", async () => {
    expect.hasAssertions();
    const { kernel, context } = await bootstrap();
    await kernel.applySpec(context, projectSpec());
    const client = await kernel.createRecord(context, "client", { name: "Acme" });
    const project = await kernel.createRecord(context, "project", {
      name: "Website",
      client: client.id,
    });

    expect(project).toMatchObject({
      collectionId: "collection-project",
      values: { name: "Website", status: "draft", client: client.id },
      createdBy: context.actorId,
    });
    expect(await kernel.getRecord(context, "project", project.id)).toEqual(project);
    expect(await kernel.listRecords(context, "project")).toEqual([project]);

    const active = await kernel.updateRecord(context, "project", project.id, {
      status: "active",
    });
    expect(active.values.status).toBe("active");
    await kernel.deleteRecord(context, "project", project.id);
    expect(await kernel.getRecord(context, "project", project.id)).toBeNull();
  });

  it("rejects invalid values, missing references, and lifecycle jumps", async () => {
    expect.hasAssertions();
    const { kernel, context } = await bootstrap();
    await kernel.applySpec(context, projectSpec());

    await expect(
      kernel.createRecord(context, "project", { name: "A", client: "missing" }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    const project = await kernel.createRecord(context, "project", { name: "Valid project" });
    await expect(
      kernel.updateRecord(context, "project", project.id, { status: "done" }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.validationInvalidInput,
      issues: [expect.objectContaining({ code: "VALIDATION.LIFECYCLE_TRANSITION" })],
    });
  });

  it("preserves data when semantic Collection and Field keys change", async () => {
    expect.hasAssertions();
    const { kernel, context } = await bootstrap();
    const spec = projectSpec();
    await kernel.applySpec(context, spec);
    const project = await kernel.createRecord(context, "project", { name: "Keep me" });
    const renamed: Spec = {
      ...spec,
      collections: spec.collections.map((collection) =>
        collection.id === "collection-project"
          ? {
              ...collection,
              key: "work_item",
              fields: collection.fields.map((field) =>
                field.id === "field-project-name" ? { ...field, key: "summary" } : field,
              ),
            }
          : collection,
      ),
    };

    await kernel.applySpec(context, renamed);

    expect(await kernel.getRecord(context, "work_item", project.id)).toMatchObject({
      values: { summary: "Keep me", status: "draft" },
    });
  });

  it("rejects incompatible schema changes and backfills explicit defaults", async () => {
    expect.hasAssertions();
    const { kernel, context } = await bootstrap();
    const spec = projectSpec();
    await kernel.applySpec(context, spec);
    const project = await kernel.createRecord(context, "project", { name: "Existing" });
    const projectCollection = spec.collections.find(
      (collection) => collection.id === "collection-project",
    )!;
    const incompatible: Spec = {
      ...spec,
      collections: spec.collections.map((collection) =>
        collection.id === projectCollection.id
          ? {
              ...collection,
              fields: [
                ...collection.fields,
                {
                  id: "field-project-score",
                  key: "score",
                  label: "Score",
                  type: "number" as const,
                  required: true,
                },
              ],
            }
          : collection,
      ),
    };

    await expect(kernel.applySpec(context, incompatible)).rejects.toMatchObject({
      code: ERROR_CODES.validationInvalidInput,
      issues: [expect.objectContaining({ path: "values.score", code: "VALIDATION.REQUIRED" })],
    });
    expect((await kernel.getRecord(context, "project", project.id))?.values).not.toHaveProperty(
      "score",
    );

    const compatible: Spec = {
      ...incompatible,
      collections: incompatible.collections.map((collection) =>
        collection.id === projectCollection.id
          ? {
              ...collection,
              fields: collection.fields.map((field) =>
                field.id === "field-project-score" ? { ...field, default: 0 } : field,
              ),
            }
          : collection,
      ),
    };
    await kernel.applySpec(context, compatible);
    expect(await kernel.getRecord(context, "project", project.id)).toMatchObject({
      values: { name: "Existing", status: "draft", score: 0 },
    });
  });

  it("keeps records isolated between Workspaces using the same portable Spec", async () => {
    expect.hasAssertions();
    const { kernel, context } = await bootstrap();
    const { workspace } = await kernel.createWorkspace(context, { name: "Second" });
    const secondContext = { ...context, workspaceId: workspace.id };
    await kernel.applySpec(context, projectSpec());
    await kernel.applySpec(secondContext, projectSpec());
    await kernel.createRecord(context, "client", { name: "Only first" });

    expect(await kernel.listRecords(context, "client")).toHaveLength(1);
    expect(await kernel.listRecords(secondContext, "client")).toEqual([]);
  });

  it("authorizes Spec and record operations with stable resource identities", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    const authorizer: Authorizer = {
      async authorize(request) {
        requests.push(request);
        return { allowed: true };
      },
    };
    const { kernel, context } = await bootstrap(authorizer);
    await kernel.applySpec(context, projectSpec());
    const record = await kernel.createRecord(context, "client", { name: "Acme" });
    await kernel.getRecord(context, "client", record.id);

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "spec.update",
          resource: expect.objectContaining({ kind: "workspace" }),
        }),
        expect.objectContaining({
          operation: "records.create",
          resource: expect.objectContaining({
            kind: "collection",
            id: "collection-client",
          }),
        }),
        expect.objectContaining({
          operation: "records.read",
          resource: expect.objectContaining({
            kind: "record",
            id: record.id,
            collectionId: "collection-client",
          }),
        }),
      ]),
    );
  });
});

async function bootstrap(authorizer?: Authorizer): Promise<{
  kernel: Kernel;
  context: { workspaceId: string; actorId: string };
}> {
  const kernel = await Kernel.open({
    persistence: new MemoryPersistenceAdapter(),
    ids: sequenceIds(),
    clock: fixedClock,
    ...(authorizer ? { authorizer } : {}),
  });
  const { workspace, user } = await kernel.createRootWorkspace({
    name: "Acme",
    user: { name: "Jane" },
  });
  return {
    kernel,
    context: {
      workspaceId: workspace.id,
      actorId: user.id,
    },
  };
}

function projectSpec(): Spec {
  return {
    version: 2,
    id: "spec-projects",
    key: "projects",
    label: "Projects",
    collections: [
      {
        id: "collection-client",
        key: "client",
        label: "Client",
        fields: [
          {
            id: "field-client-name",
            key: "name",
            label: "Name",
            type: "text",
            required: true,
            validation: { minLength: 2 },
          },
        ],
      },
      {
        id: "collection-project",
        key: "project",
        label: "Project",
        fields: [
          {
            id: "field-project-name",
            key: "name",
            label: "Name",
            type: "text",
            required: true,
            validation: { minLength: 2 },
          },
          {
            id: "field-project-status",
            key: "status",
            label: "Status",
            type: "choice",
            options: [
              { id: "choice-project-draft", key: "draft", label: "Draft" },
              { id: "choice-project-active", key: "active", label: "Active" },
              { id: "choice-project-done", key: "done", label: "Done" },
            ],
          },
          {
            id: "field-project-client",
            key: "client",
            label: "Client",
            type: "reference",
            collectionId: "collection-client",
          },
        ],
        lifecycle: {
          fieldId: "field-project-status",
          initial: "draft",
          terminal: ["done"],
          transitions: [
            {
              id: "transition-project-activate",
              key: "activate",
              label: "Activate",
              from: ["draft"],
              to: "active",
            },
            {
              id: "transition-project-complete",
              key: "complete",
              label: "Complete",
              from: ["active"],
              to: "done",
            },
          ],
        },
      },
    ],
    sources: [],
    views: [],
    forms: [],
    pages: [],
    rules: [],
  };
}

const fixedClock: Clock = {
  now: () => "2026-09-17T00:00:00.000Z",
};

function sequenceIds(): IdGenerator {
  let next = 0;
  return {
    create(kind: IdKind) {
      next += 1;
      return `${kind}-${next}`;
    },
  };
}
