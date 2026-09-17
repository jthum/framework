import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type {
  CatalogRepository,
  CollectionSeed,
  PersistenceAdapter,
  PersistenceSession,
} from "../persistence/catalog.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import {
  createEmptySpec,
  type CollectionDefinition,
  type FieldDefinition,
  type JsonValue,
  type SourceQueryDefinition,
  type Spec,
} from "../spec/model.ts";
import { assertValidSpec } from "../spec/validate.ts";
import {
  WorkspaceAuthorizer,
  type AuthorizationRequest,
  type Authorizer,
} from "./authorization.ts";
import {
  AttachmentService,
  type CreateAttachmentInput,
  type ReshareAttachmentInput,
} from "./attachments.ts";
import { SourceService } from "./sources.ts";
import type { SourceColumn, SourceRow } from "./sources.ts";
import { ViewService } from "./views.ts";
import {
  NanoIdGenerator,
  semanticKey,
  SystemClock,
  type Clock,
  type IdGenerator,
} from "./defaults.ts";
import { LOCAL_BROWSER_ENVIRONMENT, type EnvironmentProfile } from "./environment.ts";
import { FormService, type SubmitFormInput } from "./forms.ts";
import { PageService } from "./pages.ts";
import { ActionRegistry, type ActionDefinition } from "./action-registry.ts";
import {
  ConditionRegistry,
  coreConditions,
  type ConditionDefinition,
} from "./condition-registry.ts";
import {
  prepareCreateValues,
  prepareMigratedValues,
  prepareUpdateValues,
} from "./record-values.ts";
import {
  PERMISSIONS,
  type Actor,
  type ActorKind,
  type ExecutionContext,
  type Membership,
  type Permission,
  type Workspace,
  type WorkspaceAccess,
  type WorkspacePolicy,
} from "./model.ts";
import {
  RuleService,
  type ActorBindingRequest,
  type ActorBindingResolver,
  type RuleEvent,
  type RuleServiceOptions,
  type RunRuleInput,
} from "./rules.ts";

export interface KernelOptions {
  readonly persistence: PersistenceAdapter;
  readonly authorizer?: Authorizer;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly environment?: EnvironmentProfile;
  readonly actions?: readonly ActionDefinition[];
  readonly conditions?: readonly ConditionDefinition[];
  readonly resolveActorBinding?: ActorBindingResolver;
  readonly ruleExecution?: RuleServiceOptions;
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

export interface AddMembershipInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly Permission[];
}

export interface UpdateMembershipInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly roles?: readonly string[];
  readonly permissions: readonly Permission[];
}

export interface UpdateWorkspaceAccessInput {
  readonly members: readonly Permission[];
  readonly others: readonly Permission[];
}

export type UpdateWorkspacePolicyInput = WorkspacePolicy;

export class Kernel {
  private readonly attachments: AttachmentService;
  private readonly sources: SourceService;
  private readonly views: ViewService;
  private readonly forms: FormService;
  private readonly pages: PageService;
  private readonly rules: RuleService;
  private constructor(
    private readonly persistence: PersistenceSession,
    private readonly catalog: CatalogRepository,
    private readonly authorizer: Authorizer,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    readonly environment: EnvironmentProfile,
    actions: readonly ActionDefinition[],
    conditions: readonly ConditionDefinition[],
    resolveActorBinding: ActorBindingResolver | undefined,
    ruleExecution: RuleServiceOptions | undefined,
  ) {
    this.attachments = new AttachmentService(
      catalog,
      persistence.records,
      ids,
      clock,
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
    );
    this.sources = new SourceService(
      catalog,
      persistence.records,
      this.attachments,
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
    );
    this.views = new ViewService(
      catalog,
      this.sources,
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
    );
    this.forms = new FormService(
      catalog,
      {
        create: (context, collectionKey, values) =>
          this.createRecord(context, collectionKey, values),
        update: (context, collectionKey, recordId, values) =>
          this.updateRecord(context, collectionKey, recordId, values),
        assertReferences: (context, collection, values) =>
          this.assertReferences(context, collection, values),
      },
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
    );
    this.pages = new PageService(
      catalog,
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
    );
    this.rules = new RuleService(
      catalog,
      new ActionRegistry([...this.coreActions(), ...actions]),
      new ConditionRegistry([...coreConditions(), ...conditions]),
      this,
      (context) => this.assertContext(context),
      (request) => this.assertAuthorized(request),
      (context, sourceId, value) => this.resolveRuleSourceInput(context, sourceId, value),
      resolveActorBinding ?? ((request) => this.resolveRuleActor(request)),
      ruleExecution,
    );
  }

