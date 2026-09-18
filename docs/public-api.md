# Public API and code map

Use public package imports in hosts. Use the source links below when changing Framework or when an
exact contract is more useful than prose. Exported TypeScript is authoritative for shapes; the
guides explain semantics and ownership.

## Package entry points

| Import                                           | Purpose                                                 | Authoritative source                                                              | Change with                                                                     |
| ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@jthum/framework`                               | Convenience aggregate for non-Svelte core APIs          | [`src/index.ts`](../src/index.ts)                                                 | focused contract tests and `vp pack`                                            |
| `@jthum/framework/spec`                          | Portable definitions, constants, and runtime validation | [`src/spec/index.ts`](../src/spec/index.ts)                                       | [`src/spec/validate.spec.ts`](../src/spec/validate.spec.ts)                     |
| `@jthum/framework/kernel`                        | Runtime orchestration and extension registries          | [`src/kernel/index.ts`](../src/kernel/index.ts)                                   | relevant Kernel behavior tests                                                  |
| `@jthum/framework/client`                        | Context-bound UI/transport contracts                    | [`src/client/index.ts`](../src/client/index.ts)                                   | [`src/client/workspace-client.spec.ts`](../src/client/workspace-client.spec.ts) |
| `@jthum/framework/persistence`                   | Logical storage ports and memory implementation         | [`src/persistence/index.ts`](../src/persistence/index.ts)                         | shared adapter contract suites                                                  |
| `@jthum/framework/sqlite`                        | Driver-neutral SQLite adapter                           | [`src/sqlite/index.ts`](../src/sqlite/index.ts)                                   | SQLite tests plus shared contracts                                              |
| `@jthum/framework/sqlite/node`                   | Optional Node SQLite driver                             | [`src/sqlite/node-index.ts`](../src/sqlite/node-index.ts)                         | package build and Node integration                                              |
| `@jthum/framework/blocks`                        | Block metadata and lazy renderer registry               | [`src/blocks/index.ts`](../src/blocks/index.ts)                                   | [`src/blocks/registry.spec.ts`](../src/blocks/registry.spec.ts)                 |
| `@jthum/framework/catalog`                       | Host-selected resource discovery                        | [`src/catalog/index.ts`](../src/catalog/index.ts)                                 | [`src/catalog/catalog.spec.ts`](../src/catalog/catalog.spec.ts)                 |
| `@jthum/framework/errors`                        | Stable Framework error types and codes                  | [`src/errors/index.ts`](../src/errors/index.ts)                                   | error contract and failure-path tests                                           |
| `@jthum/framework/svelte/theme.css`              | Semantic default theme                                  | [`src/svelte/theme.css`](../src/svelte/theme.css)                                 | host theme compatibility review                                                 |
| `@jthum/framework/svelte/utils`                  | Shared Svelte class utilities                           | [`src/svelte/utils.ts`](../src/svelte/utils.ts)                                   | Svelte check                                                                    |
| `@jthum/framework/svelte/hooks/is-mobile.svelte` | Responsive-state hook                                   | [`src/svelte/hooks/is-mobile.svelte.ts`](../src/svelte/hooks/is-mobile.svelte.ts) | Svelte check                                                                    |
| `@jthum/framework/svelte/studio`                 | Aggregate Studio barrel; intentionally eager            | [`src/svelte/studio/index.ts`](../src/svelte/studio/index.ts)                     | Studio rendering and boundary tests                                             |
| `@jthum/framework/svelte/studio/*`               | Granular, code-splittable Studio components             | [`src/svelte/studio`](../src/svelte/studio)                                       | focused component/authoring tests                                               |
| `@jthum/framework/svelte/studio/adapters`        | Canonical Studio adapters                               | [`src/svelte/studio/adapters.ts`](../src/svelte/studio/adapters.ts)               | adapter round-trip tests                                                        |
| `@jthum/framework/svelte/studio/data`            | Studio working models and context helpers               | [`src/svelte/studio/data.ts`](../src/svelte/studio/data.ts)                       | editor-context tests                                                            |
| `@jthum/framework/svelte/ui/*`                   | Granular semantic UI primitives                         | [`src/svelte/ui`](../src/svelte/ui)                                               | Svelte check and accessibility review                                           |

The root aggregate deliberately excludes Svelte. Prefer subpath imports in library and host code so
dependency direction remains visible.

## Canonical symbols

| Concern                          | Read these symbols                                                                   | Source                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Complete portable document       | `Spec`, `SPEC_VERSION`, `createEmptySpec`, `assertValidSpec`                         | [`src/spec`](../src/spec)                                             |
| Definition identity and metadata | `DefinitionIdentity`, `SpecMeta`                                                     | [`src/spec/model.ts`](../src/spec/model.ts)                           |
| Runtime composition              | `Kernel`, `KernelOptions`                                                            | [`src/kernel/kernel.ts`](../src/kernel/kernel.ts)                     |
| Identity and execution context   | `Workspace`, `Actor`, `Membership`, `ExecutionContext`                               | [`src/kernel/model.ts`](../src/kernel/model.ts)                       |
| Authorization                    | `Authorizer`, `WorkspaceAuthorizer`, `AuthorizationRequest`                          | [`src/kernel/authorization.ts`](../src/kernel/authorization.ts)       |
| UI/transport boundary            | `WorkspaceClient`, `RuleExecutionClient`, `InferenceClient`, `AgentManagementClient` | [`src/client/workspace-client.ts`](../src/client/workspace-client.ts) |
| Persistence port                 | `PersistenceAdapter`, `PersistenceSession`, `CatalogRepository`                      | [`src/persistence/catalog.ts`](../src/persistence/catalog.ts)         |
| Record port                      | `RecordStore`, `CollectionRecord`, `RecordValues`                                    | [`src/persistence/records.ts`](../src/persistence/records.ts)         |
| Rule extensions                  | `ActionDefinition`, `ConditionDefinition`, `RuleRuntimeProfile`                      | [`src/kernel`](../src/kernel)                                         |
| Inference and Agent execution    | `InferenceRuntime`, `InferenceToolGateway`, `AgentConfig`                            | [`src/kernel`](../src/kernel)                                         |
| Block loading                    | `BlockDefinition`, `BlockRegistry`, `BlockInput`                                     | [`src/blocks`](../src/blocks)                                         |
| Catalog discovery                | `Catalog`, `CatalogSource`, `CatalogEntry`                                           | [`src/catalog`](../src/catalog)                                       |

## Behavioral sources of truth

- Module scope selection and isolation: [`ScopeHandle`](../src/kernel/model.ts),
  [`ScopeStore`](../src/persistence/scopes.ts), and [`src/kernel/scopes.spec.ts`](../src/kernel/scopes.spec.ts)

- Spec validity and field capabilities: [`src/spec/validate.spec.ts`](../src/spec/validate.spec.ts)
- Workspace, Actor, and authorization behavior: [`src/kernel/kernel.spec.ts`](../src/kernel/kernel.spec.ts)
- Record and schema behavior: [`src/kernel/records.spec.ts`](../src/kernel/records.spec.ts)
- Attachment contract shared by adapters: [`src/kernel/attachments.contract.ts`](../src/kernel/attachments.contract.ts)
- Source and relationship semantics: [`src/kernel/sources.spec.ts`](../src/kernel/sources.spec.ts)
- View semantics: [`src/kernel/views.spec.ts`](../src/kernel/views.spec.ts)
- Form and Page semantics: [`src/kernel/forms-pages.spec.ts`](../src/kernel/forms-pages.spec.ts)
- Short and delegated Rules: [`src/kernel/rules.spec.ts`](../src/kernel/rules.spec.ts) and [`src/kernel/delegated-rules.spec.ts`](../src/kernel/delegated-rules.spec.ts)
- Durable execution: [`src/kernel/durable-rules.spec.ts`](../src/kernel/durable-rules.spec.ts)
- Agent identity, projection, and inference: [`src/kernel/inference-runtime.spec.ts`](../src/kernel/inference-runtime.spec.ts)
- Persistence conformance: [`src/persistence`](../src/persistence)
- Studio dependency boundaries: [`src/svelte/studio/editor-boundaries.test.ts`](../src/svelte/studio/editor-boundaries.test.ts)

When documentation and code disagree, first determine whether the implementation or the intended
contract is wrong. Do not silently edit prose to bless accidental behavior; update the canonical
contract, tests, and guide together.
