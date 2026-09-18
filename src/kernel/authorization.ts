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
    return workspace.access.others.includes(permission)
      ? { allowed: true }
      : denied(`The origin Workspace does not grant others ${permission} permission.`);
  }
}

function requiredPermission(operation: string): Permission {
  if (
    operation === "workspaces.listRoots" ||
    operation === "workspaces.listByRoot" ||
    operation === "actors.listByRoot"
  )
    return "manage";
  if (operation === "records.create") return "create";
  if (operation === "records.update") return "update";
  if (operation === "records.delete") return "delete";
  if (
    operation === "records.read" ||
    operation === "records.list" ||
    operation === "records.schema" ||
    operation === "attachments.read" ||
    operation.endsWith(".read") ||
    operation.endsWith(".list") ||
    operation === "rules.run" ||
    operation === "rules.resume" ||
    operation === "actor_requests.respond" ||
    operation === "rules.dispatch" ||
    operation === "inference.run" ||
    operation === "actions.execute" ||
    operation === "forms.submit"
  )
    return "read";
  if (operation === "attachments.update") return "update";
  if (operation === "attachments.delete") return "delete";
  return "manage";
}

function denied(message: string): AuthorizationDecision {
  return { allowed: false, message };
}
