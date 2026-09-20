# Framework documentation

Use this page as the documentation router. Read the smallest path that matches the work.

## Build an application with Framework

1. [Getting started](getting-started.md) — run a minimal host and apply a Spec.
2. [Building a host](building-a-host.md) — assemble production boundaries without duplicating Framework.
3. [Core concepts](concepts.md) — understand the portable and instance boundaries.
4. [Host architecture](host-architecture.md) — choose Kernel, client, persistence, UI, and transport boundaries.
5. [Local and remote deployment](deployment-modes.md) — keep local and server hosts behind the same clients.
6. [Extensions](extensions.md) — add a host-owned document envelope without forking the core Spec.
7. [Domain modules](domain-modules.md) — own intrinsic product entities and integrate them deliberately.
8. [Public API and code map](public-api.md) — find authoritative exports, source, and contract tests.

Coding agents should begin with [Coding-agent guide](coding-agents.md), then follow the same
task-specific path. The guide points to canonical source and tests instead of duplicating APIs.

Then use the capability guide relevant to the feature:

- [Live Attachments](attachments.md)
- [Sources, Views, and Blocks](sources-views-blocks.md)
- [Rules and Actions](rules.md)
- [Workspace settings and runtime Actions](workspace-actions.md)
- [Agents](agents.md)
- [Forms and Pages](forms-pages.md)
- [Workspace client](workspace-client.md)
- [Catalogs](catalogs.md)
- [Svelte integration](svelte.md)
- [Authoring interface contracts](authoring.md)
- [Errors](errors.md)

## Develop Framework itself

Start with [Developing Framework](developing-framework.md), then consult:

- [Public API and code map](public-api.md)
- [Architecture](architecture.md)
- [Implementation plan](implementation-plan.md)
- [Coding standards](coding-standards.md)
- [Testing strategy](testing.md)
- [Errors](errors.md)
- [Coding-agent guide](coding-agents.md)

Architecture, coding standards, tests, and public contracts are normative. The implementation plan
records delivered and planned capability slices; it is not an application-authoring tutorial.
