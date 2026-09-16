import type { ExecutionContext } from "./model.ts";

export interface AuthorizationResource {
  readonly kind:
    | "workspace"
    | "actor"
    | "membership"
    | "collection"
    | "record"
    | "attachment"
    | "view";
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
