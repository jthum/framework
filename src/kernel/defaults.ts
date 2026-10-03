import { nanoid } from "nanoid";
import { keyFromLabel } from "../spec/identity.ts";

export type IdKind =
  | "actor"
  | "actor_request"
  | "attachment"
  | "definition"
  | "membership"
  | "model_config"
  | "record"
  | "execution"
  | "wait"
  | "spec"
  | "workspace";

export interface IdGenerator {
  create(kind: IdKind): string;
}

export interface Clock {
  now(): string;
}

export class NanoIdGenerator implements IdGenerator {
  create(kind: IdKind): string {
    return nanoid(kind === "definition" || kind === "spec" ? 16 : 21);
  }
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export function semanticKey(value: string, fallback = "workspace"): string {
  return keyFromLabel(value, fallback);
}
