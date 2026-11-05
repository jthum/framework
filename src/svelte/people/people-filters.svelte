<script lang="ts">
  import type { Snippet } from "svelte";
  import type { MemberQuery } from "../../kernel/member-query.ts";
  import { PERMISSIONS } from "../../kernel/model.ts";
  import * as Field from "../ui/field/index.js";
  import { Input } from "../ui/input/index.js";
  import { OptionSelect } from "../ui/option-select/index.js";
  let { query, onChange, children }: { query: MemberQuery; onChange: (query: MemberQuery) => void; children?: Snippet } = $props();
  const id = $props.id();
  const sorts = [{ value: "name_asc", label: "Name A–Z" }, { value: "name_desc", label: "Name Z–A" }, { value: "newest", label: "Newest members" }, { value: "oldest", label: "Oldest members" }];
  const permissions = [{ value: "", label: "All permissions" }, ...PERMISSIONS.map((value) => ({ value, label: `Can ${value}` })), { value: "none", label: "No access" }];
</script>

<Field.Group class="flex-row flex-wrap items-end gap-3">
  <Field.Field class="min-w-48 flex-1"><Field.Label for={`${id}-search`} class="sr-only">Search people by name or email</Field.Label><Input id={`${id}-search`} type="search" value={query.search ?? ""} maxlength={200} placeholder="Search by name or email…" oninput={(event) => onChange({ ...query, search: event.currentTarget.value, offset: 0 })} /></Field.Field>
  <Field.Field class="w-auto"><Field.Label for={`${id}-permission`} class="sr-only">Filter permissions</Field.Label><OptionSelect id={`${id}-permission`} value={query.permission ?? ""} options={permissions} onValueChange={(value) => onChange({ ...query, permission: value ? value as MemberQuery["permission"] : undefined, offset: 0 })} /></Field.Field>
  {@render children?.()}
  <Field.Field class="w-auto"><Field.Label for={`${id}-sort`} class="sr-only">Sort people</Field.Label><OptionSelect id={`${id}-sort`} value={query.sort ?? "name_asc"} options={sorts} onValueChange={(value) => onChange({ ...query, sort: value as MemberQuery["sort"], offset: 0 })} /></Field.Field>
</Field.Group>
