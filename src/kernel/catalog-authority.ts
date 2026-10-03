import type { AuthorizationRequest } from "./authorization.ts";
import type { Actor, ExecutionContext, Workspace } from "./model.ts";
import type { Spec } from "../spec/model.ts";

/** Trusted policy seams shared by catalog and definition lifecycle services. */
export interface CatalogAuthority {
  assertContext(context: ExecutionContext): Promise<void>;
  assertAuthorized(request: AuthorizationRequest): Promise<void>;
  requireWorkspace(id: string): Promise<Workspace>;
  requireActor(id: string): Promise<Actor>;
  resolveWorkspace(context: ExecutionContext): Promise<Workspace>;
  assertSchemaCompatible(context: ExecutionContext, current: Workspace, spec: Spec): Promise<void>;
}
