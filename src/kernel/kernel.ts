import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type {
  CatalogRepository,
  PersistenceAdapter,
  PersistenceSession,
} from "../persistence/catalog.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import { createEmptySpec, type CollectionDefinition, type Spec } from "../spec/model.ts";
import { assertValidSpec } from "../spec/validate.ts";
import { AllowAllAuthorizer, type AuthorizationRequest, type Authorizer } from "./authorization.ts";
import { AttachmentService, type CreateAttachmentInput } from "./attachments.ts";
import {
  NanoIdGenerator,
  semanticKey,
  SystemClock,
  type Clock,
  type IdGenerator,
} from "./defaults.ts";
import { LOCAL_BROWSER_ENVIRONMENT, type EnvironmentProfile } from "./environment.ts";
import {
  prepareCreateValues,
  prepareMigratedValues,
  prepareUpdateValues,
} from "./record-values.ts";
import type { Actor, ActorKind, ExecutionContext, Membership, Workspace } from "./model.ts";

export interface KernelOptions {
  readonly persistence: PersistenceAdapter;
  readonly authorizer?: Authorizer;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly environment?: EnvironmentProfile;
}

export interface CreateRootWorkspaceInput {
  readonly name: string;
  readonly user: {
    readonly name: string;
    readonly email?: string;
  };
}

export interface WorkspaceBootstrap {
  readonly workspace: Workspace;
  readonly user: Actor;
  readonly system: Actor;
  readonly memberships: readonly [Membership, Membership];
}

export interface CreateWorkspaceInput {
  readonly name: string;
}

export interface CreateActorInput {
  readonly kind: Exclude<ActorKind, "system">;
  readonly name: string;
  readonly email?: string;
}

export class Kernel {
  private readonly attachments: AttachmentService;
  private constructor(
    private readonly persistence: PersistenceSession,
    private readonly catalog: CatalogRepository,
    private readonly authorizer: Authorizer,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    readonly environment: EnvironmentProfile,
  ) {
    this.attachments = new AttachmentService(
      catalog,
      persistence.records,
      ids,
      clock,
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
    );
  }

  createAttachment(context: ExecutionContext, input: CreateAttachmentInput) {
    return this.attachments.create(context, input);
  }

  listAttachments(context: ExecutionContext) {
    return this.attachments.list(context);
  }
  revokeAttachment(context: ExecutionContext, id: string) {
    return this.attachments.revoke(context, id);
  }
  getAttachedSchema(context: ExecutionContext, key: string) {
    return this.attachments.schema(context, key);
  }
  listAttachedRecords(context: ExecutionContext, key: string) {
    return this.attachments.listRecords(context, key);
  }
  getAttachedRecord(context: ExecutionContext, key: string, id: string) {
    return this.attachments.getRecord(context, key, id);
  }

  static async open(options: KernelOptions): Promise<Kernel> {
    const persistence = await options.persistence.open();
    return new Kernel(
      persistence,
      persistence.catalog,
      options.authorizer ?? new AllowAllAuthorizer(),
      options.ids ?? new NanoIdGenerator(),
      options.clock ?? new SystemClock(),
      options.environment ?? LOCAL_BROWSER_ENVIRONMENT,
    );
  }

