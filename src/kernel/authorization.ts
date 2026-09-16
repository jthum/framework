import type { ExecutionContext } from "./model.ts";

export interface AuthorizationResource {
  readonly kind: "account" | "workspace" | "actor" | "membership";
  readonly id: string;
  readonly accountId: string;
  readonly workspaceId?: string;
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
