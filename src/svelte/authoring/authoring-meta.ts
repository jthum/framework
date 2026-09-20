import type { SpecMeta } from "@jthum/framework/spec";

function authoringValue(meta: SpecMeta | undefined): Record<string, unknown> {
  const value = meta?.authoring;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Presentation convention only; the Kernel assigns no behavior to managed resources. */
export function isAuthoringManaged(meta: SpecMeta | undefined): boolean {
  return authoringValue(meta).managed === true;
}

export function withAuthoringManaged(
  meta: SpecMeta | undefined,
  managed: boolean | undefined,
): SpecMeta | undefined {
  const authoring = { ...authoringValue(meta) };
  if (managed) authoring.managed = true;
  else delete authoring.managed;
  const next = { ...meta };
  if (Object.keys(authoring).length) next.authoring = authoring as SpecMeta;
  else delete next.authoring;
  return Object.keys(next).length ? next : undefined;
}
