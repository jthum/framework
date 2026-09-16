import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { Account, Actor, Membership, Workspace } from "../kernel/model.ts";
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
        await transaction.insertAccount(fixture.account);
        await transaction.insertWorkspace(fixture.workspace);
        await transaction.insertActor(fixture.actor);
        await transaction.insertMembership(fixture.membership);
      });

      (fixture.account as Mutable<Account>).name = "Changed outside the adapter";
      (fixture.workspace.spec as Mutable<Workspace["spec"]>).label = "Changed outside the adapter";
      const firstRead = await catalog.getWorkspace(fixture.workspace.id);
      expect((await catalog.getAccount(fixture.account.id))?.name).toBe("Acme");
      expect(firstRead?.spec.label).toBe("Acme");

      if (!firstRead) throw new Error("Contract fixture Workspace was not persisted.");
      (firstRead.spec as Mutable<Workspace["spec"]>).label = "Changed after reading";
      expect((await catalog.getWorkspace(fixture.workspace.id))?.spec.label).toBe("Acme");

      await persistence.close();
    });

    it("rolls back every write when a transaction fails", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();

      await expect(
        catalog.transaction(async (transaction) => {
          await transaction.insertAccount(fixture.account);
          await transaction.insertWorkspace(fixture.workspace);
          throw new Error("Deliberate rollback");
        }),
      ).rejects.toThrow("Deliberate rollback");
      expect(await catalog.listAccounts()).toEqual([]);
      expect(await catalog.listWorkspaces(fixture.account.id)).toEqual([]);

      await persistence.close();
    });

    it("reports duplicate Workspace Memberships consistently", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const catalog = persistence.catalog;
      const fixture = catalogFixture();

      await catalog.transaction(async (transaction) => {
        await transaction.insertAccount(fixture.account);
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
  });
}

type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };

function catalogFixture(): {
  account: Account;
  workspace: Workspace;
  actor: Actor;
  membership: Membership;
} {
  const stamp = "2026-09-17T00:00:00.000Z";
  const workspace: Workspace = {
    id: "workspace-1",
    accountId: "account-1",
    name: "Acme",
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
    account: {
      id: "account-1",
      name: "Acme",
      sharedWorkspaceId: workspace.id,
      createdAt: stamp,
      updatedAt: stamp,
    },
    workspace,
    actor: {
      id: "actor-1",
      accountId: "account-1",
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
      createdAt: stamp,
      updatedAt: stamp,
    },
  };
}
