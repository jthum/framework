import { nanoid } from "nanoid";

export type IdKind = "account" | "actor" | "membership" | "spec" | "workspace";

export interface IdGenerator {
  create(kind: IdKind): string;
}

export interface Clock {
  now(): string;
}

export class NanoIdGenerator implements IdGenerator {
  create(kind: IdKind): string {
    return nanoid(kind === "spec" ? 16 : 21);
  }
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export function semanticKey(value: string, fallback = "workspace"): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return key || fallback;
}