  createAttachment(context: ExecutionContext, input: CreateAttachmentInput) {
    return this.attachments.create(context, input);
  }

  reshareAttachment(context: ExecutionContext, input: ReshareAttachmentInput) {
    return this.attachments.reshare(context, input);
  }

  listAttachmentsTo(context: ExecutionContext) {
    return this.attachments.listTo(context);
  }
  listAttachmentsFrom(context: ExecutionContext) {
    return this.attachments.listFrom(context);
  }
  revokeAttachment(context: ExecutionContext, id: string) {
    return this.attachments.revoke(context, id);
  }
  listSources(context: ExecutionContext) {
    return this.sources.list(context);
  }
  getSource(context: ExecutionContext, key: string) {
    return this.sources.describe(context, key);
  }
  querySource(context: ExecutionContext, key: string, query?: SourceQueryDefinition) {
    return this.sources.query(context, key, query);
  }
  getSourceRecord(context: ExecutionContext, key: string, id: string) {
    return this.sources.get(context, key, id);
  }
  async updateSourceRecord(
    context: ExecutionContext,
    key: string,
    id: string,
    patch: RecordValues,
  ): Promise<CollectionRecord> {
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) return this.updateRecord(context, key, id, patch);
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    const target = await this.attachments.resolveMutation(context, key, "update", id);
    const originContext = { ...context, workspaceId: target.attachment.originId };
    return this.updateRecord(originContext, target.collection.key, id, patch);
  }
  async deleteSourceRecord(context: ExecutionContext, key: string, id: string): Promise<void> {
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) return this.deleteRecord(context, key, id);
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    const target = await this.attachments.resolveMutation(context, key, "delete", id);
    const originContext = { ...context, workspaceId: target.attachment.originId };
    return this.deleteRecord(originContext, target.collection.key, id);
  }
  listViews(context: ExecutionContext) {
    return this.views.list(context);
  }
  getView(context: ExecutionContext, key: string) {
    return this.views.get(context, key);
  }
  queryView(
    context: ExecutionContext,
    key: string,
    input?: import("../spec/model.ts").ViewQueryInput,
  ) {
    return this.views.query(context, key, input);
  }
  listForms(context: ExecutionContext) {
    return this.forms.list(context);
  }
  getForm(context: ExecutionContext, key: string) {
    return this.forms.get(context, key);
  }
  async submitForm(context: ExecutionContext, key: string, input: SubmitFormInput) {
    const submission = await this.forms.submit(context, key, input);
    const record = submission.mode === "standalone" ? undefined : recordValue(submission.record);
    await this.rules.dispatch(context, {
      event: "form.submitted",
      formId: submission.form.id,
      ...(submission.mode === "standalone" ? {} : { sourceId: submission.form.collectionId }),
      payload: {
        mode: submission.mode,
        values: {
          ...(submission.mode === "standalone" ? submission.values : submission.record.values),
        },
        ...(record === undefined ? {} : { record }),
      },
    });
    return submission;
  }
  listPages(context: ExecutionContext) {
    return this.pages.list(context);
  }
  getPage(context: ExecutionContext, key: string) {
    return this.pages.get(context, key);
  }
  runRule(context: ExecutionContext, key: string, input?: RunRuleInput) {
    return this.rules.run(context, key, input);
  }
  executeAction(
    context: ExecutionContext,
    key: string,
    input?: Readonly<Record<string, JsonValue>>,
  ) {
    return this.rules.executeAction(context, key, input);
  }
  dispatchEvent(context: ExecutionContext, event: RuleEvent) {
    return this.rules.dispatch(context, event);
  }
  listActionKeys() {
    return this.rules.actionKeys();
  }
  listConditionKeys() {
    return this.rules.conditionKeys();
  }
  getRuleRuntimeProfile(events?: ReadonlySet<string>) {
    return this.rules.profile(events);
  }

  static async open(options: KernelOptions): Promise<Kernel> {
    const persistence = await options.persistence.open();
    return new Kernel(
      persistence,
      persistence.catalog,
      options.authorizer ?? new WorkspaceAuthorizer(persistence.catalog),
      options.ids ?? new NanoIdGenerator(),
      options.clock ?? new SystemClock(),
      options.environment ?? LOCAL_BROWSER_ENVIRONMENT,
      options.actions ?? [],
      options.conditions ?? [],
      options.resolveActorBinding,
      options.ruleExecution,
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
      access: defaultAccess(),
      policy: defaultPolicy(),
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
      membership(this.ids, stamp, userId, workspaceId, ["owner"], PERMISSIONS),
      membership(this.ids, stamp, systemId, workspaceId, ["system"], PERMISSIONS),
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
    if (!parent.policy.spawn)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace does not permit spawning child Workspaces.",
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
      access: defaultAccess(),
      policy: defaultPolicy(),
      spec: createEmptySpec({
        id: this.ids.create("spec"),
        key: semanticKey(name),
        label: name,
      }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const ownerMembership = membership(
      this.ids,
      stamp,
      context.actorId,
      workspace.id,
      ["owner"],
      PERMISSIONS,
    );
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
    if (!origin.policy.createActors)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace does not permit creating local Actors.",
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

  async addMembership(context: ExecutionContext, input: AddMembershipInput): Promise<Membership> {
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
      input.permissions ?? ["read"],
    );
    await this.catalog.transaction((transaction) => transaction.insertMembership(next));
    return next;
  }

  async updateMembership(
    context: ExecutionContext,
    input: UpdateMembershipInput,
  ): Promise<Membership> {
    await this.assertContext(context);
    const current = await this.catalog.getMembership(input.actorId, input.workspaceId);
    if (!current) throw resourceNotFound("Membership", `${input.actorId}:${input.workspaceId}`);
    await this.assertAuthorized({
      context,
      operation: "memberships.update",
      resource: {
        kind: "membership",
        id: current.id,
        workspaceId: current.workspaceId,
      },
    });
    const membership: Membership = {
      ...current,
      roles: input.roles === undefined ? current.roles : [...input.roles],
      permissions: normalizePermissions(input.permissions),
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateMembership(membership));
    return membership;
  }

  async updateWorkspaceAccess(
    context: ExecutionContext,
    input: UpdateWorkspaceAccessInput,
  ): Promise<Workspace> {
    await this.assertContext(context);
    const current = await this.requireWorkspace(context.workspaceId);
    await this.assertAuthorized({
      context,
      operation: "workspace.access.update",
      resource: { kind: "workspace", id: current.id, workspaceId: current.id },
    });
    const workspace: Workspace = {
      ...current,
      access: {
        members: normalizePermissions(input.members),
        others: normalizePermissions(input.others),
      },
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
    return workspace;
  }

  async updateWorkspacePolicy(
    context: ExecutionContext,
    policy: UpdateWorkspacePolicyInput,
  ): Promise<Workspace> {
    await this.assertContext(context);
    const current = await this.requireWorkspace(context.workspaceId);
    await this.assertAuthorized({
      context,
      operation: "workspace.policy.update",
      resource: { kind: "workspace", id: current.id, workspaceId: current.id },
    });
    const workspace: Workspace = {
      ...current,
      policy: { ...policy },
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
    return workspace;
  }

  async applySpec(context: ExecutionContext, input: unknown): Promise<Workspace> {
    return this.applySpecChange(context, input);
  }

  private async applySpecChange(
    context: ExecutionContext,
    input: unknown,
    seeds: readonly CollectionSeed[] = [],
  ): Promise<Workspace> {
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
    await this.assertSchemaCompatible(context, current, spec);
    const workspace: Workspace = {
      ...current,
      spec,
      updatedAt: this.clock.now(),
    };
    await this.persistence.applyWorkspaceSpec(workspace, seeds);
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

  private coreActions(): readonly ActionDefinition[] {
    return [
      {
        key: "records.create",
        run: async ({ context, input, runtime, publish }) => {
          const collection = await this.actionCollection(context, input);
          const values = actionValues(input.values, "values");
          const record = await runtime.createRecord(context, collection.key, values);
          const output = recordValue(record);
          await publish({
            event: "record.created",
            sourceId: collection.id,
            payload: { record: output, recordId: record.id },
          });
          return output;
        },
      },
      {
        key: "records.get",
        run: async ({ context, input, runtime }) => {
          const target = await this.actionRecordTarget(context, input);
          const record = await runtime.getSourceRecord(context, target.source.key, target.recordId);
          return record ? sourceRecordValue(record.id, target.source.id, record.values) : null;
        },
      },
      {
        key: "records.list",
        run: async ({ context, input }) => {
          const source = await this.actionSource(context, input);
          return (await this.sources.query(context, source.key)).rows.map((record) =>
            sourceRecordValue(record.id, source.id, record.values),
          );
        },
      },
      {
        key: "records.update",
        run: async ({ context, input, runtime, publish }) => {
          const target = await this.actionRecordTarget(context, input);
          const values = actionValues(input.values, "values");
          const previous = await runtime.getSourceRecord(
            context,
            target.source.key,
            target.recordId,
          );
          if (!previous) throw resourceNotFound("Record", target.recordId);
          const record = await runtime.updateSourceRecord(
            context,
            target.source.key,
            target.recordId,
            values,
          );
          const output = recordValue(record, target.source.id);
          await publish({
            event: "record.updated",
            sourceId: target.source.id,
            payload: {
              record: output,
              recordId: record.id,
              previous: sourceRecordValue(previous.id, target.source.id, previous.values),
            },
          });
          for (const field of target.source.schema.fields)
            if (
              field.key in values &&
              JSON.stringify(previous.values[field.key]) !==
                JSON.stringify(record.values[field.key])
            )
              await publish({
                event: "record.field_changed",
                sourceId: target.source.id,
                fieldId: field.id,
                payload: {
                  record: output,
                  recordId: record.id,
                  previous: previous.values[field.key] ?? null,
                  value: record.values[field.key] ?? null,
                },
              });
          return output;
        },
      },
      {
        key: "records.delete",
        run: async ({ context, input, runtime, publish }) => {
          const target = await this.actionRecordTarget(context, input);
          const record = await runtime.getSourceRecord(context, target.source.key, target.recordId);
          if (!record) throw resourceNotFound("Record", target.recordId);
          await runtime.deleteSourceRecord(context, target.source.key, target.recordId);
          await publish({
            event: "record.deleted",
            sourceId: target.source.id,
            payload: {
              record: sourceRecordValue(record.id, target.source.id, record.values),
              recordId: record.id,
            },
          });
          return { id: target.recordId };
        },
      },
      {
        key: "views.snapshot",
        run: async ({ context, input, publish }) => {
          const workspace = await this.requireWorkspace(context.workspaceId);
          const viewId = requiredActionString(input.viewId, "viewId");
          const view = workspace.spec.views.find((candidate) => candidate.id === viewId);
          if (!view) throw resourceNotFound("View", viewId);
          const label = requiredActionString(input.label, "label");
          const key =
            input.key === undefined
              ? semanticKey(label, "snapshot")
              : requiredActionString(input.key, "key");
          if (workspace.spec.collections.some((collection) => collection.key === key))
            throw resourceConflict(`Collection key ${key} is already in use.`);
          const parameters = optionalActionObject(input.parameters, "parameters");
          const meta = optionalActionObject(input.meta, "meta");
          const result = await this.views.query(
            context,
            view.key,
            parameters === undefined ? {} : { parameters },
          );
          const fields = snapshotFields(result.data.columns, result.data.rows, this.ids);
          const titleFieldId = firstTextFieldId(fields);
          const collection: CollectionDefinition = {
            id: this.ids.create("definition"),
            key,
            label,
            ...(typeof input.description === "string" && input.description.trim()
              ? { description: input.description.trim() }
              : {}),
            ...(meta === undefined ? {} : { meta: structuredClone(meta) }),
            fields,
            ...(titleFieldId === undefined ? {} : { titleFieldId }),
          };
          await this.assertAuthorized({
            context,
            operation: "records.create",
            resource: this.collectionResource(context, collection),
          });
          const stamp = this.clock.now();
          const records: CollectionRecord[] = [];
          for (const row of result.data.rows) {
            const values = prepareCreateValues(collection, row.values);
            await this.assertReferences(context, collection, values);
            records.push({
              id: this.ids.create("record"),
              collectionId: collection.id,
              values,
              createdAt: stamp,
              updatedAt: stamp,
              createdBy: context.actorId,
              updatedBy: context.actorId,
            });
          }
          await this.applySpecChange(
            context,
            {
              ...workspace.spec,
              collections: [...workspace.spec.collections, collection],
            },
            [{ collection, records }],
          );
          const output: JsonValue = {
            collectionId: collection.id,
            collectionKey: collection.key,
            recordIds: records.map((record) => record.id),
            count: records.length,
          };
          await publish({
            event: "snapshot.created",
            sourceId: collection.id,
            payload: { snapshot: output, viewId },
          });
          return output;
        },
      },
    ];
  }

  private async actionCollection(
    context: ExecutionContext,
    input: Readonly<Record<string, JsonValue>>,
  ): Promise<CollectionDefinition> {
    const source = await this.actionSource(context, input);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const collection = workspace.spec.collections.find((candidate) => candidate.id === source.id);
    if (!collection)
      throw new FrameworkError({
        code: ERROR_CODES.persistenceUnsupported,
        message: "Creating records through an attached Source is not supported yet.",
        details: { sourceId: source.id },
      });
    return collection;
  }

  private async actionSource(
    context: ExecutionContext,
    input: Readonly<Record<string, JsonValue>>,
  ): Promise<{ id: string; key: string; schema: CollectionDefinition }> {
    const sourceId =
      typeof input.sourceId === "string" ? input.sourceId : actionRecord(input.record)?.sourceId;
    if (!sourceId) throw actionInputError("A record Action requires sourceId or a record value.");
    const workspace = await this.requireWorkspace(context.workspaceId);
    const definition = sourceDefinition(workspace.spec, sourceId);
    if (!definition) throw resourceNotFound("Source", sourceId);
    const descriptor = await this.sources.describe(context, definition.key);
    if (!descriptor) throw resourceNotFound("Source", sourceId);
    return { id: sourceId, key: definition.key, schema: descriptor.schema };
  }

  private async actionRecordTarget(
    context: ExecutionContext,
    input: Readonly<Record<string, JsonValue>>,
  ): Promise<{
    source: { id: string; key: string; schema: CollectionDefinition };
    recordId: string;
  }> {
    const record = actionRecord(input.record);
    const recordId = typeof input.recordId === "string" ? input.recordId : record?.id;
    if (!recordId) throw actionInputError("A record Action requires recordId or a record value.");
    return { source: await this.actionSource(context, input), recordId };
  }

  private async resolveRuleSourceInput(
    context: ExecutionContext,
    sourceId: string,
    value: JsonValue,
  ): Promise<JsonValue> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = actionRecord(value);
      if (record?.id && record.sourceId === sourceId) return structuredClone(value);
    }
    if (typeof value !== "string")
      throw actionInputError("A Source Rule input must be a record ID or resolved record value.");
    const workspace = await this.requireWorkspace(context.workspaceId);
    const source = sourceDefinition(workspace.spec, sourceId);
    if (!source) throw resourceNotFound("Source", sourceId);
    const record = await this.sources.get(context, source.key, value);
    if (!record) throw resourceNotFound("Record", value);
    return { ...record.values, id: record.id, sourceId, values: { ...record.values } };
  }

  private async resolveRuleActor(request: ActorBindingRequest): Promise<string> {
    if (request.binding !== "system")
      throw new FrameworkError({
        code: ERROR_CODES.persistenceUnsupported,
        message: `The ${request.binding} Actor binding is not installed in this runtime.`,
        details: { binding: request.binding },
      });
    const system = (await this.catalog.listMembers(request.context.workspaceId)).find(
      (actor) => actor.kind === "system",
    );
    if (!system)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace has no System Actor membership.",
      });
    return system.id;
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
      const target = sourceDefinition(workspace.spec, field.sourceId);
      if (!target || ids.some((id) => typeof id !== "string"))
        throw this.invalidReference(field.key, field.label);
      const records = await this.sources.getMany(context, target.key, ids as string[]);
      const found = new Set(records.map((record) => record.id));
      if (ids.some((id) => !found.has(id as string))) {
        throw this.invalidReference(field.key, field.label);
      }
    }
  }

  private async assertSchemaCompatible(
    context: ExecutionContext,
    current: Workspace,
    next: Spec,
  ): Promise<void> {
    const currentCollections = new Map(
      current.spec.collections.map((collection) => [collection.id, collection]),
    );
    for (const collection of next.collections) {
      const previous = currentCollections.get(collection.id);
      if (!previous) continue;
      const records = await this.persistence.records.list(current.id, previous);
      for (const record of records) {
        const values = prepareMigratedValues(previous, collection, record.values);
        await this.assertMigratedReferences(context, current, next, collection, values);
      }
    }
  }

  private async assertMigratedReferences(
    context: ExecutionContext,
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
      const nextTarget = sourceDefinition(next, field.sourceId);
      const currentTarget = sourceDefinition(workspace.spec, field.sourceId);
      if (!nextTarget || !currentTarget) {
        throw this.invalidReference(field.key, field.label, true);
      }
      if (ids.some((id) => typeof id !== "string"))
        throw this.invalidReference(field.key, field.label, true);
      const records = await this.sources.getMany(context, currentTarget.key, ids as string[]);
      const found = new Set(records.map((record) => record.id));
      if (ids.some((id) => !found.has(id as string))) {
        throw this.invalidReference(field.key, field.label, true);
      }
    }
  }

  private invalidReference(
    fieldKey: string,
    fieldLabel: string,
    migration = false,
  ): FrameworkError {
    return new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: migration
        ? "The Spec is incompatible with existing records."
        : "Some record values need attention.",
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

function sourceDefinition(
  spec: Spec,
  id: string,
): Spec["collections"][number] | Spec["sources"][number] | undefined {
  return (
    spec.collections.find((collection) => collection.id === id) ??
    spec.sources.find((source) => source.id === id)
  );
}

function membership(
  ids: IdGenerator,
  stamp: string,
  actorId: string,
  workspaceId: string,
  roles: readonly string[],
  permissions: readonly Permission[],
): Membership {
  return {
    id: ids.create("membership"),
    actorId,
    workspaceId,
    roles: [...roles],
    permissions: [...permissions],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function defaultAccess(): WorkspaceAccess {
  return { members: [...PERMISSIONS], others: [] };
}

function defaultPolicy(): WorkspacePolicy {
  return { spawn: true, createActors: true, reshare: false };
}

function normalizePermissions(permissions: readonly Permission[]): Permission[] {
  if (permissions.some((permission) => !PERMISSIONS.includes(permission)))
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "Workspace access contains an unsupported permission.",
    });
  return PERMISSIONS.filter((permission) => permissions.includes(permission));
}

function requiredName(value: string, kind: string): string {
  const name = value.trim();
  if (!name) throw resourceConflict(`${kind} name is required.`);
  return name;
}

function actionRecord(
  value: JsonValue | undefined,
): { id?: string; sourceId?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
  };
}

