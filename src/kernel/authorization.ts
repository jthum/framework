import type { CatalogRepository } from "../persistence/catalog.ts";
import type { Permission } from "./model.ts";
import type { ExecutionContext } from "./model.ts";

export interface AuthorizationResource {
  readonly kind:
    | "workspace"
    | "actor"
    | "membership"
    | "collection"
    | "record"
    | "attachment"
    | "view"
    | "form"
    | "page"
    | "rule"
    | "execution"
    | "actor_request"
    | "action";
  readonly id: string;
  readonly workspaceId?: string;
  readonly collectionId?: string;
  readonly attachmentId?: string;
}

export interface AuthorizationRequest {
  readonly context: ExecutionContext;
  readonly operation: string;
  readonly resource: AuthorizationResource;
}

export type AuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message?: string };

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export class AllowAllAuthorizer implements Authorizer {
  async authorize(_request: AuthorizationRequest): Promise<AuthorizationDecision> {
    return { allowed: true };
  }
}

/** Local Workspace ACL: Membership permissions or an Attachment-bounded `others` ceiling. */
export class WorkspaceAuthorizer implements Authorizer {
  constructor(private readonly catalog: CatalogRepository) {}

  async authorize(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    if (
      request.operation === "actors.update" &&
      request.resource.kind === "actor" &&
      request.resource.id === request.context.actorId
    )
      return { allowed: true };
    const workspaceId = request.resource.workspaceId ?? request.context.workspaceId;
    const workspace = await this.catalog.getWorkspace(workspaceId);
    if (!workspace) return denied("The resource Workspace does not exist.");
    const permission = requiredPermission(request.operation);
    const membership = await this.catalog.getMembership(request.context.actorId, workspaceId);
    if (membership)
      return membership.permissions.includes(permission) &&
        workspace.access.members.includes(permission)
        ? { allowed: true }
        : denied(`Membership does not grant ${permission} permission.`);
    if (!request.resource.attachmentId)
      return denied("The Actor is not a member of the resource Workspace.");
    const attachment = await this.catalog.getAttachment(request.resource.attachmentId);
    if (
      !attachment ||
      attachment.revokedAt !== undefined ||
      attachment.originId !== workspaceId ||
      attachment.targetId !== request.context.workspaceId ||
      (request.resource.collectionId !== undefined &&
        attachment.collectionId !== request.resource.collectionId) ||
      !attachment.permissions.some((grant) => grant === permission)
    )
      return denied("The resource is not granted by a live Attachment to this Workspace.");
    return workspace.access.others.includes(permission)
      ? { allowed: true }
      : denied(`The origin Workspace does not grant others ${permission} permission.`);
  }
}

const operationPermissions: Readonly<Record<string, Permission>> = {
  "actions.execute": "read",
  "actions.list": "read",
  "actions.manage": "manage",
  "actor_bindings.list": "read",
  "actor_bindings.manage": "manage",
  "actor_requests.inspect": "manage",
  "actor_requests.list": "read",
  "actor_requests.read": "read",
  "actor_requests.respond": "read",
  "actors.create": "manage",
  "actors.listByOrigin": "manage",
  "actors.listByRoot": "manage",
  "actors.listMembers": "manage",
  "actors.read": "read",
  "actors.update": "manage",
  "agent_configs.manage": "manage",
  "agent_configs.update": "manage",
  "agents.create": "manage",
  "attachments.accept": "manage",
  "attachments.create": "manage",
  "attachments.delete": "delete",
  "attachments.listFrom": "manage",
  "attachments.listTo": "manage",
  "attachments.read": "read",
  "attachments.reshare": "manage",
  "attachments.revoke": "manage",
  "attachments.update": "update",
  "executions.fail": "manage",
  "executions.inspect": "manage",
  "executions.list": "read",
  "executions.read": "read",
  "executions.resumeOther": "manage",
  "forms.list": "read",
  "forms.read": "read",
  "forms.submit": "read",
  "inference.run": "read",
  "memberships.create": "manage",
  "memberships.listForActor": "manage",
  "memberships.listForWorkspace": "manage",
  "memberships.update": "manage",
  "model_configs.create": "manage",
  "model_configs.delete": "manage",
  "model_configs.manage": "manage",
  "model_configs.update": "manage",
  "pages.list": "read",
  "pages.read": "read",
  "records.create": "create",
  "records.delete": "delete",
  "records.list": "read",
  "records.read": "read",
  "records.schema": "read",
  "records.update": "update",
  "rules.dispatch": "read",
  "rules.list": "read",
  "rules.resume": "read",
  "rules.run": "read",
  "scopes.delete": "manage",
  "scopes.read": "read",
  "scopes.update": "manage",
  "settings.delete": "manage",
  "settings.list": "read",
  "settings.read": "read",
  "settings.update": "manage",
  "spec.update": "manage",
  "views.list": "read",
  "views.preview": "read",
  "views.read": "read",
  "workspace.access.update": "manage",
  "workspace.delete": "manage",
  "workspace.policy.update": "manage",
  "workspace.update": "manage",
  "workspaces.create": "manage",
  "workspaces.listByRoot": "manage",
  "workspaces.listChildren": "manage",
  "workspaces.listRoots": "manage",
  "workspaces.read": "read",
};

function requiredPermission(operation: string): Permission {
  // Unknown host operations fail closed; no permission is inferred from a suffix.
  return Object.hasOwn(operationPermissions, operation)
    ? operationPermissions[operation]!
    : "manage";
}

function denied(message: string): AuthorizationDecision {
  return { allowed: false, message };
}
