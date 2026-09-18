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
- **Svelte Studio** supplies optional editors. It is not required to consume the Spec.

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

- An **Action** is a registered primitive operation.
- An **Event** is a named occurrence with payload and Actor context.
- A **Rule** composes Actions and control flow, optionally subscribing to an Event.

Direct local CRUD remains available through the client. Interactive mutations that should emit
Events use Actions or Form submission. Short Rules execute synchronously; durable Rules persist
waits and User requests when the environment enables that capability.

## Simple first, advanced when needed

An application can start with one Workspace, local Collections, direct Views, simple Forms, and
short Rules. Attachments, custom authorization, durable execution, host envelopes, remote clients,
and replacement editors are optional layers built from the same primitives.
