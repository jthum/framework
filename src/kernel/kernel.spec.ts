import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { AuthorizationRequest, Authorizer } from "./authorization.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";
import type { ExecutionContext } from "./model.ts";

describe("Kernel catalog skeleton", () => {
  it("enforces explicit Workspace spawn and local Actor policy", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.updateWorkspacePolicy(context, {
      spawn: false,
      createActors: false,
      reshare: false,
    });
    await expect(kernel.createWorkspace(context, { name: "App" })).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    await expect(
      kernel.createActor(context, { kind: "user", name: "Candidate" }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    await kernel.close();
  });

  it("authorizes every actor-facing catalog read", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
      authorizer: {
        async authorize(request) {
          requests.push(request);
          return { allowed: false };
        },
      },
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const context: ExecutionContext = { workspaceId: workspace.id, actorId: user.id };
    const reads = [
      () => kernel.getWorkspace(context),
      () => kernel.listRootWorkspaces(context),
      () => kernel.listChildWorkspaces(context),
      () => kernel.listWorkspacesByRoot(context),
      () => kernel.getActor(context, user.id),
      () => kernel.listActorsByOrigin(context),
      () => kernel.listActorsByRoot(context),
      () => kernel.listMembers(context),
      () => kernel.listMembershipsForActor(context, user.id),
      () => kernel.listMembershipsForWorkspace(context),
    ];
    for (const read of reads)
      await expect(read()).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests.map((request) => request.operation)).toEqual([
      "workspaces.read",
      "workspaces.listRoots",
      "workspaces.listChildren",
      "workspaces.listByRoot",
      "actors.read",
      "actors.listByOrigin",
      "actors.listByRoot",
      "actors.listMembers",
      "memberships.listForActor",
      "memberships.listForWorkspace",
    ]);
    const count = requests.length;
    await expect(kernel.listMembers({ ...context, actorId: "missing" })).rejects.toMatchObject({
      code: ERROR_CODES.resourceNotFound,
    });
    expect(requests).toHaveLength(count);
    await kernel.close();
  });

  it("does not apply record schema outside the atomic Spec application", async () => {
    expect.hasAssertions();
    const adapter = new MemoryPersistenceAdapter();
    const session = await adapter.open();
    let standaloneSchemaApplications = 0;
    const failure = new Error("Spec application failed");
    const kernel = await Kernel.open({
      persistence: {
        kind: "failing",
        async open() {
          return {
            ...session,
            records: {
              applySchema: async () => {
                standaloneSchemaApplications += 1;
              },
              create: session.records.create.bind(session.records),
              get: session.records.get.bind(session.records),
              getMany: session.records.getMany.bind(session.records),
              list: session.records.list.bind(session.records),
              update: session.records.update.bind(session.records),
              delete: session.records.delete.bind(session.records),
            },
            applyWorkspaceSpec: async () => {
              throw failure;
            },
          };
        },
      },
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const collection = { id: "tasks", key: "task", label: "Task", fields: [] };
    await expect(
      kernel.applySpec(
        { workspaceId: workspace.id, actorId: user.id },
        { ...workspace.spec, collections: [collection] },
      ),
    ).rejects.toBe(failure);
    expect(standaloneSchemaApplications).toBe(0);
    expect(await session.catalog.getWorkspace(workspace.id)).toEqual(workspace);
    await expect(session.records.list(workspace.id, collection)).rejects.toMatchObject({
      code: ERROR_CODES.resourceNotFound,
    });
    await kernel.close();
  });
  it("requires explicit authorization for root-wide Actor discovery", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      authorizer: {
        async authorize(request) {
          requests.push(request);
          return { allowed: false };
        },
      },
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    await expect(
      kernel.listActorsByRoot({ workspaceId: workspace.id, actorId: user.id }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests[0]).toEqual({
      operation: "actors.listByRoot",
      context: { workspaceId: workspace.id, actorId: user.id },
      resource: { kind: "workspace", id: workspace.id, workspaceId: workspace.id },
    });
  });

  it("rejects cross-root Memberships without inheriting access from grouping", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const first = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const second = await kernel.createRootWorkspace({ name: "Other", user: { name: "Sam" } });
    const context = { workspaceId: first.workspace.id, actorId: first.user.id };
    await expect(
      kernel.addMembership(context, {
        actorId: second.user.id,
        workspaceId: first.workspace.id,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    await expect(
      kernel.addMembership(context, {
        actorId: second.user.id,
        workspaceId: second.workspace.id,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    const { workspace } = await kernel.createWorkspace(context, { name: "App" });
    await expect(
      kernel.resolveContext({ workspaceId: workspace.id, actorId: first.system.id }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
  });
  it("bootstraps a root Workspace with locally issued Actors and persisted Memberships", async () => {
    expect.hasAssertions();
    const persistence = new MemoryPersistenceAdapter();
    const kernel = await Kernel.open({
      persistence,
      ids: sequenceIds(),
      clock: fixedClock,
    });

    const created = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane", email: "jane@example.com" },
    });

    expect(created.workspace).toMatchObject({
      isRoot: true,
      parentId: null,
      rootId: created.workspace.id,
    });
    expect(created.user).toMatchObject({
      originId: created.workspace.id,
      rootId: created.workspace.id,
    });
    expect(created.workspace.name).toBe("Acme");
    expect(created.workspace.spec).toMatchObject({
      version: 2,
      key: "acme",
      collections: [],
      views: [],
      forms: [],
      pages: [],
      rules: [],
    });
    expect(created.user).toMatchObject({ kind: "user", name: "Jane" });
    expect(created.system).toMatchObject({ kind: "system", name: "System" });
    expect(
      await kernel.listMembershipsForWorkspace({
        workspaceId: created.workspace.id,
        actorId: created.user.id,
      }),
    ).toEqual(created.memberships);
  });

  it("persists one Actor identity across several Workspace Memberships", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      workspaceId: workspace.id,
      actorId: user.id,
    };

    const first = await kernel.createWorkspace(context, { name: "CRM" });
    const second = await kernel.createWorkspace(context, { name: "Projects" });

    expect((await kernel.listWorkspacesByRoot(context)).map((item) => item.name)).toEqual([
      "Acme",
      "CRM",
      "Projects",
    ]);
    expect(await kernel.listMembershipsForActor(context, user.id)).toHaveLength(3);
    expect(first.membership.actorId).toBe(user.id);
    expect(second.membership.actorId).toBe(user.id);
  });

  it("persists explicit Memberships for additional Actors", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      workspaceId: workspace.id,
      actorId: user.id,
    };
    const { workspace: recruiting } = await kernel.createWorkspace(context, { name: "Recruiting" });
    const candidate = await kernel.createActor(context, {
      kind: "user",
      name: "Candidate",
    });

    const membership = await kernel.addMembership(context, {
      actorId: candidate.id,
      workspaceId: recruiting.id,
      roles: ["candidate"],
    });

    expect(membership).toMatchObject({
      actorId: candidate.id,
      workspaceId: recruiting.id,
      roles: ["candidate"],
    });
    expect(await kernel.listMembershipsForActor(context, candidate.id)).toEqual([membership]);
    expect(await kernel.listMembershipsForActor(context, user.id)).toHaveLength(2);
  });

  it("routes mutations through the authorization seam", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    const authorizer: Authorizer = {
      async authorize(request) {
        requests.push(request);
        return request.operation === "workspaces.create"
          ? { allowed: false, message: "Workspace creation is disabled." }
          : { allowed: true };
      },
    };
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      authorizer,
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });

    await expect(
      kernel.createWorkspace(
        {
          workspaceId: workspace.id,
          actorId: user.id,
        },
        { name: "Denied" },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      operation: "workspaces.create",
      context: { actorId: user.id },
      resource: { kind: "workspace", id: workspace.id },
    });
  });

  it("rejects an execution context without a persisted Membership", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const first = await kernel.createRootWorkspace({ name: "Acme", user: { name: "Jane" } });
    const second = await kernel.createRootWorkspace({ name: "Other", user: { name: "Sam" } });

    await expect(
      kernel.createWorkspace(
        {
          workspaceId: first.workspace.id,
          actorId: second.user.id,
        },
        { name: "Invalid" },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
  });

  it("resolves only persisted Workspace and Actor contexts", async () => {
    expect.hasAssertions();
    const environment = defineEnvironmentProfile({
      ...LOCAL_BROWSER_ENVIRONMENT,
      multiplayer: true,
    });
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
      environment,
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      workspaceId: workspace.id,
      actorId: user.id,
    };

    expect(await kernel.resolveContext(context)).toEqual(context);
    expect(kernel.environment).toEqual(environment);
  });

  it("models a delegated Workspace without making local Actors members of the origin", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { workspace, user: jane } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const sharedContext = {
      workspaceId: workspace.id,
      actorId: jane.id,
    };
    const { workspace: hr } = await kernel.createWorkspace(sharedContext, { name: "HR" });
    const hrContext = { ...sharedContext, workspaceId: hr.id };
    const { workspace: recruiting } = await kernel.createWorkspace(hrContext, {
      name: "Summer Recruiting",
    });
    const recruitingContext = { ...hrContext, workspaceId: recruiting.id };
    const candidate = await kernel.createActor(recruitingContext, {
      kind: "user",
      name: "Candidate",
    });
    await kernel.addMembership(recruitingContext, {
      actorId: candidate.id,
      workspaceId: recruiting.id,
      roles: ["candidate"],
    });

    expect(hr).toMatchObject({
      isRoot: false,
      parentId: workspace.id,
      rootId: workspace.id,
    });
    expect(recruiting).toMatchObject({
      isRoot: false,
      parentId: hr.id,
      rootId: workspace.id,
      createdBy: jane.id,
    });
    expect(candidate).toMatchObject({ originId: recruiting.id, rootId: workspace.id });
    expect(await kernel.listActorsByOrigin(sharedContext)).not.toContainEqual(candidate);
    expect(await kernel.listActorsByOrigin(recruitingContext)).toEqual([candidate]);
    expect(await kernel.listMembers(hrContext)).toEqual([jane]);
    expect(await kernel.listMembers(recruitingContext)).toEqual([jane, candidate]);
    expect(await kernel.listChildWorkspaces(hrContext)).toEqual([recruiting]);

    expect(await kernel.listMembershipsForActor(recruitingContext, candidate.id)).toEqual([
      expect.objectContaining({ workspaceId: recruiting.id, roles: ["candidate"] }),
    ]);
    await expect(
      kernel.resolveContext({
        workspaceId: hr.id,
        actorId: candidate.id,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
  });
});

const fixedClock: Clock = {
  now: () => "2026-09-16T00:00:00.000Z",
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
