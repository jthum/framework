import { invalidInput } from "../errors/error.ts";
import {
  PERMISSIONS,
  type Actor,
  type ActorKind,
  type Membership,
  type Permission,
} from "./model.ts";

export interface MemberQuery {
  readonly search?: string | undefined;
  readonly kind?: ActorKind | undefined;
  readonly permission?: Permission | "none" | undefined;
  /** Require readable membership in another explicitly authorized Workspace. */
  readonly memberOf?: string | undefined;
  readonly sort?: "name_asc" | "name_desc" | "newest" | "oldest" | undefined;
  readonly limit?: number;
  readonly offset?: number;
}

export interface WorkspaceMember {
  readonly actor: Actor;
  readonly membership: Membership;
}

export interface MemberPage {
  readonly members: readonly WorkspaceMember[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export function normalizeMemberQuery(query: MemberQuery): MemberQuery {
  const limit = query.limit ?? 25;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw invalidInput("Member query limit must be between 1 and 100.");
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw invalidInput("Member query offset must be a non-negative safe integer.");
  if (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 200))
    throw invalidInput("Member search must be at most 200 characters.");
  if (query.kind !== undefined && !["user", "agent", "system"].includes(query.kind))
    throw invalidInput("Unknown Actor kind.");
  if (
    query.permission !== undefined &&
    query.permission !== "none" &&
    !PERMISSIONS.includes(query.permission)
  )
    throw invalidInput("Unknown member permission.");
  if (
    query.sort !== undefined &&
    !["name_asc", "name_desc", "newest", "oldest"].includes(query.sort)
  )
    throw invalidInput("Unknown member sort order.");
  if (query.memberOf !== undefined && (typeof query.memberOf !== "string" || !query.memberOf))
    throw invalidInput("Choose a Workspace for the membership filter.");
  return { ...query, search: query.search?.trim(), limit, offset };
}
