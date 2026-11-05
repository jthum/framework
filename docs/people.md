# People and membership interfaces

Framework separates Actors, Workspace memberships, and host-owned login identities. A member
directory can be used with local data, password authentication, SSO, or another identity provider.
Authentication, invitations, recovery, routes, and product-specific access controls remain host-owned.

## Queries and authority

`WorkspaceClient.queryMembers(query)` returns a bounded `MemberPage` for the client's Workspace.
It supports name/email substring search, Actor kind, assigned permission (or `none`), sorting,
and offset pagination. Defaults are 25 rows and name order; the maximum page size is 100.
Equal sort values use Actor ID as a stable tie-breaker. `none` means an empty assigned permission
list, not a new disabled-Actor state or an effective-access calculation.

The optional `memberOf` filter requires readable membership in another Workspace. The caller must
be authorized to manage both rosters. This never infers authority from a parent or root Workspace.
`getMembership(actorId, workspaceId?)` reads one membership with the same management requirement,
without loading a whole roster. Use ordinary membership mutations to save changes.

SQLite performs filtering, counts, sorting and pagination in SQL, with existing Workspace membership
indexes. Substring search may scan that Workspace's roster; it is not a full-text search index.
SQLite's built-in case folding is ASCII; other characters are matched literally. The memory adapter
implements the same logical query for local/test hosts. Contracts and validation live in
[`member-query.ts`](../src/kernel/member-query.ts); executable scenarios are in
[`member-query.spec.ts`](../src/kernel/member-query.spec.ts).

## Optional Svelte surfaces

Import only what the host uses:

```ts
import PeopleTable from "@jthum/framework/svelte/people/people-table";
import PeopleFilters from "@jthum/framework/svelte/people/people-filters";
import PermissionSelect from "@jthum/framework/svelte/people/permission-select";
```

`PeopleTable` accepts a page of host-fed rows, totals, paging callbacks, and optional management
callbacks. It never fetches data or provisions identities. Avatar, secondary text, and an additional
detail column are host snippets; omission of `onManage` gives a read-only directory.
`PeopleFilters` emits query changes and accepts additional host filters. The host owns debounce,
refresh, stale-response handling, loading and errors.

`PermissionSelect` edits a permission list. Viewer/Editor/Manager are presentation presets, not
persisted roles or another policy system. Custom lists preserve individual permissions.
Hosts whose entry policy requires Read can opt into `requireRead`; the default adds no such rule.

The convenience barrel is `@jthum/framework/svelte/people`; presentation helpers/types live under
`@jthum/framework/svelte/people/data`. Exact component props in
[`src/svelte/people`](../src/svelte/people) are authoritative.

## Delivery boundaries

No People component is imported by the Kernel, client, theme, or other Framework UI barrels.
Hosts that do not import this surface do not ship its UI JavaScript. Put an administration route
behind a dynamic import or the host router's route splitting to load it only when visited.
Hiding a navigation link alone does not exclude its implementation.

The Kernel retains lightweight membership contracts and authorization. Query validation loads on
demand; there is no eagerly installed administration service or authentication dependency.
[`bundle.spec.ts`](../src/svelte/people/bundle.spec.ts) builds Spec-only and Kernel consumers and checks that
the unused Svelte/People implementation is absent. Rendering contracts are covered by
[`people.spec.ts`](../src/svelte/people/people.spec.ts).
