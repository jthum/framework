import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel, LOCAL_BROWSER_ENVIRONMENT } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { createEmptySpec } from "@jthum/framework/spec";
import { FrameworkError } from "@jthum/framework/errors";
import { createHttpWorkspaceClient, createWorkspaceHandler } from "./index.ts";

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((kernel) => kernel.close()));
});

async function fixture() {
  const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
  kernels.push(kernel);
  const root = await kernel.createRootWorkspace({ name: "Workspace", user: { name: "Owner" } });
  const owner = await createWorkspaceClient(kernel, {
    workspaceId: root.workspace.id,
    actorId: root.user.id,
  });
  await owner.applySpec({
    ...createEmptySpec({ id: "spec", key: "example", label: "Example" }),
    collections: [
      {
        id: "notes",
        key: "note",
        label: "Note",
        fields: [{ id: "title", key: "title", label: "Title", type: "text" }],
      },
    ],
  });
  const member = await owner.createMember({ name: "Reader", permissions: ["read"] });
  const handler = createWorkspaceHandler({
    resolveClient: async (request) =>
      createWorkspaceClient(kernel, {
        workspaceId: root.workspace.id,
        actorId: request.headers.get("authorization") === "reader" ? member.actor.id : root.user.id,
      }),
  });
  const fetch: typeof globalThis.fetch = async (input, init) => handler(new Request(input, init));
  return { kernel, owner, root, handler, fetch };
}

describe("HTTP Workspace transport", () => {
  it("notifies the host after failed calls that may already have committed partial effects", async () => {
    const { owner } = await fixture();
    const client = Object.create(owner) as typeof owner;
    client.executeAction = async () => {
      throw new FrameworkError({ code: "ACTION.FAILED", message: "Failed after an effect." });
    };
    const onCall = vi.fn();
    const handler = createWorkspaceHandler({ resolveClient: async () => client, onCall });
    const response = await handler(
      new Request("https://example.test/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "executeAction", args: ["example"] }),
      }),
    );
    expect(response.status).toBe(500);
    expect(onCall).toHaveBeenCalledExactlyOnceWith("executeAction", expect.any(Request));
  });
  it("round-trips logical values, query results and void operations through the real Kernel", async () => {
    const { fetch } = await fixture();
    const client = createHttpWorkspaceClient({ url: "https://example.test/rpc", fetch });
    const record = await client.createRecord("note", { title: "Hello" });
    expect(record.values).toEqual({ title: "Hello" });
    expect((await client.querySource("note")).rows).toEqual([
      { id: record.id, values: { title: "Hello" } },
    ]);
    await client.deleteRecord("note", record.id);
    expect(await client.getRecord("note", record.id)).toBeNull();
    expect(await client.listPages()).toEqual([]);
  });

  it("binds each call to authenticated authority and preserves permission/validation errors", async () => {
    const { fetch } = await fixture();
    const client = createHttpWorkspaceClient({
      url: "https://example.test/rpc",
      fetch,
      headers: () => ({ authorization: "reader" }),
    });
    expect(await client.listRecords("note")).toEqual([]);
    await expect(client.createRecord("note", { title: "No" })).rejects.toMatchObject({
      code: "PERMISSION.DENIED",
    });
    await expect(client.getRecord("", "id")).rejects.toMatchObject({
      code: "VALIDATION.INVALID_INPUT",
    });
  });

  it.each([
    { method: "constructor", args: [] },
    { method: "close", args: [] },
    { method: "getWorkspace", args: [], actorId: "forged" },
    { method: "getWorkspace", args: ["unexpected"] },
    { method: "getRecord", args: [{ unsafe: true }, "id"] },
    { method: "getSourceRecords", args: ["note", [42]] },
  ])("rejects unexposed/context-forging or invalid requests: %j", async (payload) => {
    const { handler } = await fixture();
    const response = await handler(
      new Request("https://example.test/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION.INVALID_INPUT" } });
  });

  it("bounds chunked requests and hides unexpected failures", async () => {
    const { owner } = await fixture();
    const handler = createWorkspaceHandler({ resolveClient: async () => owner, maxBodyBytes: 8 });
    const response = await handler(
      new Request("https://example.test/rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "getWorkspace", args: [] }),
      }),
    );
    expect(response.status).toBe(400);
    const failed = createWorkspaceHandler({
      resolveClient: async () => {
        throw new Error("secret database path");
      },
    });
    const failure = await failed(new Request("https://example.test/rpc", { method: "POST" }));
    expect(await failure.text()).not.toContain("secret database path");
    expect(failure.status).toBe(500);
  });

  it("streams inference without buffering and aborts on consumer cancellation", async () => {
    let aborted = false;
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: { ...LOCAL_BROWSER_ENVIRONMENT, inference: true },
      inference: {
        async *run(context) {
          context.signal?.addEventListener("abort", () => {
            aborted = true;
          });
          yield { type: "started" };
          yield { type: "text_delta", step: 0, delta: "Hello" };
          yield { type: "completed", output: "Hello" };
        },
      },
    });
    kernels.push(kernel);
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Owner" } });
    const local = await createWorkspaceClient(kernel, {
      workspaceId: root.workspace.id,
      actorId: root.user.id,
    });
    const handler = createWorkspaceHandler({ resolveClient: async () => local });
    const client = createHttpWorkspaceClient({
      url: "https://example.test/rpc",
      fetch: async (input, init) => handler(new Request(input, init)),
    });
    const events = [];
    for await (const event of await client.runInference({
      messages: [{ role: "user", content: "Hi" }],
    }))
      events.push(event.type);
    expect(events).toEqual(["started", "text_delta", "completed"]);
    aborted = false;
    for await (const event of await client.runInference({
      messages: [{ role: "user", content: "Hi" }],
    })) {
      expect(event.type).toBe("started");
      break;
    }
    expect(aborted).toBe(true);
  });

  it("rejects interrupted streams instead of treating EOF as success", async () => {
    const client = createHttpWorkspaceClient({
      url: "https://example.test/rpc",
      fetch: vi.fn(
        async () =>
          new Response(`${JSON.stringify({ event: { type: "started" } })}\n`, {
            headers: { "content-type": "application/x-ndjson" },
          }),
      ),
    });
    const read = async () => {
      for await (const _ of await client.runInference({ messages: [] })) {
        /* consume */
      }
    };
    await expect(read()).rejects.toBeInstanceOf(FrameworkError);
    await expect(read()).rejects.toMatchObject({ code: "TRANSPORT.INVALID_RESPONSE" });
  });
});
