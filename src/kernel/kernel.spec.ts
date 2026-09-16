import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { AuthorizationRequest, Authorizer } from "./authorization.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";

describe("Kernel catalog skeleton", () => {
  it("creates an Account with an always-present shared Workspace and persisted Memberships", async () => {
    expect.hasAssertions();
    const persistence = new MemoryPersistenceAdapter();
    const kernel = await Kernel.open({
      persistence,
      ids: sequenceIds(),
      clock: fixedClock,
    });

    const created = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane", email: "jane@example.com" },
    });

    expect(created.account.sharedWorkspaceId).toBe(created.sharedWorkspace.id);
    expect(created.sharedWorkspace.name).toBe("Acme");
    expect(created.sharedWorkspace.spec).toMatchObject({
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
    expect(await kernel.listMembershipsForWorkspace(created.sharedWorkspace.id)).toEqual(
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
    const { account, sharedWorkspace, user } = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      accountId: account.id,
      workspaceId: sharedWorkspace.id,
      actorId: user.id,
    };

    const first = await kernel.createWorkspace(context, { name: "CRM" });
    const second = await kernel.createWorkspace(context, { name: "Projects" });

    expect((await kernel.listWorkspaces(account.id)).map((item) => item.name)).toEqual([
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
    const { account, sharedWorkspace, user } = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      accountId: account.id,
      workspaceId: sharedWorkspace.id,
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
    const { account, sharedWorkspace, user } = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane" },
    });

    await expect(
      kernel.createWorkspace(
        {
          accountId: account.id,
          workspaceId: sharedWorkspace.id,
          actorId: user.id,
        },
        { name: "Denied" },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      operation: "workspaces.create",
      context: { actorId: user.id },
      resource: { kind: "account", id: account.id },
    });
  });

  it("rejects an execution context without a persisted Membership", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      ids: sequenceIds(),
      clock: fixedClock,
    });
    const first = await kernel.createAccount({ name: "Acme", user: { name: "Jane" } });
    const second = await kernel.createAccount({ name: "Other", user: { name: "Sam" } });

    await expect(
      kernel.createWorkspace(
        {
          accountId: first.account.id,
          workspaceId: first.sharedWorkspace.id,
          actorId: second.user.id,
        },
        { name: "Invalid" },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
  });

  it("resolves only persisted Account, Workspace, and Actor contexts", async () => {
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
    const { account, sharedWorkspace, user } = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane" },
    });
    const context = {
      accountId: account.id,
      workspaceId: sharedWorkspace.id,
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
    const {
      account,
      sharedWorkspace,
      user: jane,
    } = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane" },
    });
    const sharedContext = {
      accountId: account.id,
      workspaceId: sharedWorkspace.id,
      actorId: jane.id,
    };
    const { workspace: hr } = await kernel.createWorkspace(sharedContext, { name: "HR" });
    const hrContext = { ...sharedContext, workspaceId: hr.id };
    const { workspace: recruiting } = await kernel.createWorkspace(hrContext, {
      name: "Summer Recruiting",
    });
    const candidate = await kernel.createActor(hrContext, { kind: "user", name: "Candidate" });
    await kernel.addMembership(hrContext, {
      actorId: candidate.id,
      workspaceId: recruiting.id,
      roles: ["candidate"],
    });

    expect(await kernel.listMembershipsForActor(candidate.id)).toEqual([
      expect.objectContaining({ workspaceId: recruiting.id, roles: ["candidate"] }),
    ]);
    await expect(
      kernel.resolveContext({
        accountId: account.id,
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
