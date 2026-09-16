import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { CatalogRepository, PersistenceAdapter } from "../persistence/catalog.ts";
import { createEmptySpec } from "../spec/model.ts";
import { AllowAllAuthorizer, type AuthorizationRequest, type Authorizer } from "./authorization.ts";
import {
  NanoIdGenerator,
  semanticKey,
  SystemClock,
  type Clock,
  type IdGenerator,
} from "./defaults.ts";
import { LOCAL_BROWSER_ENVIRONMENT, type EnvironmentProfile } from "./environment.ts";
import type {
  Account,
  Actor,
  ActorKind,
  ExecutionContext,
  Membership,
  Workspace,
} from "./model.ts";

export interface KernelOptions {
  readonly persistence: PersistenceAdapter;
  readonly authorizer?: Authorizer;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly environment?: EnvironmentProfile;
}

export interface CreateAccountInput {
  readonly name: string;
  readonly user: {
    readonly name: string;
    readonly email?: string;
  };
}

export interface AccountBootstrap {
  readonly account: Account;
  readonly sharedWorkspace: Workspace;
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
  private constructor(
    private readonly catalog: CatalogRepository,
    private readonly authorizer: Authorizer,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    readonly environment: EnvironmentProfile,
  ) {}

  static async open(options: KernelOptions): Promise<Kernel> {
    return new Kernel(
      await options.persistence.openCatalog(),
      options.authorizer ?? new AllowAllAuthorizer(),
      options.ids ?? new NanoIdGenerator(),
      options.clock ?? new SystemClock(),
      options.environment ?? LOCAL_BROWSER_ENVIRONMENT,
    );
  }

  async createAccount(input: CreateAccountInput): Promise<AccountBootstrap> {
    const name = requiredName(input.name, "Account");
    const userName = requiredName(input.user.name, "User");
    const stamp = this.clock.now();
    const accountId = this.ids.create("account");
    const workspaceId = this.ids.create("workspace");
    const userId = this.ids.create("actor");
    const systemId = this.ids.create("actor");
    const account: Account = {
      id: accountId,
      name,
      sharedWorkspaceId: workspaceId,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const sharedWorkspace: Workspace = {
      id: workspaceId,
      accountId,
      name,
      spec: createEmptySpec({
        id: this.ids.create("spec"),
        key: semanticKey(name, "shared"),
        label: name,
      }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const user: Actor = {
      id: userId,
      accountId,
      kind: "user",
      name: userName,
      ...(input.user.email === undefined ? {} : { email: input.user.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const system: Actor = {
      id: systemId,
      accountId,
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
      await transaction.insertAccount(account);
      await transaction.insertWorkspace(sharedWorkspace);
      await transaction.insertActor(user);
      await transaction.insertActor(system);
      await transaction.insertMembership(memberships[0]);
      await transaction.insertMembership(memberships[1]);
    });

    return { account, sharedWorkspace, user, system, memberships };
  }

  async createWorkspace(
    context: ExecutionContext,
    input: CreateWorkspaceInput,
  ): Promise<{ workspace: Workspace; membership: Membership }> {
    await this.assertContext(context);
    await this.assertAuthorized({
      context,
      operation: "workspaces.create",
      resource: { kind: "account", id: context.accountId, accountId: context.accountId },
    });

    const name = requiredName(input.name, "Workspace");
    const stamp = this.clock.now();
    const workspace: Workspace = {
      id: this.ids.create("workspace"),
      accountId: context.accountId,
      name,
      createdByActorId: context.actorId,
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
    await this.assertAuthorized({
      context,
      operation: "actors.create",
      resource: { kind: "account", id: context.accountId, accountId: context.accountId },
    });
    const stamp = this.clock.now();
    const actor: Actor = {
      id: this.ids.create("actor"),
      accountId: context.accountId,
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
    if (actor.accountId !== context.accountId || workspace.accountId !== context.accountId) {
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "Membership cannot cross Account boundaries.",
      });
    }
    await this.assertAuthorized({
      context,
      operation: "memberships.create",
      resource: {
        kind: "workspace",
        id: workspace.id,
        accountId: workspace.accountId,
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

  getAccount(id: string): Promise<Account | null> {
    return this.catalog.getAccount(id);
  }

  listAccounts(): Promise<Account[]> {
    return this.catalog.listAccounts();
  }

  getWorkspace(id: string): Promise<Workspace | null> {
    return this.catalog.getWorkspace(id);
  }

  listWorkspaces(accountId: string): Promise<Workspace[]> {
    return this.catalog.listWorkspaces(accountId);
  }

  getActor(id: string): Promise<Actor | null> {
    return this.catalog.getActor(id);
  }

  listActors(accountId: string): Promise<Actor[]> {
    return this.catalog.listActors(accountId);
  }

  listMembershipsForActor(actorId: string): Promise<Membership[]> {
    return this.catalog.listMembershipsForActor(actorId);
  }

  listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]> {
    return this.catalog.listMembershipsForWorkspace(workspaceId);
  }

  async resolveContext(context: ExecutionContext): Promise<ExecutionContext> {
    await this.assertContext(context);
    return Object.freeze({ ...context });
  }

  close(): Promise<void> {
    return this.catalog.close();
  }

  private async assertContext(context: ExecutionContext): Promise<void> {
    const account = await this.catalog.getAccount(context.accountId);
    if (!account) throw resourceNotFound("Account", context.accountId);
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    const actor = await this.catalog.getActor(context.actorId);
    if (!actor) throw resourceNotFound("Actor", context.actorId);
    if (workspace.accountId !== account.id || actor.accountId !== account.id) {
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "Execution context crosses Account boundaries.",
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
