import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { AuthorizationRequest, Authorizer } from "./authorization.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";

describe("Kernel catalog skeleton", () => {
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
    const { rootWorkspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    await expect(
      kernel.listActorsByRoot({ workspaceId: rootWorkspace.id, actorId: user.id }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests[0]).toEqual({
      operation: "actors.listByRoot",
      context: { workspaceId: rootWorkspace.id, actorId: user.id },
      resource: { kind: "workspace", id: rootWorkspace.id, workspaceId: rootWorkspace.id },
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
    const context = { workspaceId: first.rootWorkspace.id, actorId: first.user.id };
    await expect(
      kernel.addMembership(context, {
        actorId: second.user.id,
        workspaceId: first.rootWorkspace.id,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    await expect(
      kernel.addMembership(context, {
        actorId: second.user.id,
        workspaceId: second.rootWorkspace.id,
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

    expect(created.rootWorkspace).toMatchObject({
      isRoot: true,
      parentId: null,
      rootId: created.rootWorkspace.id,
    });
    expect(created.user).toMatchObject({
      originId: created.rootWorkspace.id,
      rootId: created.rootWorkspace.id,
    });
    expect(created.rootWorkspace.name).toBe("Acme");
    expect(created.rootWorkspace.spec).toMatchObject({
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
    expect(await kernel.listMembershipsForWorkspace(created.rootWorkspace.id)).toEqual(
      created.memberships,
    );
  });

  it("persists one Actor identity across several Workspace Memberships", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const { rootWorkspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      workspaceId: rootWorkspace.id,
      actorId: user.id,
    };

    const first = await kernel.createWorkspace(context, { name: "CRM" });
    const second = await kernel.createWorkspace(context, { name: "Projects" });

    expect((await kernel.listWorkspacesByRoot(rootWorkspace.id)).map((item) => item.name)).toEqual([
      "Acme",
      "CRM",
      "Projects",
    ]);
    expect(await kernel.listMembershipsForActor(user.id)).toHaveLength(3);
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
    const { rootWorkspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      workspaceId: rootWorkspace.id,
      actorId: user.id,
    };
    const { workspace } = await kernel.createWorkspace(context, { name: "Recruiting" });
    const candidate = await kernel.createActor(context, {
      kind: "user",
      name: "Candidate",
    });

    const membership = await kernel.addMembership(context, {
      actorId: candidate.id,
      workspaceId: workspace.id,
      roles: ["candidate"],
    });

    expect(membership).toMatchObject({
      actorId: candidate.id,
      workspaceId: workspace.id,
      roles: ["candidate"],
    });
    expect(await kernel.listMembershipsForActor(candidate.id)).toEqual([membership]);
    expect(await kernel.listMembershipsForActor(user.id)).toHaveLength(2);
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
    const { rootWorkspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });

    await expect(
      kernel.createWorkspace(
        {
          workspaceId: rootWorkspace.id,
          actorId: user.id,
        },
        { name: "Denied" },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      operation: "workspaces.create",
      context: { actorId: user.id },
      resource: { kind: "workspace", id: rootWorkspace.id },
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
          workspaceId: first.rootWorkspace.id,
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
    const { rootWorkspace, user } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      workspaceId: rootWorkspace.id,
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
    const { rootWorkspace, user: jane } = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane" },
    });
    const sharedContext = {
      workspaceId: rootWorkspace.id,
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
      parentId: rootWorkspace.id,
      rootId: rootWorkspace.id,
    });
    expect(recruiting).toMatchObject({
      isRoot: false,
      parentId: hr.id,
      rootId: rootWorkspace.id,
      createdByActorId: jane.id,
    });
    expect(candidate).toMatchObject({ originId: recruiting.id, rootId: rootWorkspace.id });
    expect(await kernel.listActorsByOrigin(rootWorkspace.id)).not.toContainEqual(candidate);
    expect(await kernel.listActorsByOrigin(recruiting.id)).toEqual([candidate]);
    expect(await kernel.listActorsForWorkspace(hr.id)).toEqual([jane]);
    expect(await kernel.listActorsForWorkspace(recruiting.id)).toEqual([jane, candidate]);
    expect(await kernel.listChildWorkspaces(hr.id)).toEqual([recruiting]);

    expect(await kernel.listMembershipsForActor(candidate.id)).toEqual([
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
