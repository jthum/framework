import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { PersistenceAdapter, PersistenceSession } from "../persistence/catalog.ts";
import { MemoryScopeStore } from "../persistence/scopes.ts";
import { MemoryRuleSubscriptionStore } from "../persistence/subscriptions.ts";
import { MemoryExecutionStore } from "../persistence/executions.ts";
import { MemoryWorkspaceConfigStore } from "../persistence/workspace-config.ts";
import {
  MemoryCatalogRepository,
  MemoryPersistenceAdapter,
  MemoryRecordStore,
} from "../persistence/memory.ts";
import type { CollectionRecord } from "../persistence/records.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import { Kernel } from "./kernel.ts";

describe("Source contract", () => {
  it("groups, measures, sorts, and paginates through the portable query contract", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Reviews",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.applySpec(context, {
      ...workspace.spec,
      collections: [
        {
          id: "collection-review",
          key: "review",
          label: "Review",
          fields: [
            { id: "field-team", key: "team", label: "Team", type: "text" },
            { id: "field-quality", key: "quality", label: "Quality", type: "number" },
            { id: "field-impact", key: "impact", label: "Impact", type: "number" },
          ],
        },
      ],
    });
    await kernel.createRecord(context, "review", { team: "Design", quality: 8, impact: 6 });
    await kernel.createRecord(context, "review", { team: "Design", quality: 10, impact: 8 });
    await kernel.createRecord(context, "review", { team: "Sales", quality: 5, impact: 5 });
    const result = await kernel.querySource(context, "review", {
      aggregate: {
        group: { path: ["field-team"], as: "team" },
        measures: [
          { as: "review_count", operation: "count" },
          { as: "score", operation: "avg", paths: [["field-quality"], ["field-impact"]] },
        ],
        sort: [{ key: "score", direction: "desc" }],
      },
      limit: 1,
    });
    expect(result).toMatchObject({
      total: 2,
      columns: [
        { key: "team", aggregate: "group", type: "text" },
        { key: "review_count", aggregate: "count", type: "number" },
        { key: "score", aggregate: "avg", type: "number" },
      ],
      rows: [{ id: "Design", values: { team: "Design", review_count: 2, score: 8 } }],
    });
    await kernel.close();
  });

  it("queries a local Collection and batches declared relationship traversal", async () => {
    expect.hasAssertions();
    const records = new TrackingRecordStore();
    const kernel = await Kernel.open({ persistence: memoryAdapter(records) });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    const [clients, projects] = relationalCollections();
    await kernel.applySpec(context, { ...workspace.spec, collections: [clients, projects] });
    const acme = await kernel.createRecord(context, clients.key, { name: "Acme" });
    const beta = await kernel.createRecord(context, clients.key, { name: "Beta" });
    await kernel.createRecord(context, projects.key, {
      name: "Website",
      client: acme.id,
      status: "active",
    });
    await kernel.createRecord(context, projects.key, {
      name: "Campaign",
      client: beta.id,
      status: "active",
    });
    records.getManyCalls = 0;

    const descriptor = await kernel.getSource(context, "project");
    expect(descriptor?.capabilities).toMatchObject({ relations: true, suggestions: false });
    const result = await kernel.querySource(context, "project", {
      filter: { path: ["field-client", "field-client-name"], operator: "contains", value: "e" },
      sort: [{ path: ["field-client", "field-client-name"], direction: "desc" }],
      select: [
        { path: ["field-project-name"], as: "project_name" },
        { path: ["field-client", "field-client-name"], as: "client_name" },
      ],
    });
    expect(result.rows.map((row) => row.values)).toEqual([
      { project_name: "Campaign", client_name: "Beta" },
      { project_name: "Website", client_name: "Acme" },
    ]);
    expect(result.columns).toEqual([
      expect.objectContaining({ key: "project_name", label: "Name", type: "text" }),
      expect.objectContaining({ key: "client_name", label: "Name", type: "text" }),
    ]);
    const paged = await kernel.querySource(context, "project", { offset: 1, limit: 1 });
    expect(paged).toMatchObject({
      total: 2,
      rows: [expect.objectContaining({ id: expect.any(String) })],
    });
    expect(records.getManyCalls).toBe(1);
    const grouped = await kernel.querySource(context, "project", {
      aggregate: {
        group: {
          path: ["field-client"],
          labelPath: ["field-client", "field-client-name"],
          as: "client",
        },
        measures: [{ as: "project_count", operation: "count" }],
      },
    });
    expect(grouped.columns[0]).toMatchObject({
      key: "client",
      fieldId: "field-client-name",
      path: ["field-client", "field-client-name"],
      type: "text",
      aggregate: "group",
    });
    expect(grouped.rows).toEqual([
      { id: acme.id, values: { client: "Acme", project_count: 1 } },
      { id: beta.id, values: { client: "Beta", project_count: 1 } },
    ]);
    await kernel.close();
  });

  it("rejects paths that are not declared reference traversal", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: memoryAdapter(new MemoryRecordStore()) });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    const collections = relationalCollections();
    await kernel.applySpec(context, { ...workspace.spec, collections });

    await expect(
      kernel.querySource(context, "project", {
        select: [{ path: ["field-project-name", "field-client-name"], as: "unrelated" }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    await kernel.close();
  });

  it("authorizes every Collection traversed by a relationship query", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    let denyRelations = false;
    const kernel = await Kernel.open({
      persistence: memoryAdapter(new MemoryRecordStore()),
      authorizer: {
        async authorize(request) {
          requests.push(request);
          return {
            allowed: !(
              denyRelations &&
              request.operation === "records.list" &&
              request.resource.collectionId === "collection-client"
            ),
          };
        },
      },
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    const [clients, projects] = relationalCollections();
    await kernel.applySpec(context, { ...workspace.spec, collections: [clients, projects] });
    const client = await kernel.createRecord(context, "client", { name: "Acme" });
    await kernel.createRecord(context, "project", { name: "Website", client: client.id });
    denyRelations = true;

    await expect(
      kernel.querySource(context, "project", {
        select: [{ path: ["field-client", "field-client-name"], as: "client_name" }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
    expect(requests.at(-1)).toMatchObject({
      operation: "records.list",
      resource: {
        kind: "collection",
        id: "collection-client",
        collectionId: "collection-client",
      },
    });
    await kernel.close();
  });

  it("references and traverses an attached Source without exposing deeper origin relations", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace: space, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const origin = { workspaceId: space.id, actorId: user.id };
    await kernel.updateWorkspaceAccess(origin, {
      members: ["read", "create", "update", "delete", "manage"],
      others: ["read"],
    });
    const { workspace: app } = await kernel.createWorkspace(origin, { name: "Billing" });
    const target = { ...origin, workspaceId: app.id };
    await kernel.applySpec(origin, {
      ...space.spec,
      collections: [
        {
          id: "collection-company",
          key: "company",
          label: "Company",
          fields: [{ id: "field-company-name", key: "name", label: "Name", type: "text" }],
        },
        {
          id: "collection-contact",
          key: "contact",
          label: "Contact",
          fields: [
            { id: "field-contact-name", key: "name", label: "Name", type: "text" },
            { id: "field-contact-status", key: "status", label: "Status", type: "text" },
            {
              id: "field-contact-company",
              key: "company",
              label: "Company",
              type: "reference",
              sourceId: "collection-company",
            },
          ],
        },
      ],
    });
    await kernel.applySpec(target, {
      ...app.spec,
      sources: [{ id: "source-contacts", key: "contacts", label: "Contacts" }],
      collections: [
        {
          id: "collection-invoice",
          key: "invoice",
          label: "Invoice",
          fields: [
            { id: "field-invoice-number", key: "number", label: "Number", type: "text" },
            {
              id: "field-invoice-contact",
              key: "contact",
              label: "Contact",
              type: "reference",
              sourceId: "source-contacts",
            },
          ],
        },
      ],
    });
    const attachment = await kernel.createAttachment(origin, {
      collectionKey: "contact",
      targetId: app.id,
      sourceId: "source-contacts",
      filter: { fieldId: "field-contact-status", operator: "eq", value: "active" },
    });
    const company = await kernel.createRecord(origin, "company", { name: "Acme" });
    const active = await kernel.createRecord(origin, "contact", {
      name: "Ada",
      status: "active",
      company: company.id,
    });
    const hidden = await kernel.createRecord(origin, "contact", {
      name: "Grace",
      status: "inactive",
      company: company.id,
    });
    await expect(
      kernel.createRecord(target, "invoice", { number: "INV-2", contact: hidden.id }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    await kernel.createRecord(target, "invoice", { number: "INV-1", contact: active.id });

    const result = await kernel.querySource(target, "invoice", {
      select: [
        { path: ["field-invoice-number"], as: "number" },
        {
          path: ["field-invoice-contact", "field-contact-name"],
          as: "contact_name",
        },
      ],
    });
    expect(result.rows.map((row) => row.values)).toEqual([
      { number: "INV-1", contact_name: "Ada" },
    ]);
    await expect(
      kernel.querySource(target, "invoice", {
        select: [
          {
            path: ["field-invoice-contact", "field-contact-company", "field-company-name"],
            as: "company_name",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "SOURCE.CAPABILITY_UNSUPPORTED" });

    const current = (await kernel.getWorkspace(target))!;
    await kernel.applySpec(target, {
      ...current.spec,
      sources: [{ ...current.spec.sources[0]!, key: "customers" }],
    });
    expect(
      (
        await kernel.querySource(target, "invoice", {
          select: [
            {
              path: ["field-invoice-contact", "field-contact-name"],
              as: "contact_name",
            },
          ],
        })
      ).rows[0]?.values.contact_name,
    ).toBe("Ada");
    await kernel.revokeAttachment(origin, attachment.id);
    await expect(
      kernel.querySource(target, "invoice", {
        select: [{ path: ["field-invoice-contact", "field-contact-name"], as: "contact_name" }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.resourceNotFound });
    await kernel.close();
  });
});

class TrackingRecordStore extends MemoryRecordStore {
  getManyCalls = 0;

  override async getMany(
    workspaceId: string,
    collection: CollectionDefinition,
    recordIds: readonly string[],
  ): Promise<CollectionRecord[]> {
    this.getManyCalls += 1;
    return super.getMany(workspaceId, collection, recordIds);
  }
}

function memoryAdapter(records: MemoryRecordStore): PersistenceAdapter {
  const catalog = new MemoryCatalogRepository();
  return {
    kind: "memory-test",
    async open(): Promise<PersistenceSession> {
      return {
        scopes: new MemoryScopeStore(),
        subscriptions: new MemoryRuleSubscriptionStore(),
        executions: new MemoryExecutionStore(),
        workspaceConfigs: new MemoryWorkspaceConfigStore(),
        catalog,
        records,
        async applyWorkspaceSpec(workspace) {
          const snapshot = records.snapshot();
          try {
            await records.applySchema(workspace.id, workspace.spec.collections);
            await catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
          } catch (error) {
            records.restore(snapshot);
            throw error;
          }
        },
        async applyScopeConfig() {},
        async deleteScope() {},
        async deleteWorkspace(workspaceId) {
          records.deleteWorkspace(workspaceId);
          catalog.deleteWorkspace(workspaceId);
        },
        async close() {},
      };
    },
  };
}

function relationalCollections(): readonly [CollectionDefinition, CollectionDefinition] {
  return [
    {
      id: "collection-client",
      key: "client",
      label: "Client",
      fields: [{ id: "field-client-name", key: "name", label: "Name", type: "text" }],
    },
    {
      id: "collection-project",
      key: "project",
      label: "Project",
      fields: [
        { id: "field-project-name", key: "name", label: "Name", type: "text" },
        {
          id: "field-client",
          key: "client",
          label: "Client",
          type: "reference",
          sourceId: "collection-client",
        },
        { id: "field-status", key: "status", label: "Status", type: "text" },
      ],
    },
  ];
}
