import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import PeopleTable from "./people-table.svelte";
import PermissionSelect from "./permission-select.svelte";

describe("optional People presentation", () => {
  it("renders a host-fed page with truthful pagination and independently optional management", () => {
    const props = {
      people: [
        {
          actor: { id: "jane", name: "Jane", kind: "user" as const },
          permissions: ["read" as const],
        },
      ],
      total: 60,
      limit: 25,
      offset: 25,
      onPageChange: () => {},
    };
    const body = render(PeopleTable, { props }).body;
    expect(body).toContain("Jane");
    expect(body).toContain("26–26 of 60 people");
    expect(body).toContain('aria-label="Next page"');
    expect(body).not.toContain("Manage access for");
    const managed = render(PeopleTable, { props: { ...props, onManage: () => {} } }).body;
    expect(managed).toContain('aria-label="Manage access for Jane"');
  });

  it("renders membership controls without assuming host product names or authentication", () => {
    const body = render(PermissionSelect, {
      props: { permissions: ["update"], label: "Workspace access" },
    }).body;
    expect(body).toContain("Workspace access");
    expect(body).toContain("Custom permissions");
    expect(body).not.toMatch(/Password|Username|App permissions/);
  });
});
