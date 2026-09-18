import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "@jthum/framework/errors";
import type { ModelEvent, ModelProvider, ModelRequest } from "./model-provider.ts";
import { ModelProviderRegistry } from "./provider-registry.ts";

describe("ModelProviderRegistry", () => {
  it("routes a request by its configured provider", async () => {
    const first = new RecordingProvider();
    const second = new RecordingProvider();
    const registry = new ModelProviderRegistry([
      { key: "first", provider: first },
      { key: "second", provider: second },
    ]);
    const request: ModelRequest = {
      messages: [],
      tools: [],
      model: { provider: "second", model: "reasoning-model" },
    };

    await collect(registry.infer(request));

    expect(first.requests).toHaveLength(0);
    expect(second.requests).toEqual([request]);
  });

  it("supports one explicit default and rejects unknown providers", async () => {
    const provider = new RecordingProvider();
    const registry = new ModelProviderRegistry([{ key: "default", provider }], "default");

    await expect(collect(registry.infer({ messages: [], tools: [] }))).resolves.toEqual([
      { type: "finished", reason: "stop" },
    ]);
    await expect(
      collect(
        registry.infer({
          messages: [],
          tools: [],
          model: { provider: "missing", model: "model" },
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.resourceNotFound });
  });
});

class RecordingProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  async *infer(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    yield { type: "finished", reason: "stop" };
  }
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
