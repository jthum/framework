# Framework HTTP transport

Optional Fetch-based transport for `WorkspaceClient`. Both ends use the same logical contract.

```ts
import { createHttpWorkspaceClient, createWorkspaceHandler } from "@jthum/framework-http";

const client = createHttpWorkspaceClient({ url: "/api/workspaces/current" });
const handle = createWorkspaceHandler({
  resolveClient: async (request) => authenticatedWorkspaceClient(request),
});
```

The host authenticates every request, selects a Workspace and optional scope, binds a client,
and mounts the handler in its router. The wire envelope contains only an allowlisted method and
JSON arguments, never trusted execution context. Kernel authorization remains authoritative.
Hosts enforce same-origin/CSRF rules, session expiry, rate limits and deployment policy.

Errors retain Framework envelopes; unexpected server errors are redacted. Request bodies are
bounded, including chunked bodies. Inference uses pull-based NDJSON with cancellation and an
explicit end marker so broken connections cannot appear to finish successfully. Optional
`fetch` and `headers` support server clients, tests and non-cookie authentication.

`onCall` lets a host invalidate its screens after operations, including failed calls (which may
have committed partial effects) and cancelled streams; it is not a durable Event feed.
`onError` is for protected server diagnostics. Neither callback should throw.

No Node, SvelteKit, SQLite, authentication library or inference SDK dependency is introduced.
Module-owned clients may use the exported JSON request/response helpers with their own contracts.
