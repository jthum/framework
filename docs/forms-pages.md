# Forms and Pages

Forms and Pages are portable surface primitives. Neither one owns host navigation, Svelte
components, or persistence-specific behavior.

## Forms

A Form has one of three modes:

- `create` references a local Collection and an ordered subset of its stable Field IDs;
- `edit` uses the same shape and additionally requires a record ID at submission time;
- `standalone` owns ordered Field definitions and produces validated values without creating a record.

```ts
const form = {
  id: "form-create-project",
  key: "create_project",
  label: "Create project",
  mode: "create",
  collectionId: "collection-project",
  fieldIds: ["field-name", "field-owner"],
};

await kernel.submitForm(context, "create_project", {
  values: { name: "Launch", owner: contactId },
});
```

Collection Forms reject values for Fields they do not expose, then delegate to the same `createRecord` or `updateRecord` operation used everywhere else. They therefore inherit record validation, reference checks, lifecycle behavior, authorization, timestamps, and Actor attribution rather than reimplementing mutation logic.

Standalone Forms reuse the Field primitive, including defaults, conditional behavior, and
validation. References are checked against local or attached Sources. Submission returns normalized
values and publishes `form.submitted` so Rules own business behavior. A Form is intentionally not
an arbitrary command builder.

`submit.success` is an optional presentation hint. It does not encode workflow behavior.

## Pages

A Page contains an ordered layout tree:

```ts
const page = {
  id: "page-home",
  key: "home",
  label: "Home",
  meta: { icon: "home", folder: "Overview" },
  layout: [
    { id: "block-heading", kind: "block", block: "heading", config: { text: "Projects" } },
    {
      id: "group-overview",
      kind: "group",
      columns: 2,
      children: [{ id: "block-projects", kind: "block", block: "table" }],
    },
  ],
};
```

Every node has a stable ID so editors can reorder or update it without index identity. A Block node selects a registry key and carries JSON configuration. A Group node supplies layout (`columns`, optional `minHeight`, and children); it is never registered or rendered as a fake Block. Empty Pages and Groups are valid while authors build them.

Host details such as folders and icons use `meta`. Rendering remains a host/UI-package concern. Static Blocks may render from config alone; data-backed Blocks may additionally receive resolved Source data. Block code remains lazily loaded through the registry.
