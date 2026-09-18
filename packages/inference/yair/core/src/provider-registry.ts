import { resourceConflict, resourceNotFound } from "@jthum/framework/errors";
import type { ModelEvent, ModelProvider, ModelRequest } from "./model-provider.ts";

export interface ModelProviderRegistration {
  readonly key: string;
  readonly provider: ModelProvider;
}

/** Routes YAIR model requests by the provider key in the selected model configuration. */
export class ModelProviderRegistry implements ModelProvider {
  private readonly providers = new Map<string, ModelProvider>();

  constructor(
    providers: readonly ModelProviderRegistration[] = [],
    private readonly defaultProvider?: string,
  ) {
    for (const provider of providers) this.register(provider);
  }

  register(registration: ModelProviderRegistration): void {
    const key = registration.key.trim();
    if (!key) throw resourceConflict("Model provider key is required.");
    if (this.providers.has(key))
      throw resourceConflict(`Model provider ${key} is already registered.`);
    this.providers.set(key, registration.provider);
  }

  async *infer(request: ModelRequest): AsyncIterable<ModelEvent> {
    const key = request.model?.provider ?? this.defaultProvider;
    if (!key) throw resourceNotFound("ModelProvider", "default");
    const provider = this.providers.get(key);
    if (!provider) throw resourceNotFound("ModelProvider", key);
    yield* provider.infer(request);
  }
}
