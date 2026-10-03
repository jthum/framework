/** Numeric durations are seconds; strings require an explicit unit. */
export function durationMilliseconds(value: unknown): number | undefined {
  let milliseconds: number;
  if (typeof value === "number") milliseconds = value * 1000;
  else if (typeof value === "string") {
    const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(value.trim());
    if (!match) return undefined;
    const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    milliseconds = Number(match[1]) * units[match[2]!]!;
  } else return undefined;
  return Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 8.64e15
    ? milliseconds
    : undefined;
}
