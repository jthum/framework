# Core concepts

Framework separates a portable definition from the runtime instance that consumes it.

```text
portable Spec + persistence + environment + host policy -> running system
```

## Portable definitions

The Spec contains JSON-compatible definitions:

- **Collection** — authoritative schema for a set of records;
- **Field** — typed value slot shared by Collections, Forms, and Actor requests;
- **Source binding** — semantic declaration for data supplied by an instance Attachment;
- **View** — saved query over one root Source, optionally with a presentation hint;
- **Form** — create, edit, or standalone intake surface;
- **Rule** — trigger, conditions, Actions, branches, waits, and nested Rules;
- **Page** — layout tree of Blocks and Groups;
- **Block node** — configured reference to renderer metadata registered by a host.

Definitions carry an opaque stable `id`, an author-facing semantic `key`, and a display `label`.
References use IDs where edits and renames must preserve identity. Keys are used at ergonomic host
boundaries such as `client.queryView("open_tasks")`.

The Spec does not contain records, Workspaces, Memberships, concrete Attachments, credentials,
sessions, database configuration, or renderer functions.

## Runtime instance

The Kernel manages instance data:

- **Workspace** — the single people-and-permissions place;
- **Actor** — User, Agent, or System identity issued in a Workspace;
- **Membership** — where an Actor may act and with which permissions;
- **Attachment** — a live, attenuated Source binding from one Workspace to another;
- **Record** — runtime data belonging to a Collection;
- **RuleExecution** and **ActorRequest** — durable orchestration state.

Workspace `parentId` and `rootId` group places. Actor `originId` records issuance. Neither grants
authority. Authorization uses the active Workspace, Membership, ACL, and Attachment.

## Kernel, client, and host

- The **Kernel** validates and executes portable semantics against injected adapters.
- A **WorkspaceClient** is a transport-neutral, context-bound interface suitable for application
  code and reusable UI.
- The **host** owns composition: authentication, routes, navigation, terminology, deployment,
  persistence selection, application modules, and policy.
- **Svelte integration** supplies optional authoring, operations, settings, and UI surfaces. It is not required to consume the Spec.

This separation lets a local single-user host and a server-side multiplayer host share definitions
without pretending they share authentication, storage topology, or process lifetime.

## Sources, Views, and Blocks

```text
Source -> View -> Block
 data     query    presentation
```

A Source advertises query capabilities. A View stores an interpretation. A Block renders resolved
input. Blocks never open a database, and Views never contain a component.

## Actions, Events, and Rules

- An **Action** implements a callable capability. Framework and hosts register ordinary Actions;
  an opted-in executor may also run a Workspace-defined implementation such as code, HTTP, WASM,
  or a remote function.
- An **Event** is a named occurrence with payload and Actor context.
- A **Rule** composes Actions and control flow, optionally subscribing to an Event.

Rules and Actions remain distinct even when both are callable. A one-step Rule is valid and may be
invoked by another Rule. It does not become an Action merely because it is small. Both can be
projected as agent tools. `action:*` and `rule:*` are stable internal tool IDs used for policy and
execution; the model sees a semantic function name. An exposed Rule defaults to its key and
description, and may override both through `tool` metadata. Tool names must be unique within an
offered step. `Tool` is an exposure mechanism, not a third executable primitive.

Rule Action results enter the shared variable context only when the step has `as`. Later steps can
read those values through `vars`. Most Rules are commands and need no declared result. A
value-producing Rule may opt into `result`, a `RuleValue` evaluated from its final context. Direct
callers and agent tools then receive that value; an invoking Rule stores it under the invoke
step's `as`. Without a declared result, a nested invocation retains the complete child variable
map for inspection and composition. Durable Rule details expose a result only after completion.

Direct local CRUD remains available through the client. Interactive mutations that should emit
Events use Actions or Form submission. Short Rules execute synchronously; durable Rules persist
waits and User requests when the environment enables that capability.

## Simple first, advanced when needed

An application can start with one Workspace, local Collections, direct Views, simple Forms, and
short Rules. Attachments, custom authorization, durable execution, host envelopes, remote clients,
and replacement editors are optional layers built from the same primitives.
