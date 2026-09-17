import type { SpecMeta } from "@jthum/framework/spec";

function studioValue(meta: SpecMeta | undefined): Record<string, unknown> {
  const value = meta?.studio;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Presentation convention only; the Kernel assigns no behavior to managed resources. */
export function isStudioManaged(meta: SpecMeta | undefined): boolean {
  return studioValue(meta).managed === true;
}

export function withStudioManaged(
  meta: SpecMeta | undefined,
  managed: boolean | undefined,
): SpecMeta | undefined {
  const studio = { ...studioValue(meta) };
  if (managed) studio.managed = true;
  else delete studio.managed;
  const next = { ...meta };
  if (Object.keys(studio).length) next.studio = studio as SpecMeta;
  else delete next.studio;
  return Object.keys(next).length ? next : undefined;
}
