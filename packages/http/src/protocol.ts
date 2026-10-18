import type { WorkspaceClient } from "@jthum/framework/client";
import {
  asFrameworkError,
  FrameworkError,
  invalidInput,
  type ErrorEnvelope,
} from "@jthum/framework/errors";

type Argument = "string" | "object" | "array" | "number" | "string?" | "object?" | "number?";

/** Explicit wire allowlist. Adding a client method requires an intentional transport decision. */
export const workspaceMethods = {
  getWorkspace: [],
  applySpec: ["object"],
  listRules: [],
  executeAction: ["string", "object?"],
  listSettings: [],
  getSetting: ["string"],
  putSetting: ["object"],
  deleteSetting: ["string"],
  listActorBindings: [],
  putActorBinding: ["object"],
  deleteActorBinding: ["string"],
  listRuntimeActions: [],
  putRuntimeAction: ["object"],
  deleteRuntimeAction: ["string"],
  runRule: ["string", "object?"],
  createRecord: ["string", "object"],
  getRecord: ["string", "string"],
  listRecords: ["string"],
  updateRecord: ["string", "string", "object"],
  deleteRecord: ["string", "string"],
  listSources: [],
  getSource: ["string"],
  querySource: ["string", "object?"],
  getSourceRecord: ["string", "string"],
  getSourceRecords: ["string", "array"],
  listViews: [],
  getView: ["string"],
  queryView: ["string", "object?"],
  previewView: ["object", "object?"],
  listForms: [],
  getForm: ["string"],
  submitForm: ["string", "object"],
  listPages: [],
  getPage: ["string"],
  listPendingActorRequests: ["number?", "number?"],
  listRuleExecutions: ["number?", "number?"],
  getRuleExecutionDetails: ["string"],
  getRuleExecutionDetailsMany: ["array"],
  startRule: ["string", "object?"],
  resumeRule: ["string", "object?"],
  failRuleExecution: ["string"],
  listActorRequests: ["string"],
  respondToActorRequest: ["string", "string", "object"],
  listInferenceTools: [],
  runInference: ["object"],
  listAgents: [],
  createAgent: ["object"],
  getAgentConfig: ["string"],
  configureAgent: ["string", "object"],
  listModelConfigs: [],
  getModelConfig: ["string"],
  createModelConfig: ["object"],
  updateModelConfig: ["string", "object"],
  deleteModelConfig: ["string"],
  listChildWorkspaces: ["string?"],
  createWorkspace: ["object"],
  renameWorkspace: ["object"],
  deleteWorkspace: [],
  updateWorkspaceAccess: ["object"],
  updateWorkspacePolicy: ["object"],
  getActor: ["string"],
  updateActor: ["string", "object"],
  createActor: ["object"],
  createMember: ["object"],
  listActorsByOrigin: ["string?"],
  listMembers: ["string?"],
  listMembershipsForActor: ["string"],
  listMembershipsForWorkspace: ["string?"],
  addMembership: ["object"],
  updateMembership: ["object"],
  createAttachment: ["object"],
  reshareAttachment: ["object"],
  listAttachmentsTo: [],
  listAttachmentsFrom: [],
  revokeAttachment: ["string"],
  getScopeConfig: [],
  applyScopeConfig: ["object"],
  deleteScopeConfig: [],
} as const satisfies Record<keyof WorkspaceClient, readonly Argument[]>;

export type WorkspaceMethod = keyof typeof workspaceMethods;

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseCall(value: unknown): { method: WorkspaceMethod; args: unknown[] } {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => key !== "method" && key !== "args") ||
    typeof value.method !== "string" ||
    !Object.hasOwn(workspaceMethods, value.method) ||
    !Array.isArray(value.args)
  )
    throw invalidInput("Invalid Workspace request.");
  const method = value.method as WorkspaceMethod;
  const signature: readonly Argument[] = workspaceMethods[method];
  if (value.args.length > signature.length) throw invalidInput("Too many operation arguments.");
  const args = signature.map((argument, index) => {
    const candidate: unknown = (value.args as unknown[])[index];
    if (argument.endsWith("?") && candidate == null) return undefined;
    const type = argument.replace("?", "");
    if (
      type === "string"
        ? typeof candidate !== "string" || !candidate.trim()
        : type === "object"
          ? !isObject(candidate)
          : type === "array"
            ? !Array.isArray(candidate) || !candidate.every((item) => typeof item === "string")
            : typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0
    )
      throw invalidInput(`Invalid argument ${index + 1} for ${method}.`);
    return candidate;
  });
  return { method, args };
}

/** Bounded parsing for authenticated route handlers, including chunked requests. */
export async function readJsonRequest(request: Request, maxBytes = 1_048_576): Promise<unknown> {
  if (!request.headers.get("content-type")?.split(";", 1)[0]?.trim().endsWith("/json"))
    throw invalidInput("Content-Type must be application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw invalidInput("A JSON body is required.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw invalidInput("The request is too large.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw invalidInput("The request must contain valid JSON.");
  }
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(error: unknown): Response {
  const safe = asFrameworkError(error);
  const status = safe.code.startsWith("AUTH.")
    ? 401
    : safe.code.startsWith("PERMISSION.")
      ? 403
      : safe.code === "RESOURCE.NOT_FOUND"
        ? 404
        : safe.code === "RESOURCE.CONFLICT"
          ? 409
          : safe.code.startsWith("VALIDATION.") || safe.code.startsWith("SPEC.")
            ? 400
            : 500;
  return jsonResponse({ error: safe.toEnvelope() }, status);
}

export function remoteError(value: unknown): FrameworkError {
  if (!isObject(value) || typeof value.code !== "string" || typeof value.message !== "string")
    return invalidInput("The server returned an invalid error response.");
  return new FrameworkError(value as unknown as ErrorEnvelope);
}

export async function readJsonResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (isObject(body) && Object.hasOwn(body, "error")) throw remoteError(body.error);
  if (!response.ok)
    throw new FrameworkError({ code: "TRANSPORT.FAILED", message: "The server request failed." });
  return body;
}
