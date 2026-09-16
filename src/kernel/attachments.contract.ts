import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { PersistenceAdapter } from "../persistence/catalog.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type { AuthorizationRequest, Authorizer } from "./authorization.ts";
import { Kernel } from "./kernel.ts";

export function attachmentContract(name: string, createAdapter: () => PersistenceAdapter): void {
  describe(`${name} live Attachments`, () => {
    it("does not return records when an Attachment is revoked during a read", async () => {
      expect.hasAssertions();
      let revokeDuringRead: (() => Promise<void>) | undefined;
      const authorizer: Authorizer = {
        async authorize(request) {
          if (
            request.operation === "records.list" &&
            request.resource.attachmentId &&
            revokeDuringRead
          ) {
            const revoke = revokeDuringRead;
            revokeDuringRead = undefined;
            await revoke();
          }
          return { allowed: true };
        },
      };
      const { kernel, origin, target, collection } = await setup(createAdapter(), authorizer);
      const attachment = await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
      });
      await kernel.createRecord(origin, collection.key, { title: "Engineer", status: "open" });
      revokeDuringRead = () => kernel.revokeAttachment(origin, attachment.id);
      await expect(kernel.listAttachedRecords(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await kernel.close();
    });
    it("shares live records once through portable semantic bindings", async () => {
      expect.hasAssertions();
      const fixture = await setup(createAdapter(), undefined, true);
      const { kernel, origin, target, secondTarget, collection } = fixture;
      const attachment = await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
      });
      await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: secondTarget.workspaceId,
        key: "shared_jobs",
      });
      const record = await kernel.createRecord(origin, collection.key, {
        title: "Engineer",
        status: "open",
      });
      expect(attachment).toMatchObject({
        rights: ["read"],
        allowReshare: false,
        createdBy: origin.actorId,
      });
      expect(await kernel.listAttachedRecords(target, "shared_jobs")).toEqual([record]);
      expect(await kernel.getAttachedRecord(secondTarget, "shared_jobs", record.id)).toEqual(
        record,
      );
      expect(await kernel.getAttachedSchema(target, "shared_jobs")).toEqual(collection);
      const changed = await kernel.updateRecord(origin, collection.key, record.id, {
        title: "Senior Engineer",
      });
      expect(await kernel.getAttachedRecord(target, "shared_jobs", record.id)).toEqual(changed);
      expect(await kernel.listRecords(origin, collection.key)).toHaveLength(1);
      const targetWorkspace = await kernel.getWorkspace(target);
      expect(targetWorkspace?.spec.collections).toEqual([]);
      expect(targetWorkspace?.spec.sources).toEqual([
        { id: "source-jobs", key: "shared_jobs", label: "Shared jobs" },
      ]);
      expect(JSON.stringify(targetWorkspace?.spec)).not.toContain(attachment.id);
      expect(JSON.stringify(targetWorkspace?.spec)).not.toContain(origin.workspaceId);
      await kernel.deleteRecord(origin, collection.key, record.id);
      expect(await kernel.listAttachedRecords(target, "shared_jobs")).toEqual([]);
      await kernel.close();
    });

    it("filters list and individual reads without granting origin Membership", async () => {
      expect.hasAssertions();
      const { kernel, origin, target, candidate, collection } = await setup(createAdapter());
      await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
        filter: {
          all: [
            { fieldId: "status", operator: "eq", value: "open" },
            { not: { fieldId: "title", operator: "empty" } },
          ],
        },
      });
      const open = await kernel.createRecord(origin, collection.key, {
        title: "Engineer",
        status: "open",
      });
      const closed = await kernel.createRecord(origin, collection.key, {
        title: "Designer",
        status: "closed",
      });
      expect(await kernel.listAttachedRecords(candidate, "shared_jobs")).toEqual([open]);
      expect(await kernel.getAttachedRecord(candidate, "shared_jobs", closed.id)).toBeNull();
      expect(await kernel.getAttachedRecord(candidate, "shared_jobs", "missing")).toBeNull();
      await expect(
        kernel.listRecords({ ...candidate, workspaceId: origin.workspaceId }, collection.key),
      ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
      await expect(
        kernel.createAttachment(candidate, {
          collectionKey: "shared_jobs",
          targetId: origin.workspaceId,
          key: "reshared",
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceNotFound });
      await kernel.updateRecord(origin, collection.key, open.id, { status: "closed" });
      expect(await kernel.listAttachedRecords(candidate, "shared_jobs")).toEqual([]);
      await kernel.close();
    });

    it("revokes live access, retains provenance, and allows explicit rebinding", async () => {
      expect.hasAssertions();
      const { kernel, origin, target, collection } = await setup(createAdapter());
      const input = {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
      };
      const attachment = await kernel.createAttachment(origin, input);
      await expect(kernel.createAttachment(origin, input)).rejects.toMatchObject({
        code: ERROR_CODES.resourceConflict,
      });
      await kernel.revokeAttachment(origin, attachment.id);
      await kernel.revokeAttachment(target, attachment.id);
      expect(await kernel.listAttachments(target)).toEqual([
        expect.objectContaining({
          id: attachment.id,
          revokedBy: origin.actorId,
          revokedAt: "2026-09-17T00:00:00.000Z",
        }),
      ]);
      await expect(kernel.getAttachedSchema(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await expect(kernel.listAttachedRecords(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      const replacement = await kernel.createAttachment(origin, input);
      expect(replacement.id).not.toBe(attachment.id);
      expect(await kernel.getAttachedSchema(target, "shared_jobs")).toEqual(collection);
      await kernel.close();
    });

    it("enforces declared rights and both target/origin authorization seams", async () => {
      expect.hasAssertions();
      const requests: AuthorizationRequest[] = [];
      let deniedOperation = "";
      const authorizer: Authorizer = {
        async authorize(request) {
          requests.push(request);
          return { allowed: request.operation !== deniedOperation };
        },
      };
      const { kernel, origin, target, collection } = await setup(createAdapter(), authorizer);
      deniedOperation = "attachments.accept";
      await expect(
        kernel.createAttachment(origin, {
          collectionKey: collection.key,
          targetId: target.workspaceId,
          key: "shared_jobs",
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
      deniedOperation = "";
      expect(await kernel.listAttachments(target)).toEqual([]);
      const writeOnly = await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
        rights: ["update"],
      });
      await expect(kernel.listAttachedRecords(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      await kernel.revokeAttachment(origin, writeOnly.id);
      const attachment = await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
      });
      deniedOperation = "records.list";
      await expect(kernel.listAttachedRecords(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      expect(requests.at(-1)).toMatchObject({
        context: target,
        operation: "records.list",
        resource: {
          workspaceId: origin.workspaceId,
          collectionId: collection.id,
          attachmentId: attachment.id,
        },
      });
      deniedOperation = "attachments.revoke";
      await expect(kernel.revokeAttachment(target, attachment.id)).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      deniedOperation = "attachments.read";
      await expect(kernel.getAttachedSchema(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      await kernel.close();
    });

    it("tracks stable Field and Collection identities and fails closed on removals", async () => {
      expect.hasAssertions();
      const { kernel, origin, target, collection } = await setup(createAdapter());
      await kernel.createAttachment(origin, {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
        filter: { fieldId: "status", operator: "eq", value: "open" },
      });
      const record = await kernel.createRecord(origin, collection.key, {
        title: "Engineer",
        status: "open",
      });
      const workspace = (await kernel.getWorkspace(origin))!;
      const renamed = {
        ...collection,
        key: "opening",
        fields: collection.fields.map((field) =>
          field.id === "status" ? { ...field, key: "state" } : field,
        ),
      };
      await kernel.applySpec(origin, { ...workspace.spec, collections: [renamed] });
      expect(await kernel.getAttachedSchema(target, "shared_jobs")).toEqual(renamed);
      expect((await kernel.getAttachedRecord(target, "shared_jobs", record.id))?.values).toEqual({
        title: "Engineer",
        state: "open",
      });
      await kernel.applySpec(origin, {
        ...workspace.spec,
        collections: [
          { ...renamed, fields: renamed.fields.filter((field) => field.id !== "status") },
        ],
      });
      await expect(kernel.listAttachedRecords(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.validationInvalidInput,
      });
      await kernel.applySpec(origin, { ...workspace.spec, collections: [] });
      await expect(kernel.getAttachedSchema(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await kernel.close();
    });

    it("rejects invalid slices, cross-root targets, and undeclared Source keys", async () => {
      expect.hasAssertions();
      const { kernel, origin, target, secondTarget, collection } = await setup(createAdapter());
      const input = {
        collectionKey: collection.key,
        targetId: target.workspaceId,
        key: "shared_jobs",
      };
      await expect(
        kernel.createAttachment(origin, {
          ...input,
          filter: { fieldId: "unknown", operator: "eq", value: true },
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
      await expect(kernel.createAttachment(origin, { ...input, rights: [] })).rejects.toMatchObject(
        { code: ERROR_CODES.resourceConflict },
      );
      await expect(
        kernel.createAttachment(origin, { ...input, targetId: origin.workspaceId }),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      const other = await kernel.createRootWorkspace({ name: "Other", user: { name: "Sam" } });
      await expect(
        kernel.createAttachment(origin, { ...input, targetId: other.workspace.id }),
      ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
      const attachment = await kernel.createAttachment(origin, input);
      await expect(kernel.revokeAttachment(secondTarget, attachment.id)).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      const workspace = (await kernel.getWorkspace(target))!;
      await kernel.applySpec(target, { ...workspace.spec, sources: [] });
      await expect(kernel.listAttachedRecords(target, "shared_jobs")).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await kernel.close();
    });
  });
}

async function setup(
  persistence: PersistenceAdapter,
  authorizer?: Authorizer,
  originAtRoot = false,
) {
  let next = 0;
  const kernel = await Kernel.open({
    persistence,
    ids: { create: (kind) => `${kind}-${++next}` },
    clock: { now: () => "2026-09-17T00:00:00.000Z" },
    ...(authorizer ? { authorizer } : {}),
  });
  const { workspace, user } = await kernel.createRootWorkspace({
    name: "Space",
    user: { name: "Jane" },
  });
  const root = { workspaceId: workspace.id, actorId: user.id };
  const hr = originAtRoot
    ? workspace
    : (await kernel.createWorkspace(root, { name: "HR" })).workspace;
  const origin = { ...root, workspaceId: hr.id };
  const { workspace: recruiting } = await kernel.createWorkspace(origin, { name: "Recruiting" });
  const { workspace: projects } = await kernel.createWorkspace(root, { name: "Projects" });
  const target = { ...root, workspaceId: recruiting.id };
  const secondTarget = { ...root, workspaceId: projects.id };
  const collection: CollectionDefinition = {
    id: "jobs",
    key: "job",
    label: "Job",
    fields: [
      { id: "title", key: "title", label: "Title", type: "text" },
      { id: "status", key: "status", label: "Status", type: "text" },
    ],
  };
  await kernel.applySpec(origin, { ...hr.spec, collections: [collection] });
  for (const context of [target, secondTarget]) {
    const current = (await kernel.getWorkspace(context))!;
    await kernel.applySpec(context, {
      ...current.spec,
      sources: [{ id: "source-jobs", key: "shared_jobs", label: "Shared jobs" }],
    });
  }
  const actor = await kernel.createActor(target, { kind: "user", name: "Candidate" });
  await kernel.addMembership(target, {
    actorId: actor.id,
    workspaceId: target.workspaceId,
    roles: ["candidate"],
  });
  return {
    kernel,
    origin,
    target,
    secondTarget,
    candidate: { ...target, actorId: actor.id },
    collection,
  };
}
