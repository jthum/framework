import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import { type IdGenerator } from "./defaults.ts";
import {
  PERMISSIONS,
  type Membership,
  type Permission,
  type WorkspaceAccess,
  type WorkspacePolicy,
} from "./model.ts";

export function membership(
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

export function defaultAccess(): WorkspaceAccess {
  return { members: [...PERMISSIONS], others: [] };
}

export function defaultPolicy(): WorkspacePolicy {
  return { spawn: true, createActors: true, reshare: false };
}

export function normalizePermissions(permissions: readonly Permission[]): Permission[] {
  if (permissions.some((permission) => !PERMISSIONS.includes(permission)))
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "Workspace access contains an unsupported permission.",
    });
  return PERMISSIONS.filter((permission) => permissions.includes(permission));
}

export function requiredName(value: string, kind: string): string {
  const name = value.trim();
  if (!name) throw resourceConflict(`${kind} name is required.`);
  return name;
}
