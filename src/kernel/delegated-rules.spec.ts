import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec, type RuleDefinition, type Spec } from "../spec/model.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { Kernel } from "./kernel.ts";

describe("delegated Rule execution", () => {
  it("rechecks origin authority for attached writes and explicit Actor overrides", async () => {
    expect.hasAssertions();
    let janeId = "";
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
      async resolveActorBinding(request) {
        if (request.binding === "hr_owner") return janeId;
        throw new Error(`Unknown Actor binding ${request.binding}`);
      },
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    janeId = root.user.id;
    const rootContext = { workspaceId: root.workspace.id, actorId: janeId };
    const { workspace: hr, membership: janeInHr } = await kernel.createWorkspace(rootContext, {
      name: "HR",
    });
    const hrContext = { workspaceId: hr.id, actorId: janeId };
    await kernel.updateWorkspaceAccess(hrContext, {
      members: ["read", "create", "update", "delete", "manage"],
      others: ["read"],
    });
    await kernel.applySpec(hrContext, hrSpec());
    const opening = await kernel.createRecord(hrContext, "job_opening", {
      title: "Designer",
      status: "open",
    });
    const { workspace: recruiting } = await kernel.createWorkspace(hrContext, {
      name: "Recruiting",
    });
    const recruitingContext = { workspaceId: recruiting.id, actorId: janeId };
    await kernel.applySpec(recruitingContext, recruitingSpec());
    await kernel.createAttachment(hrContext, {
      collectionKey: "job_opening",
      targetId: recruiting.id,
      sourceId: "source-openings",
      rights: ["read"],
    });
    const candidate = await kernel.createActor(recruitingContext, {
      kind: "user",
      name: "Candidate",
    });
    await kernel.addMembership(recruitingContext, {
      actorId: candidate.id,
      workspaceId: recruiting.id,
      roles: ["candidate"],
      rights: ["read", "update"],
    });
    const candidateContext = { workspaceId: recruiting.id, actorId: candidate.id };

    await expect(
      kernel.runRule(candidateContext, "close_opening", { input: { opening: opening.id } }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
      message: "This Attachment does not permit update operations.",
    });
    expect(await kernel.getRecord(hrContext, "job_opening", opening.id)).toMatchObject({
      values: { status: "open" },
    });

    await kernel.runRule(candidateContext, "close_opening_as_owner", {
      input: { opening: opening.id },
    });

    expect(await kernel.getRecord(hrContext, "job_opening", opening.id)).toMatchObject({
      values: { status: "closed" },
      updatedBy: janeId,
    });
    await expect(kernel.listMembers(candidateContext, hr.id)).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    await expect(kernel.listActorsByRoot(candidateContext)).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    expect(await kernel.listActorsByOrigin(recruitingContext)).toEqual([candidate]);
    expect(await kernel.listActorsByOrigin(rootContext)).not.toContainEqual(candidate);

    await kernel.updateRecord(hrContext, "job_opening", opening.id, { status: "open" });
    await kernel.updateMembership(hrContext, {
      actorId: janeId,
      workspaceId: hr.id,
      roles: janeInHr.roles,
      rights: ["read", "create", "delete", "manage"],
    });
    await expect(
      kernel.runRule(candidateContext, "close_opening_as_owner", {
        input: { opening: opening.id },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
  });
});

function hrSpec(): Spec {
  return {
    ...createEmptySpec({ id: "spec-hr", key: "hr", label: "HR" }),
    collections: [
      {
        id: "collection-openings",
        key: "job_opening",
        label: "Job opening",
        fields: [
          { id: "field-title", key: "title", label: "Title", type: "text" },
          { id: "field-status", key: "status", label: "Status", type: "text" },
        ],
      },
    ],
  };
}

function recruitingSpec(): Spec {
  const close = (id: string, key: string, runAs?: string): RuleDefinition => ({
    id,
    key,
    label: key,
    input: { opening: { sourceId: "source-openings", required: true } },
    steps: [
      {
        id: `${id}-update`,
        action: {
          key: "records.update",
          input: { record: { $ref: "vars.opening" }, values: { status: "closed" } },
          ...(runAs === undefined ? {} : { runAs }),
        },
      },
    ],
  });
  return {
    ...createEmptySpec({ id: "spec-recruiting", key: "recruiting", label: "Recruiting" }),
    sources: [{ id: "source-openings", key: "openings", label: "Openings" }],
    rules: [
      close("rule-close", "close_opening"),
      close("rule-close-owner", "close_opening_as_owner", "hr_owner"),
    ],
  };
}

const fixedClock: Clock = { now: () => "2026-09-17T00:00:00.000Z" };

function sequenceIds(): IdGenerator {
  let next = 0;
  return {
    create(kind: IdKind) {
      next += 1;
      return `${kind}-${next}`;
    },
  };
}
