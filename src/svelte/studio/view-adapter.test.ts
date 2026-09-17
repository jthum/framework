import { describe, expect, it } from "vite-plus/test";
import type { CollectionDefinition, ViewDefinition } from "../../spec/model.js";
import {
  ViewAuthoringError,
  viewDefinitionFromDraft,
  viewDraftFromDefinition,
} from "./view-adapter.js";

const clients: CollectionDefinition = {
  id: "collection-client",
  key: "client",
  label: "Client",
  titleFieldId: "field-client-name",
  fields: [{ id: "field-client-name", key: "name", label: "Name", type: "text" }],
};
const projects: CollectionDefinition = {
  id: "collection-project",
  key: "project",
  label: "Project",
  fields: [
    { id: "field-project-name", key: "name", label: "Name", type: "text" },
    {
      id: "field-project-client",
      key: "client",
      label: "Client",
      type: "reference",
      sourceId: clients.id,
    },
    { id: "field-project-status", key: "status", label: "Status", type: "text" },
    { id: "field-project-budget", key: "budget", label: "Budget", type: "number" },
  ],
};
const schemas = { client: clients, project: projects };

describe("View Studio adapter", () => {
  it("round-trips a parameterized relational View without losing stable identities", () => {
    const view: ViewDefinition = {
      id: "view-active-projects",
      key: "active_projects",
      label: "Active projects",
      description: "Projects filtered by the caller.",
      meta: { owner: "operations" },
      source: "project",
      query: {
        filter: { path: ["field-project-budget"], operator: "gte", value: 1000 },
        sort: [{ path: ["field-project-name"], direction: "asc" }],
        select: [
          { path: ["field-project-name"], as: "name", label: "Name" },
          {
            path: ["field-project-client", "field-client-name"],
            as: "client_name",
            label: "Name",
          },
        ],
        limit: 25,
      },
      parameters: [
        {
          key: "status",
          label: "Status",
          path: ["field-project-status"],
        },
      ],
      presentation: { block: "table", config: { density: "compact" } },
    };

    const draft = viewDraftFromDefinition(view, schemas);

    expect(draft).toMatchObject({
      fields: ["name", "client.name"],
      where: [{ field: "budget", op: "gte", value: 1000 }],
      expose: ["status"],
    });
    expect(viewDefinitionFromDraft(draft, schemas)).toEqual(view);
  });

  it("round-trips grouped measures and their relation display path", () => {
    const view: ViewDefinition = {
      id: "view-budget-by-client",
      key: "budget_by_client",
      label: "Budget by client",
      source: "project",
      query: {
        aggregate: {
          group: {
            path: ["field-project-client"],
            labelPath: ["field-project-client", "field-client-name"],
            as: "customer",
            label: "Customer",
          },
          measures: [
            { as: "project_count", label: "Number of projects", operation: "count" },
            {
              as: "total_budget",
              label: "Total Budget",
              operation: "sum",
              path: ["field-project-budget"],
            },
          ],
          sort: [{ key: "total_budget", direction: "desc" }],
        },
      },
    };

    const draft = viewDraftFromDefinition(view, schemas);

    expect(draft).toMatchObject({
      group_by: "client",
      group_alias: "customer",
      group_label: "Customer",
      group_label_path: "client.name",
      order_by: { total_budget: "desc" },
      measure_labels: { project_count: "Number of projects" },
    });
    expect(viewDefinitionFromDraft(draft, schemas)).toEqual(view);
  });

  it("retains stable aliases, labels, and parameter contracts across Field-key changes", () => {
    const customAlias: ViewDefinition = {
      id: "view-custom",
      key: "custom",
      label: "Custom",
      source: "project",
      query: {
        select: [
          { path: ["field-project-name"], as: "display_name", label: "Project display name" },
        ],
      },
      parameters: [
        {
          key: "current_status",
          label: "Current status",
          path: ["field-project-status"],
          required: false,
        },
      ],
    };
    const draft = viewDraftFromDefinition(customAlias, schemas);
    expect(draft).toMatchObject({
      aliases: { name: "display_name" },
      column_labels: { name: "Project display name" },
      parameters: {
        status: { key: "current_status", label: "Current status", required: false },
      },
    });
    expect(viewDefinitionFromDraft(draft, schemas)).toEqual(customAlias);
  });

  it("rejects canonical features the editor cannot preserve", () => {
    const nestedFilter: ViewDefinition = {
      id: "view-nested",
      key: "nested",
      label: "Nested",
      source: "project",
      query: {
        filter: {
          any: [
            { path: ["field-project-status"], operator: "eq", value: "open" },
            { path: ["field-project-status"], operator: "eq", value: "won" },
          ],
        },
      },
    };

    expect(() => viewDraftFromDefinition(nestedFilter, schemas)).toThrow(ViewAuthoringError);
  });
});
