import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { InferenceAdapter, InferenceEvent, InferenceInput } from "./agent-runtime.ts";
import { InferenceRegistry } from "./inference.ts";

describe("InferenceRegistry", () => {
  it("routes a request by its configured provider", async () => {
    const first = new RecordingAdapter("first");
    const second = new RecordingAdapter("second");
    const registry = new InferenceRegistry([
      { key: "first", adapter: first },
      { key: "second", adapter: second },
    ]);
    const input: InferenceInput = {
      messages: [],
      tools: [],
      model: { provider: "second", model: "reasoning-model" },
    };

    await collect(registry.infer(input));

    expect(first.requests).toHaveLength(0);
    expect(second.requests).toEqual([input]);
  });

  it("supports one explicit default and rejects unknown providers", async () => {
    const adapter = new RecordingAdapter("default");
    const registry = new InferenceRegistry([{ key: "default", adapter }], "default");

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

class RecordingAdapter implements InferenceAdapter {
  readonly requests: InferenceInput[] = [];

  constructor(readonly name: string) {}

  async *infer(input: InferenceInput): AsyncIterable<InferenceEvent> {
    this.requests.push(input);
    yield { type: "finished", reason: "stop" };
  }
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
