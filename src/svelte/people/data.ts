import type { Actor, Permission } from "../../kernel/model.ts";

/** Presentation shortcuts, not roles or an authorization policy. */
export const ACCESS_PRESETS: readonly {
  value: string;
  label: string;
  permissions: readonly Permission[];
}[] = [
  { value: "none", label: "No access", permissions: [] },
  { value: "viewer", label: "Viewer", permissions: ["read"] },
  { value: "editor", label: "Editor", permissions: ["read", "create", "update", "delete"] },
  {
    value: "manager",
    label: "Manager",
    permissions: ["read", "create", "update", "delete", "manage"],
  },
];

export function accessPreset(permissions: readonly Permission[]): string {
  return (
    ACCESS_PRESETS.find(
      (preset) =>
        preset.permissions.length === permissions.length &&
        preset.permissions.every((permission) => permissions.includes(permission)),
    )?.value ?? "custom"
  );
}

export function accessLabel(permissions: readonly Permission[]): string {
  return (
    ACCESS_PRESETS.find((preset) => preset.value === accessPreset(permissions))?.label ??
    "Custom access"
  );
}

export interface PersonRow {
  readonly actor: Pick<Actor, "id" | "name" | "kind" | "email">;
  readonly permissions: readonly Permission[];
}
