import type { WorkspaceClient } from "@jthum/framework/client";
import type { InferenceEvent, InferenceInput } from "@jthum/framework/kernel";
import { FrameworkError } from "@jthum/framework/errors";
import { isObject, readJsonResponse, remoteError, workspaceMethods } from "./protocol.ts";

export interface HttpClientOptions {
  readonly url: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: () => HeadersInit | Promise<HeadersInit>;
}

/** A context-bound remote client. Authentication is supplied by the host's cookies/headers. */
export function createHttpWorkspaceClient(options: HttpClientOptions): WorkspaceClient {
  const send = async (method: string, args: readonly unknown[], signal?: AbortSignal) => {
    const headers = new Headers(await options.headers?.());
    headers.set("content-type", "application/json");
    return (options.fetch ?? globalThis.fetch)(options.url, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ method, args }),
      ...(signal ? { signal } : {}),
    });
  };
  const methods: Record<string, unknown> = Object.fromEntries(
    Object.keys(workspaceMethods).map((method) => [
      method,
      async (...args: unknown[]) => {
        const body = await readJsonResponse(await send(method, args));
        if (!isObject(body) || !Object.hasOwn(body, "result")) throw invalidResponse();
        return body.result;
      },
    ]),
  );
  methods.runInference = async (input: InferenceInput): Promise<AsyncIterable<InferenceEvent>> => {
    const { signal, ...portable } = input;
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const response = await send("runInference", [portable], combined);
    if (!response.ok) {
      await readJsonResponse(response);
      throw invalidResponse();
    }
    if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson"))
      throw invalidResponse();
    return readEvents(response.body, controller);
  };
  // The exhaustive allowlist above covers every WorkspaceClient operation; streams are overridden explicitly.
  return methods as unknown as WorkspaceClient;
}

async function* readEvents(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
): AsyncIterable<InferenceEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const frame: unknown = JSON.parse(line);
        if (!isObject(frame)) throw invalidResponse();
        if (frame.error) throw remoteError(frame.error);
        if (frame.done === true) return;
        if (!isObject(frame.event) || typeof frame.event.type !== "string") throw invalidResponse();
        yield frame.event as unknown as InferenceEvent;
      }
      if (pending.length > 4_194_304) throw invalidResponse();
      if (chunk.done) throw invalidResponse();
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function invalidResponse(): FrameworkError {
  return new FrameworkError({
    code: "TRANSPORT.INVALID_RESPONSE",
    message: "The server response was incomplete or invalid.",
  });
}