function actionValues(value: JsonValue | undefined, name: string): RecordValues {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw actionInputError(`A record Action requires an object at ${name}.`);
  return value;
}

function recordValue(record: CollectionRecord, sourceId = record.collectionId): JsonValue {
  return {
    id: record.id,
    sourceId,
    values: { ...record.values },
    ...record.values,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

function sourceRecordValue(id: string, sourceId: string, values: RecordValues): JsonValue {
  return { ...values, id, sourceId, values: { ...values } };
}

function actionInputError(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message });
}

function requiredActionString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw actionInputError(`Action input ${name} must be a non-empty string.`);
  return value.trim();
}

function optionalActionObject(
  value: JsonValue | undefined,
  name: string,
): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw actionInputError(`Action input ${name} must be an object.`);
  return value;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function snapshotFields(
  columns: readonly SourceColumn[],
  rows: readonly SourceRow[],
  ids: IdGenerator,
): FieldDefinition[] {
  const keys = new Set<string>();
  return columns.map((column) => {
    const base = semanticKey(column.key || column.label, "field");
    let key = base;
    for (let suffix = 2; keys.has(key); suffix += 1) key = `${base}_${suffix}`;
    keys.add(key);
    return {
      id: ids.create("definition"),
      key,
      label: column.label,
      type: snapshotFieldType(column, rows),
    } as FieldDefinition;
  });
}

function snapshotFieldType(
  column: SourceColumn,
  rows: readonly SourceRow[],
): FieldDefinition["type"] {
  if (column.type === "json" || column.type === "reference") return "json";
  if (
    rows.some((row) => {
      const value = row.values[column.key];
      return Boolean(value && typeof value === "object");
    })
  )
    return "json";
  if (column.type === "choice") return "text";
  return column.type;
}

function firstTextFieldId(fields: readonly FieldDefinition[]): string | undefined {
  return fields.find((field) => field.type === "text")?.id;
}
