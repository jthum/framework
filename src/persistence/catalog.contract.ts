import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type {
  Actor,
  AgentConfig,
  Attachment,
  Membership,
  ModelConfig,
  Workspace,
} from "../kernel/model.ts";
import type { PersistenceAdapter } from "./catalog.ts";

export function catalogAdapterContract(
  name: string,
  createAdapter: () => PersistenceAdapter,
): void {
  describe(`${name} catalog contract`, () => {
    it("stores and returns detached values", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();

      await catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(fixture.workspace);
        await transaction.insertActor(fixture.actor);
        await transaction.insertMembership(fixture.membership);
      });

      (fixture.workspace.spec as Mutable<Workspace["spec"]>).label = "Changed outside the adapter";
      const firstRead = await catalog.getWorkspace(fixture.workspace.id);
      expect(firstRead?.spec.label).toBe("Acme");

      if (!firstRead) throw new Error("Contract fixture Workspace was not persisted.");
      (firstRead.spec as Mutable<Workspace["spec"]>).label = "Changed after reading";
      expect((await catalog.getWorkspace(fixture.workspace.id))?.spec.label).toBe("Acme");

      await persistence.close();
    });

    it("updates Actor profile fields without changing identity", async () => {
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();
      await catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(fixture.workspace);
        await transaction.insertActor(fixture.actor);
        await transaction.updateActor({
          ...fixture.actor,
          name: "Jane Doe",
          email: "jane@example.com",
          updatedAt: "2026-01-02T00:00:00.000Z",
        });
      });

      await expect(catalog.getActor(fixture.actor.id)).resolves.toMatchObject({
        name: "Jane Doe",
        email: "jane@example.com",
      });
      await expect(
        catalog.transaction((transaction) =>
          transaction.updateActor({ ...fixture.actor, originId: "somewhere-else" }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      await expect(
        catalog.transaction((transaction) =>
          transaction.updateActor({ ...fixture.actor, createdAt: "2026-02-01T00:00:00.000Z" }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      await persistence.close();
    });

    it("persists model and Agent configuration with referential integrity", async () => {
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();
      const agent: Actor = { ...fixture.actor, id: "agent", kind: "agent", name: "Planner" };
      const model: ModelConfig = {
        id: "model-config",
        workspaceId: fixture.workspace.id,
        name: "Planning model",
        provider: "example",
        model: "reasoning-model",
        credentialRef: "secret/model-provider",
        settings: { temperature: 0.2 },
        createdAt: fixture.workspace.createdAt,
        updatedAt: fixture.workspace.updatedAt,
      };
      const config: AgentConfig = {
        actorId: agent.id,
        modelConfigId: model.id,
        instructions: "Plan the team's work.",
        tools: { include: ["action:records.list"], search: true },
        createdAt: fixture.workspace.createdAt,
        updatedAt: fixture.workspace.updatedAt,
      };
      await catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(fixture.workspace);
        await transaction.insertActor(agent);
        await transaction.insertModelConfig(model);
        await transaction.insertAgentConfig(config);
      });

      expect(await catalog.getAgentConfig(agent.id)).toEqual(config);
      expect(await catalog.listModelConfigs(fixture.workspace.id)).toEqual([model]);
      await expect(
        catalog.transaction((transaction) => transaction.deleteModelConfig(model.id)),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      const updated = {
        ...config,
        instructions: "Plan and prioritize the team's work.",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };
      await catalog.transaction((transaction) => transaction.updateAgentConfig(updated));
      expect(await catalog.getAgentConfig(agent.id)).toEqual(updated);
      await persistence.close();
    });

    it("rolls back every write when a transaction fails", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();

      await expect(
        catalog.transaction(async (transaction) => {
          await transaction.insertWorkspace(fixture.workspace);
          throw new Error("Deliberate rollback");
        }),
      ).rejects.toThrow("Deliberate rollback");
      expect(await catalog.listRootWorkspaces()).toEqual([]);

      await persistence.close();
    });

    it("reports duplicate Workspace Memberships consistently", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();

      await catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(fixture.workspace);
        await transaction.insertActor(fixture.actor);
        await transaction.insertMembership(fixture.membership);
      });

      await expect(
        catalog.transaction((transaction) =>
          transaction.insertMembership({ ...fixture.membership, id: "membership-2" }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      expect(await catalog.listMembershipsForActor(fixture.actor.id)).toHaveLength(1);

      await persistence.close();
    });

    it("applies Workspace Spec and record schema as one operation", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const fixture = catalogFixture();
      const collection = {
        id: "collection-task",
        key: "task",
        label: "Task",
        fields: [{ id: "field-title", key: "title", label: "Title", type: "text" as const }],
      };
      const missingWorkspace: Workspace = {
        ...fixture.workspace,
        spec: { ...fixture.workspace.spec, collections: [collection] },
      };

      await expect(persistence.applyWorkspaceSpec(missingWorkspace)).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await expect(persistence.records.list(missingWorkspace.id, collection)).rejects.toMatchObject(
        { code: ERROR_CODES.resourceNotFound },
      );

      await persistence.close();
    });

    it("removes Workspace catalog and record state as one persistence operation", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const { workspace: root, actor, membership } = catalogFixture();
      const collection = {
        id: "collection-task",
        key: "task",
        label: "Task",
        fields: [{ id: "field-title", key: "title", label: "Title", type: "text" as const }],
      };
      const child: Workspace = {
        ...root,
        id: "workspace-app",
        isRoot: false,
        parentId: root.id,
        rootId: root.id,
        name: "App",
        spec: { ...root.spec, id: "spec-app", key: "app", collections: [collection] },
      };
      await persistence.catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(root);
        await transaction.insertActor(actor);
        await transaction.insertMembership(membership);
        await transaction.insertWorkspace(child);
        await transaction.insertMembership({
          ...membership,
          id: "membership-app",
          workspaceId: child.id,
        });
      });
      await persistence.applyWorkspaceSpec(child);
      await persistence.records.create(child.id, collection, {
        id: "record-task",
        collectionId: collection.id,
        values: { title: "Delete me" },
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        createdBy: actor.id,
        updatedBy: actor.id,
      });

      await persistence.deleteWorkspace(child.id);

      expect(await persistence.catalog.getWorkspace(child.id)).toBeNull();
      expect(await persistence.catalog.getMembership(actor.id, child.id)).toBeNull();
      await expect(persistence.records.list(child.id, collection)).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      expect(await persistence.catalog.getWorkspace(root.id)).toEqual(root);
      await persistence.close();
    });

    it("rolls back schema changes and records when the catalog update fails", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const { workspace: root, actor, membership } = catalogFixture();
      const collection = {
        id: "task",
        key: "task",
        label: "Task",
        fields: [{ id: "title", key: "title", label: "Title", type: "text" as const }],
      };
      const workspace: Workspace = { ...root, spec: { ...root.spec, collections: [collection] } };
      await persistence.catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(workspace);
        await transaction.insertActor(actor);
        await transaction.insertMembership(membership);
      });
      await persistence.applyWorkspaceSpec(workspace);
      const record = {
        id: "record",
        collectionId: collection.id,
        values: { title: "Keep me" },
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        createdBy: actor.id,
        updatedBy: actor.id,
      };
      await persistence.records.create(workspace.id, collection, record);
      const renamed = { ...collection, fields: [{ ...collection.fields[0]!, key: "name" }] };
      await expect(
        persistence.applyWorkspaceSpec({
          ...workspace,
          parentId: "invalid-parent",
          spec: { ...workspace.spec, collections: [renamed] },
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      expect(await persistence.catalog.getWorkspace(workspace.id)).toEqual(workspace);
      expect(await persistence.records.get(workspace.id, collection, record.id)).toEqual(record);
      await persistence.close();
    });

    it("seeds a new Collection atomically with its Spec change", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const { workspace, actor, membership } = catalogFixture();
      await persistence.catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(workspace);
        await transaction.insertActor(actor);
        await transaction.insertMembership(membership);
      });
      const collection = {
        id: "collection-snapshot",
        key: "snapshot",
        label: "Snapshot",
        fields: [{ id: "field-title", key: "title", label: "Title", type: "text" as const }],
      };
      const next: Workspace = {
        ...workspace,
        spec: { ...workspace.spec, collections: [collection] },
      };
      const record = {
        id: "record-snapshot",
        collectionId: collection.id,
        values: { title: "Copied" },
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        createdBy: actor.id,
        updatedBy: actor.id,
      };

      await persistence.applyWorkspaceSpec(next, [{ collection, records: [record] }]);

      expect(await persistence.catalog.getWorkspace(workspace.id)).toEqual(next);
      expect(await persistence.records.list(workspace.id, collection)).toEqual([record]);
      await persistence.close();
    });

    it("rolls back a seeded Spec when any initial record fails", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const { workspace, actor, membership } = catalogFixture();
      await persistence.catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(workspace);
        await transaction.insertActor(actor);
        await transaction.insertMembership(membership);
      });
      const collection = {
        id: "collection-snapshot",
        key: "snapshot",
        label: "Snapshot",
        fields: [{ id: "field-title", key: "title", label: "Title", type: "text" as const }],
      };
      const next: Workspace = {
        ...workspace,
        spec: { ...workspace.spec, collections: [collection] },
      };
      const record = {
        id: "duplicate-record",
        collectionId: collection.id,
        values: { title: "Copied" },
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        createdBy: actor.id,
        updatedBy: actor.id,
      };

      await expect(
        persistence.applyWorkspaceSpec(next, [
          { collection, records: [record, { ...record, values: { title: "Conflict" } }] },
        ]),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });

      expect(await persistence.catalog.getWorkspace(workspace.id)).toEqual(workspace);
      await expect(persistence.records.list(workspace.id, collection)).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await persistence.close();
    });

    it("distinguishes issued Actors, members, and root-universe discovery", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const { workspace: root, actor: jane, membership } = catalogFixture();
      const hr: Workspace = { ...root, id: "hr", name: "HR", isRoot: false, parentId: root.id };
      const recruiting: Workspace = {
        ...hr,
        id: "recruiting",
        name: "Recruiting",
        parentId: hr.id,
      };
      const candidate: Actor = {
        ...jane,
        id: "candidate",
        name: "Candidate",
        originId: recruiting.id,
      };
      await catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(root);
        await transaction.insertWorkspace(hr);
        await transaction.insertWorkspace(recruiting);
        await transaction.insertActor(jane);
        await transaction.insertActor(candidate);
        await transaction.insertMembership(membership);
        await transaction.insertMembership({ ...membership, id: "jane-hr", workspaceId: hr.id });
        await transaction.insertMembership({
          ...membership,
          id: "candidate-recruiting",
          actorId: candidate.id,
          workspaceId: recruiting.id,
        });
      });
      expect(await catalog.listRootWorkspaces()).toEqual([root]);
      expect(await catalog.listChildWorkspaces(root.id)).toEqual([hr]);
      expect(await catalog.listChildWorkspaces(hr.id)).toEqual([recruiting]);
      expect(await catalog.listWorkspacesByRoot(root.id)).toHaveLength(3);
      expect(await catalog.listActorsByOrigin(root.id)).toEqual([jane]);
      expect(await catalog.listActorsByOrigin(recruiting.id)).toEqual([candidate]);
      expect(await catalog.listMembers(hr.id)).toEqual([jane]);
      expect(await catalog.listMembers(recruiting.id)).toEqual([candidate]);
      expect(await catalog.listActorsByRoot(root.id)).toHaveLength(2);
      await catalog.transaction(async (transaction) => {
        const current = await transaction.getMembership(candidate.id, recruiting.id);
        if (!current) throw new Error("Expected candidate Membership fixture.");
        await transaction.updateMembership({
          ...current,
          roles: ["reviewer"],
          permissions: ["read", "update"],
          updatedAt: "2026-09-18T00:00:00.000Z",
        });
      });
      expect(await catalog.getMembership(candidate.id, recruiting.id)).toMatchObject({
        roles: ["reviewer"],
        permissions: ["read", "update"],
      });
      const candidateMembership = await catalog.getMembership(candidate.id, recruiting.id);
      await expect(
        catalog.transaction((transaction) =>
          transaction.updateMembership({
            ...candidateMembership!,
            actorId: jane.id,
            workspaceId: hr.id,
          }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      expect(await catalog.getMembership(candidate.id, recruiting.id)).toMatchObject({
        actorId: candidate.id,
        workspaceId: recruiting.id,
      });
      await persistence.close();
    });

    it("detaches and rolls back Attachment data, retaining idempotent revocation", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const { workspace: root, actor } = catalogFixture();
      const collection = {
        id: "jobs",
        key: "job",
        label: "Job",
        fields: [{ id: "status", key: "status", label: "Status", type: "text" as const }],
      };
      const origin = { ...root, spec: { ...root.spec, collections: [collection] } };
      const target = {
        ...root,
        id: "target",
        isRoot: false,
        parentId: root.id,
        spec: {
          ...root.spec,
          sources: [{ id: "source-jobs", key: "jobs", label: "Jobs" }],
        },
      };
      const other = { ...root, id: "other", rootId: "other" };
      const outsider = { ...actor, id: "outsider", originId: other.id, rootId: other.id };
      await persistence.catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(origin);
        await transaction.insertWorkspace(target);
        await transaction.insertWorkspace(other);
        await transaction.insertActor(actor);
        await transaction.insertActor(outsider);
      });
      const attachment: Attachment = {
        id: "attachment",
        sourceId: "source-jobs",
        originId: origin.id,
        targetId: target.id,
        collectionId: collection.id,
        filter: { fieldId: "status", operator: "eq", value: "open" },
        permissions: ["read"],
        allowReshare: false,
        createdBy: actor.id,
        createdAt: root.createdAt,
      };
      await expect(
        persistence.catalog.transaction(async (transaction) => {
          await transaction.insertAttachment(attachment);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await persistence.catalog.getAttachment(attachment.id)).toBeNull();
      await persistence.catalog.transaction((transaction) =>
        transaction.insertAttachment(attachment),
      );
      (attachment.permissions as string[]).push("delete");
      const first = (await persistence.catalog.getAttachment(attachment.id))!;
      expect(first.permissions).toEqual(["read"]);
      (first.permissions as string[]).push("update");
      expect(
        (await persistence.catalog.getAttachmentBySource(target.id, attachment.sourceId))
          ?.permissions,
      ).toEqual(["read"]);
      await expect(
        persistence.catalog.transaction(async (transaction) => {
          await transaction.revokeAttachment(attachment.id, actor.id, root.updatedAt);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(
        await persistence.catalog.getAttachmentBySource(target.id, attachment.sourceId),
      ).not.toBeNull();
      await expect(
        persistence.catalog.transaction((transaction) =>
          transaction.revokeAttachment(attachment.id, outsider.id, root.updatedAt),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      await persistence.catalog.transaction((transaction) =>
        transaction.revokeAttachment(attachment.id, actor.id, root.updatedAt),
      );
      await persistence.catalog.transaction((transaction) =>
        transaction.revokeAttachment(attachment.id, actor.id, "later"),
      );
      expect(
        await persistence.catalog.getAttachmentBySource(target.id, attachment.sourceId),
      ).toBeNull();
      expect(await persistence.catalog.listAttachmentsTo(target.id)).toEqual(
        await persistence.catalog.listAttachmentsFrom(origin.id),
      );
      expect((await persistence.catalog.listAttachmentsTo(target.id))[0]?.revokedAt).toBe(
        root.updatedAt,
      );
      await persistence.close();
    });

    it("rejects inconsistent grouping, issuance, and cross-root Memberships", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const { workspace: root, actor, membership } = catalogFixture();
      const other: Workspace = { ...root, id: "other-root", rootId: "other-root" };
      await catalog.transaction(async (transaction) => {
        await transaction.insertWorkspace(root);
        await transaction.insertWorkspace(other);
        await transaction.insertActor(actor);
      });
      const invalidWorkspaces: Workspace[] = [
        { ...root, id: "invalid-root", parentId: root.id },
        { ...root, id: "invalid-child", isRoot: false },
        { ...root, id: "wrong-root", isRoot: false, parentId: root.id, rootId: other.id },
      ];
      for (const workspace of invalidWorkspaces) {
        await expect(
          catalog.transaction((transaction) => transaction.insertWorkspace(workspace)),
        ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      }
      await expect(
        catalog.transaction((transaction) =>
          transaction.insertActor({ ...actor, id: "wrong-origin", originId: other.id }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      await expect(
        catalog.transaction((transaction) =>
          transaction.insertMembership({ ...membership, workspaceId: other.id }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      await expect(
        catalog.transaction((transaction) =>
          transaction.updateWorkspace({
            ...root,
            isRoot: false,
            parentId: other.id,
            rootId: other.id,
          }),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      expect(await catalog.getWorkspace(root.id)).toEqual(root);
      await persistence.close();
    });
  });
}

type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };

function catalogFixture(): {
  workspace: Workspace;
  actor: Actor;
  membership: Membership;
} {
  const stamp = "2026-09-17T00:00:00.000Z";
  const workspace: Workspace = {
    id: "workspace-1",
    isRoot: true,
    parentId: null,
    rootId: "workspace-1",
    name: "Acme",
    access: { members: ["read", "create", "update", "delete", "manage"], others: [] },
    policy: { spawn: true, createActors: true, reshare: false },
    spec: {
      version: 2,
      id: "spec-1",
      key: "acme",
      label: "Acme",
      collections: [],
      sources: [],
      views: [],
      forms: [],
      pages: [],
      rules: [],
    },
    createdAt: stamp,
    updatedAt: stamp,
  };
  return {
    workspace,
    actor: {
      id: "actor-1",
      originId: workspace.id,
      rootId: workspace.id,
      kind: "user",
      name: "Jane",
      createdAt: stamp,
      updatedAt: stamp,
    },
    membership: {
      id: "membership-1",
      actorId: "actor-1",
      workspaceId: workspace.id,
      roles: ["owner"],
      permissions: ["read", "create", "update", "delete", "manage"],
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}
