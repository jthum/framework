/** Readable handles are distinct from opaque durable IDs. */
export const semanticKeyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function keyFromLabel(value: string, fallback = "workspace"): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const result = key || fallback;
  return /^[a-z]/.test(result) ? result : `item_${result}`;
}
