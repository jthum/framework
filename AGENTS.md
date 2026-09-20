# Working in Framework

Framework is a portable information-system Spec, reference TypeScript Kernel, persistence layer,
and reusable Svelte integration surfaces. Keep it product-neutral: application names, navigation, branding,
authentication providers, and domain vocabulary belong to hosts.

Before changing code, select the relevant reading path:

| Task                            | Read first                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Build a host application        | `docs/building-a-host.md`, `docs/getting-started.md`, `docs/deployment-modes.md` |
| Guide a coding agent            | `docs/coding-agents.md`, then the task-specific guide                            |
| Add a domain module             | `docs/domain-modules.md`, `docs/extensions.md`, `docs/deployment-modes.md`       |
| Change the portable Spec        | `docs/concepts.md`, `docs/architecture.md`, `docs/coding-standards.md`           |
| Add Kernel behavior             | `docs/architecture.md`, the relevant capability guide, `docs/testing.md`         |
| Add or change persistence       | `docs/host-architecture.md`, `docs/coding-standards.md`, `docs/testing.md`       |
| Use or change Svelte interfaces | `docs/svelte.md`, `docs/authoring.md`                                            |
| Add host/domain extensions      | `docs/extensions.md`, `docs/deployment-modes.md`, `docs/catalogs.md`             |
| Add an optional package         | `docs/developing-framework.md`, `docs/testing.md`, `docs/public-api.md`          |
| Change errors                   | `docs/errors.md`                                                                 |
| Plan a new phase                | `docs/implementation-plan.md`                                                    |

Use `docs/public-api.md` to locate authoritative exported symbols and their behavioral tests.
Prefer links to source and contract tests over restating complete TypeScript shapes in prose.

## Invariants

- The portable Spec is plain JSON-compatible data. It contains definitions, not records, secrets,
  sessions, concrete Workspaces, or concrete Attachments.
- Stable definition IDs carry identity; semantic keys are author-facing and renameable.
- Workspace grouping and Actor issuance never grant authority. Membership, ACL, and Attachment are
  the authorization model.
- Kernel code depends on logical persistence contracts, never SQL or host globals.
- Svelte authoring and operations depend on canonical definitions and public client contracts, never a concrete
  adapter, router, or application session.
- Module-owned entities use module-owned client contracts; a Framework scope may attach optional
  configuration without changing ownership of the entity.
- Host extensions use a host-owned envelope or registered Actions, Conditions, Sources, Blocks,
  and catalogs. Unknown `meta` is annotation space, not a hidden behavioral protocol.
- Keep simple cases direct. Optional capabilities must not impose ceremony on ordinary local data,
  simple Forms, short Rules, or default authoring usage.
- This project is greenfield. Do not add compatibility aliases, legacy readers, or dual writes
  unless a compatibility policy is explicitly adopted later.

## Toolchain

This repository uses Vite+, a unified toolchain built on Vite, Rolldown, Vitest, tsdown, Oxlint,
Oxfmt, and Vite Task. Use the global `vp` CLI.

- Run `vp install` after pulling changes.
- Run `vp check` and `vp test` before handing off implementation work.
- Use `vp pack` to build the library.
- Use `vp run <name>` for package scripts or configured tasks; built-in commands take precedence.
- Run `vp env doctor` when toolchain or package-manager behavior appears incorrect.

Documentation-only changes require content review plus `vp test src/docs.spec.ts`. Any code example
described as executable must remain covered by a deterministic test.
