import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import type { BlockDefinition, BlockModule, BlockRegistration } from "./model.ts";

/** Metadata stays eager and tiny; renderer code is loaded and cached only on demand. */
export class BlockRegistry<Renderer = unknown> {
  private readonly registrations = new Map<string, BlockRegistration<Renderer>>();
  private readonly modules = new Map<string, Promise<BlockModule<Renderer>>>();

  constructor(registrations: readonly BlockRegistration<Renderer>[] = []) {
    registrations.forEach((registration) => this.register(registration));
  }

  register(registration: BlockRegistration<Renderer>): void {
    if (this.registrations.has(registration.definition.key)) {
      throw resourceConflict(`Block ${registration.definition.key} is already registered.`);
    }
    this.registrations.set(registration.definition.key, registration);
  }

  list(category?: string): BlockDefinition[] {
    return [...this.registrations.values()]
      .map(({ definition }) => structuredClone(definition))
      .filter((definition) => category === undefined || definition.category === category);
  }

  get(key: string): BlockDefinition | null {
    const definition = this.registrations.get(key)?.definition;
    return definition ? structuredClone(definition) : null;
  }

  load(key: string): Promise<BlockModule<Renderer>> {
    const registration = this.registrations.get(key);
    if (!registration) return Promise.reject(resourceNotFound("Block", key));
    const existing = this.modules.get(key);
    if (existing) return existing;
    const loading = registration.load().catch((error: unknown) => {
      this.modules.delete(key);
      throw error;
    });
    this.modules.set(key, loading);
    return loading;
  }
}
