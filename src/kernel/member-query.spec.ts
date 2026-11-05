import { describe, expect, it } from "vite-plus/test";
import { Kernel } from "./kernel.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";

for (const [name, persistence] of [
  ["memory", () => new MemoryPersistenceAdapter()],
  ["SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite())],
] as const) {
  describe(`${name} member queries`, () => {
    it("filters and counts before paging, with deterministic ordering and isolated Workspaces", async () => {
      const kernel = await Kernel.open({ persistence: persistence() });
      try {
        const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Owner" } });
        const context = { workspaceId: root.workspace.id, actorId: root.user.id };
        const child = await kernel.createWorkspace(context, { name: "App" });
        const people = [];
        for (let index = 0; index < 31; index++) {
          const person = await kernel.createMember(context, {
            name: `Member ${String(index).padStart(2, "0")}`,
            permissions: index < 3 ? [] : ["read"],
          });
          people.push(person);
          if (index % 2 === 0)
            await kernel.addMembership(context, {
              workspaceId: child.workspace.id,
              actorId: person.actor.id,
              permissions: ["read"],
            });
        }
        await kernel.createMember(context, { name: "Literal %_", email: "literal@example.test" });
        const first = await kernel.queryMembers(context, { search: "  MEMBER  ", limit: 10 });
        const second = await kernel.queryMembers(context, {
          search: "member",
          limit: 10,
          offset: 10,
        });
        expect(first).toMatchObject({ total: 31, offset: 0, limit: 10 });
        expect(first.members.map(({ actor }) => actor.name)).toEqual(
          Array.from({ length: 10 }, (_, index) => `Member 0${index}`),
        );
        expect(second.members[0]?.actor.name).toBe("Member 10");
        expect(await kernel.queryMembers(context, { search: "member", offset: 100 })).toMatchObject(
          { members: [], total: 31 },
        );
        expect((await kernel.queryMembers(context, { search: "%_" })).total).toBe(1);
        expect((await kernel.queryMembers(context, { search: "EXAMPLE.TEST" })).total).toBe(1);
        const filtered = await kernel.queryMembers(context, {
          search: "member",
          permission: "read",
          memberOf: child.workspace.id,
          sort: "name_desc",
          limit: 2,
        });
        expect(filtered.total).toBe(14);
        expect(filtered.members.map(({ actor }) => actor.name)).toEqual(["Member 30", "Member 28"]);
        expect(
          (await kernel.queryMembers(context, { search: "member", permission: "none" })).total,
        ).toBe(3);
        expect(
          (await kernel.queryMembers(context, { kind: "system" })).members.map(
            ({ actor }) => actor.id,
          ),
        ).toEqual([root.system.id]);
        const outside = await kernel.createRootWorkspace({
          name: "Other",
          user: { name: "Member outside" },
        });
        expect((await kernel.queryMembers(context, { search: "outside" })).total).toBe(0);
        expect(await kernel.getMembership(context, people[0]!.actor.id)).toMatchObject({
          permissions: [],
        });
        await expect(
          kernel.queryMembers({ ...context, actorId: people[3]!.actor.id }),
        ).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
        await expect(
          kernel.queryMembers(context, { memberOf: outside.workspace.id }),
        ).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
        // Managing the parent never substitutes for management of the filtered Workspace.
        await kernel.updateMembership(context, {
          actorId: root.user.id,
          workspaceId: child.workspace.id,
          permissions: [],
        });
        await expect(
          kernel.queryMembers(context, { memberOf: child.workspace.id }),
        ).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
      } finally {
        await kernel.close();
      }
    });

    it("rejects malformed public query parameters instead of interpolating them into queries", async () => {
      const kernel = await Kernel.open({ persistence: persistence() });
      try {
        const { workspace, user } = await kernel.createRootWorkspace({
          name: "Space",
          user: { name: "Owner" },
        });
        for (const query of [
          { limit: 0 },
          { limit: 101 },
          { offset: -1 },
          { offset: 0.5 },
          { search: "x".repeat(201) },
          { sort: "name; DROP TABLE actors" },
          { permission: "root" },
        ])
          await expect(
            kernel.queryMembers(
              { workspaceId: workspace.id, actorId: user.id },
              query as Parameters<Kernel["queryMembers"]>[1],
            ),
          ).rejects.toMatchObject({ code: "VALIDATION.INVALID_INPUT" });
      } finally {
        await kernel.close();
      }
    });
  });
}
