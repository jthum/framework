import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import type { InferenceAdapter, InferenceEvent, InferenceInput } from "./agent-runtime.ts";

export interface InferenceProvider {
  readonly key: string;
  readonly adapter: InferenceAdapter;
}

/** Routes model requests by the provider key stored in ModelConfig. */
export class InferenceRegistry implements InferenceAdapter {
  private readonly providers = new Map<string, InferenceAdapter>();

  constructor(
    providers: readonly InferenceProvider[] = [],
    private readonly defaultProvider?: string,
  ) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: InferenceProvider): void {
    const key = provider.key.trim();
    if (!key) throw resourceConflict("Inference provider key is required.");
    if (this.providers.has(key))
      throw resourceConflict(`Inference provider ${key} is already registered.`);
    this.providers.set(key, provider.adapter);
  }

  async *infer(input: InferenceInput): AsyncIterable<InferenceEvent> {
    const provider = input.model?.provider ?? this.defaultProvider;
    if (!provider) throw resourceNotFound("InferenceProvider", "default");
    const adapter = this.providers.get(provider);
    if (!adapter) throw resourceNotFound("InferenceProvider", provider);
    yield* adapter.infer(input);
  }
}