  async createRootWorkspace(input: CreateRootWorkspaceInput): Promise<WorkspaceBootstrap> {
    const name = requiredName(input.name, "Workspace");
    const userName = requiredName(input.user.name, "User");
    const stamp = this.clock.now();
    const workspaceId = this.ids.create("workspace");
    const userId = this.ids.create("actor");
    const systemId = this.ids.create("actor");
    const workspace: Workspace = {
      id: workspaceId,
      isRoot: true,
      parentId: null,
      rootId: workspaceId,
      name,
      spec: createEmptySpec({
        id: this.ids.create("spec"),
        key: semanticKey(name),
        label: name,
      }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const user: Actor = {
      id: userId,
      originId: workspaceId,
      rootId: workspaceId,
      kind: "user",
      name: userName,
      ...(input.user.email === undefined ? {} : { email: input.user.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const system: Actor = {
      id: systemId,
      originId: workspaceId,
      rootId: workspaceId,
      kind: "system",
      name: "System",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const memberships = [
      membership(this.ids, stamp, userId, workspaceId, ["owner"]),
      membership(this.ids, stamp, systemId, workspaceId, ["system"]),
    ] as const;

    await this.catalog.transaction(async (transaction) => {
      await transaction.insertWorkspace(workspace);
      await transaction.insertActor(user);
      await transaction.insertActor(system);
      await transaction.insertMembership(memberships[0]);
      await transaction.insertMembership(memberships[1]);
    });

    return { workspace, user, system, memberships };
  }

  async createWorkspace(
    context: ExecutionContext,
    input: CreateWorkspaceInput,
  ): Promise<{ workspace: Workspace; membership: Membership }> {
    await this.assertContext(context);
    const parent = await this.requireWorkspace(context.workspaceId);
    await this.assertAuthorized({
      context,
      operation: "workspaces.create",
      resource: {
        kind: "workspace",
        id: context.workspaceId,
        workspaceId: context.workspaceId,
      },
    });

    const name = requiredName(input.name, "Workspace");
    const stamp = this.clock.now();
    const workspace: Workspace = {
      id: this.ids.create("workspace"),
      isRoot: false,
      parentId: parent.id,
      rootId: parent.rootId,
      name,
      createdBy: context.actorId,
      spec: createEmptySpec({
        id: this.ids.create("spec"),
        key: semanticKey(name),
        label: name,
      }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const ownerMembership = membership(this.ids, stamp, context.actorId, workspace.id, ["owner"]);
    await this.catalog.transaction(async (transaction) => {
      await transaction.insertWorkspace(workspace);
      await transaction.insertMembership(ownerMembership);
    });
    return { workspace, membership: ownerMembership };
  }

  async createActor(context: ExecutionContext, input: CreateActorInput): Promise<Actor> {
    await this.assertContext(context);
    const origin = await this.requireWorkspace(context.workspaceId);
    await this.assertAuthorized({
      context,
      operation: "actors.create",
      resource: {
        kind: "workspace",
        id: origin.id,
        workspaceId: origin.id,
      },
    });
    const stamp = this.clock.now();
    const actor: Actor = {
      id: this.ids.create("actor"),
      originId: origin.id,
      rootId: origin.rootId,
      kind: input.kind,
      name: requiredName(input.name, "Actor"),
      ...(input.email === undefined ? {} : { email: input.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.catalog.transaction((transaction) => transaction.insertActor(actor));
    return actor;
  }

  async addMembership(
    context: ExecutionContext,
    input: { readonly actorId: string; readonly workspaceId: string; readonly roles?: string[] },
  ): Promise<Membership> {
    await this.assertContext(context);
    const actor = await this.requireActor(input.actorId);
    const workspace = await this.requireWorkspace(input.workspaceId);
    const active = await this.requireWorkspace(context.workspaceId);
    if (actor.rootId !== workspace.rootId || active.rootId !== workspace.rootId) {
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "Membership cannot cross root Workspace boundaries.",
      });
    }
    await this.assertAuthorized({
      context,
      operation: "memberships.create",
      resource: {
        kind: "workspace",
        id: workspace.id,
        workspaceId: workspace.id,
      },
    });
    if (await this.catalog.getMembership(actor.id, workspace.id)) {
      throw resourceConflict("The Actor is already a member of this Workspace.");
    }
    const next = membership(
      this.ids,
      this.clock.now(),
      actor.id,
      workspace.id,
      input.roles ?? ["member"],
    );
    await this.catalog.transaction((transaction) => transaction.insertMembership(next));
    return next;
  }

  async applySpec(context: ExecutionContext, input: unknown): Promise<Workspace> {
    await this.assertContext(context);
    assertValidSpec(input);
    const current = await this.requireWorkspace(context.workspaceId);
    await this.assertAuthorized({
      context,
      operation: "spec.update",
      resource: {
        kind: "workspace",
        id: context.workspaceId,
        workspaceId: context.workspaceId,
      },
    });
    const spec: Spec = structuredClone(input);
    await this.assertSchemaCompatible(current, spec);
    const workspace: Workspace = {
      ...current,
      spec,
      updatedAt: this.clock.now(),
    };
    await this.persistence.applyWorkspaceSpec(workspace);
    return workspace;
  }

  async createRecord(
    context: ExecutionContext,
    collectionKey: string,
    input: RecordValues,
  ): Promise<CollectionRecord> {
    const collection = await this.requireCollection(context, collectionKey);
    await this.assertAuthorized({
      context,
      operation: "records.create",
      resource: this.collectionResource(context, collection),
    });
    const values = prepareCreateValues(collection, input);
    await this.assertReferences(context, collection, values);
    const stamp = this.clock.now();
    const record: CollectionRecord = {
      id: this.ids.create("record"),
      collectionId: collection.id,
      values,
      createdAt: stamp,
      updatedAt: stamp,
      createdBy: context.actorId,
      updatedBy: context.actorId,
    };
    await this.persistence.records.create(context.workspaceId, collection, record);
    return record;
  }

  async getRecord(
    context: ExecutionContext,
    collectionKey: string,
    recordId: string,
  ): Promise<CollectionRecord | null> {
    const collection = await this.requireCollection(context, collectionKey);
    await this.assertAuthorized({
      context,
      operation: "records.read",
      resource: this.recordResource(context, collection, recordId),
    });
    return this.persistence.records.get(context.workspaceId, collection, recordId);
  }

  async listRecords(context: ExecutionContext, collectionKey: string): Promise<CollectionRecord[]> {
    const collection = await this.requireCollection(context, collectionKey);
    await this.assertAuthorized({
      context,
      operation: "records.list",
      resource: this.collectionResource(context, collection),
    });
    return this.persistence.records.list(context.workspaceId, collection);
  }

  async updateRecord(
    context: ExecutionContext,
    collectionKey: string,
    recordId: string,
    patch: RecordValues,
  ): Promise<CollectionRecord> {
    const collection = await this.requireCollection(context, collectionKey);
    await this.assertAuthorized({
      context,
      operation: "records.update",
      resource: this.recordResource(context, collection, recordId),
    });
    const current = await this.requireRecord(context.workspaceId, collection, recordId);
    const values = prepareUpdateValues(collection, current.values, patch);
    await this.assertReferences(context, collection, values);
    const record: CollectionRecord = {
      ...current,
      values,
      updatedAt: this.clock.now(),
      updatedBy: context.actorId,
    };
    await this.persistence.records.update(context.workspaceId, collection, record);
    return record;
  }

  async deleteRecord(
    context: ExecutionContext,
    collectionKey: string,
    recordId: string,
  ): Promise<void> {
    const collection = await this.requireCollection(context, collectionKey);
    await this.assertAuthorized({
      context,
      operation: "records.delete",
      resource: this.recordResource(context, collection, recordId),
    });
    await this.requireRecord(context.workspaceId, collection, recordId);
    await this.persistence.records.delete(context.workspaceId, collection, recordId);
  }

  async getWorkspace(
    context: ExecutionContext,
    id = context.workspaceId,
  ): Promise<Workspace | null> {
    await this.authorizeCatalogRead(context, "workspaces.read", id);
    return this.catalog.getWorkspace(id);
  }

  async listRootWorkspaces(context: ExecutionContext): Promise<Workspace[]> {
    await this.authorizeCatalogRead(context, "workspaces.listRoots");
    return this.catalog.listRootWorkspaces();
  }

  async listChildWorkspaces(
    context: ExecutionContext,
    parentId = context.workspaceId,
  ): Promise<Workspace[]> {
    await this.authorizeCatalogRead(context, "workspaces.listChildren", parentId);
    return this.catalog.listChildWorkspaces(parentId);
  }

  async listWorkspacesByRoot(context: ExecutionContext): Promise<Workspace[]> {
    await this.authorizeCatalogRead(context, "workspaces.listByRoot");
    const workspace = await this.requireWorkspace(context.workspaceId);
    return this.catalog.listWorkspacesByRoot(workspace.rootId);
  }

  async getActor(context: ExecutionContext, id: string): Promise<Actor | null> {
    await this.authorizeActorRead(context, "actors.read", id);
    return this.catalog.getActor(id);
  }

  async listActorsByOrigin(
    context: ExecutionContext,
    originId = context.workspaceId,
  ): Promise<Actor[]> {
    await this.authorizeCatalogRead(context, "actors.listByOrigin", originId);
    return this.catalog.listActorsByOrigin(originId);
  }

  async listActorsByRoot(context: ExecutionContext): Promise<Actor[]> {
    await this.assertContext(context);
    await this.assertAuthorized({
      context,
      operation: "actors.listByRoot",
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
    const workspace = await this.requireWorkspace(context.workspaceId);
    return this.catalog.listActorsByRoot(workspace.rootId);
  }

  async listMembers(
    context: ExecutionContext,
    workspaceId = context.workspaceId,
  ): Promise<Actor[]> {
    await this.authorizeCatalogRead(context, "actors.listMembers", workspaceId);
    return this.catalog.listMembers(workspaceId);
  }

  async listMembershipsForActor(context: ExecutionContext, actorId: string): Promise<Membership[]> {
    await this.authorizeActorRead(context, "memberships.listForActor", actorId);
    return this.catalog.listMembershipsForActor(actorId);
  }

  async listMembershipsForWorkspace(
    context: ExecutionContext,
    workspaceId = context.workspaceId,
  ): Promise<Membership[]> {
    await this.authorizeCatalogRead(context, "memberships.listForWorkspace", workspaceId);
    return this.catalog.listMembershipsForWorkspace(workspaceId);
  }

  async resolveContext(context: ExecutionContext): Promise<ExecutionContext> {
    await this.assertContext(context);
    return Object.freeze({ ...context });
  }

  close(): Promise<void> {
    return this.persistence.close();
  }

  private async authorizeCatalogRead(
    context: ExecutionContext,
    operation: string,
    workspaceId = context.workspaceId,
  ): Promise<void> {
    await this.assertContext(context);
    await this.assertAuthorized({
      context,
      operation,
      resource: { kind: "workspace", id: workspaceId, workspaceId },
    });
  }

  private async authorizeActorRead(
    context: ExecutionContext,
    operation: string,
    actorId: string,
  ): Promise<void> {
    await this.assertContext(context);
    await this.assertAuthorized({
      context,
      operation,
      resource: { kind: "actor", id: actorId, workspaceId: context.workspaceId },
    });
  }

  private async assertContext(context: ExecutionContext): Promise<void> {
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    const actor = await this.catalog.getActor(context.actorId);
    if (!actor) throw resourceNotFound("Actor", context.actorId);
    if (workspace.rootId !== actor.rootId) {
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "Execution context crosses root Workspace boundaries.",
      });
    }
    if (!(await this.catalog.getMembership(actor.id, workspace.id))) {
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "The execution Actor is not a member of this Workspace.",
      });
    }
  }

  private async assertAuthorized(request: AuthorizationRequest): Promise<void> {
    const decision = await this.authorizer.authorize(request);
    if (decision.allowed) return;
    throw new FrameworkError({
      code: ERROR_CODES.permissionDenied,
      message: decision.message ?? "The execution Actor is not allowed to perform this operation.",
    });
  }

  private async requireActor(id: string): Promise<Actor> {
    const actor = await this.catalog.getActor(id);
    if (!actor) throw resourceNotFound("Actor", id);
    return actor;
  }

  private async requireWorkspace(id: string): Promise<Workspace> {
    const workspace = await this.catalog.getWorkspace(id);
    if (!workspace) throw resourceNotFound("Workspace", id);
    return workspace;
  }

  private async requireCollection(
    context: ExecutionContext,
    key: string,
  ): Promise<CollectionDefinition> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const collection = workspace.spec.collections.find((candidate) => candidate.key === key);
    if (!collection) throw resourceNotFound("Collection", key);
    return collection;
  }

  private async requireRecord(
    workspaceId: string,
    collection: CollectionDefinition,
    recordId: string,
  ): Promise<CollectionRecord> {
    const record = await this.persistence.records.get(workspaceId, collection, recordId);
    if (!record) throw resourceNotFound("Record", recordId);
    return record;
  }

  private async assertReferences(
    context: ExecutionContext,
    collection: CollectionDefinition,
    values: RecordValues,
  ): Promise<void> {
    const workspace = await this.requireWorkspace(context.workspaceId);
    for (const field of collection.fields) {
      if (field.type !== "reference") continue;
      const value = values[field.key];
      const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      if (ids.length === 0) continue;
      const target = workspace.spec.collections.find(
        (candidate) => candidate.id === field.collectionId,
      );
      if (!target) throw resourceNotFound("Collection", field.collectionId);
      for (const id of ids) {
        if (
          typeof id !== "string" ||
          !(await this.persistence.records.get(workspace.id, target, id))
        ) {
          throw new FrameworkError({
            code: ERROR_CODES.validationInvalidInput,
            message: "Some record values need attention.",
            issues: [
              {
                path: `values.${field.key}`,
                code: "VALIDATION.REFERENCE_NOT_FOUND",
                message: `${field.label} refers to a record that does not exist.`,
              },
            ],
          });
        }
      }
    }
  }

  private async assertSchemaCompatible(current: Workspace, next: Spec): Promise<void> {
    const currentCollections = new Map(
      current.spec.collections.map((collection) => [collection.id, collection]),
    );
    for (const collection of next.collections) {
      const previous = currentCollections.get(collection.id);
      if (!previous) continue;
      const records = await this.persistence.records.list(current.id, previous);
      for (const record of records) {
        const values = prepareMigratedValues(previous, collection, record.values);
        await this.assertMigratedReferences(current, next, collection, values);
      }
    }
  }

  private async assertMigratedReferences(
    workspace: Workspace,
    next: Spec,
    collection: CollectionDefinition,
    values: RecordValues,
  ): Promise<void> {
    for (const field of collection.fields) {
      if (field.type !== "reference") continue;
      const value = values[field.key];
      const ids = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      if (ids.length === 0) continue;
      const nextTarget = next.collections.find((candidate) => candidate.id === field.collectionId);
      const currentTarget = workspace.spec.collections.find(
        (candidate) => candidate.id === field.collectionId,
      );
      if (!nextTarget || !currentTarget) {
        throw this.invalidMigratedReference(field.key, field.label);
      }
      for (const id of ids) {
        if (
          typeof id !== "string" ||
          !(await this.persistence.records.get(workspace.id, currentTarget, id))
        ) {
          throw this.invalidMigratedReference(field.key, field.label);
        }
      }
    }
  }

  private invalidMigratedReference(fieldKey: string, fieldLabel: string): FrameworkError {
    return new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "The Spec is incompatible with existing records.",
      issues: [
        {
          path: `values.${fieldKey}`,
          code: "VALIDATION.REFERENCE_NOT_FOUND",
          message: `${fieldLabel} refers to a record that does not exist.`,
        },
      ],
    });
  }

  private collectionResource(
    context: ExecutionContext,
    collection: CollectionDefinition,
  ): AuthorizationRequest["resource"] {
    return {
      kind: "collection",
      id: collection.id,
      workspaceId: context.workspaceId,
      collectionId: collection.id,
    };
  }

  private recordResource(
    context: ExecutionContext,
    collection: CollectionDefinition,
    recordId: string,
  ): AuthorizationRequest["resource"] {
    return {
      kind: "record",
      id: recordId,
      workspaceId: context.workspaceId,
      collectionId: collection.id,
    };
  }
}

function membership(
  ids: IdGenerator,
  stamp: string,
  actorId: string,
  workspaceId: string,
  roles: readonly string[],
): Membership {
  return {
    id: ids.create("membership"),
    actorId,
    workspaceId,
    roles: [...roles],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function requiredName(value: string, kind: string): string {
  const name = value.trim();
  if (!name) throw resourceConflict(`${kind} name is required.`);
  return name;
}
