import type { WorkspaceClient } from "@jthum/framework/client";
import type { InferenceInput } from "@jthum/framework/kernel";
import { asFrameworkError } from "@jthum/framework/errors";
import {
  errorResponse,
  jsonResponse,
  parseCall,
  readJsonRequest,
  type WorkspaceMethod,
} from "./protocol.ts";

export interface WorkspaceHandlerOptions {
  /** Authenticate and bind the Actor/Workspace for every request. Never trust caller Actor IDs. */
  readonly resolveClient: (request: Request) => Promise<WorkspaceClient>;
  readonly maxBodyBytes?: number;
  readonly onCall?: (method: WorkspaceMethod, request: Request) => void | Promise<void>;
  readonly onError?: (error: unknown, request: Request) => void;
}

/** Fetch handler usable in any server router; no Kernel lifecycle or authentication policy is implied. */
export function createWorkspaceHandler(
  options: WorkspaceHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    try {
      const client = await options.resolveClient(request);
      const { method, args } = parseCall(await readJsonRequest(request, options.maxBodyBytes));
      if (method === "runInference") {
        const controller = new AbortController();
        const events = await client.runInference({
          ...(args[0] as InferenceInput),
          signal: AbortSignal.any([request.signal, controller.signal]),
        });
        const iterator = events[Symbol.asyncIterator]();
        let cancelled = false;
        let finished = false;
        const finish = async () => {
          if (!finished) {
            finished = true;
            await options.onCall?.(method, request);
          }
        };
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async pull(stream) {
            try {
              const next = await iterator.next();
              if (cancelled) return;
              if (next.done) {
                await finish();
                stream.enqueue(encoder.encode(`${JSON.stringify({ done: true })}\n`));
                stream.close();
              } else stream.enqueue(encoder.encode(`${JSON.stringify({ event: next.value })}\n`));
            } catch (error) {
              if (cancelled) return;
              await finish();
              options.onError?.(error, request);
              await iterator.return?.();
              stream.enqueue(
                encoder.encode(
                  `${JSON.stringify({ error: asFrameworkError(error).toEnvelope() })}\n`,
                ),
              );
              stream.close();
            }
          },
          async cancel() {
            cancelled = true;
            controller.abort();
            try {
              await iterator.return?.();
            } finally {
              await finish();
            }
          },
        });
        return new Response(body, {
          headers: {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      }
      let result: unknown;
      try {
        result = await Reflect.apply(client[method], client, args);
      } finally {
        await options.onCall?.(method, request);
      }
      return jsonResponse({ result: result ?? null });
    } catch (error) {
      options.onError?.(error, request);
      return errorResponse(error);
    }
  };
}
