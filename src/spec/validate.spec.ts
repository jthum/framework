import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { Spec } from "./model.ts";
import { assertValidSpec, validateFieldValue, validateSpec } from "./validate.ts";

describe("portable Collection Spec", () => {
  it("accepts typed Fields, references, conditions, and lifecycle definitions", () => {
    expect.hasAssertions();

    expect(validateSpec(projectSpec())).toEqual([]);
  });

  it("rejects validation rules unsupported by a Field type at a JSON boundary", () => {
    expect.hasAssertions();
    const spec = structuredClone(projectSpec()) as unknown as {
      collections: Array<{ fields: Array<Record<string, unknown>> }>;
    };
    spec.collections[0]?.fields.push({
      id: "field-invalid",
      key: "invalid",
      label: "Invalid",
      type: "text",
      validation: { min: 1 },
    });

    expect(validateSpec(spec)).toContainEqual(
      expect.objectContaining({
        path: "collections.0.fields.3.validation.min",
        code: "SPEC.FIELD_VALIDATION_UNSUPPORTED",
      }),
    );
    expect(() => assertValidSpec(spec)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.specInvalid }),
    );
  });

  it("requires globally unique definition IDs and resolvable references", () => {
    expect.hasAssertions();
    const spec = projectSpec();
    const invalid: Spec = {
      ...spec,
      collections: [
        {
          ...spec.collections[0]!,
          fields: [
            ...spec.collections[0]!.fields,
            {
              id: "field-name",
              key: "owner",
              label: "Owner",
              type: "reference",
              sourceId: "missing-collection",
            },
          ],
        },
      ],
    };
    const issues = validateSpec(invalid);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPEC.ID_DUPLICATE" }),
        expect.objectContaining({ code: "SPEC.REFERENCE_UNRESOLVED" }),
      ]),
    );
  });

  it("validates record values with Field-specific rules", () => {
    expect.hasAssertions();
    const fields = projectSpec().collections[0]!.fields;
    const issues: Array<{ path: string; code: string; message: string }> = [];

    validateFieldValue(fields[0]!, "A", "values.name", issues);
    validateFieldValue(fields[1]!, "unknown", "values.status", issues);
    validateFieldValue(fields[2]!, -1, "values.budget", issues);

    expect(issues.map((item) => item.code)).toEqual([
      "VALIDATION.MIN_LENGTH",
      "VALIDATION.CHOICE",
      "VALIDATION.MIN",
    ]);
  });

  it("validates Views against one root Source and declared relationship paths", () => {
    expect.hasAssertions();
    const spec = projectSpec();
    const withView: Spec = {
      ...spec,
      views: [
        {
          id: "view-active-projects",
          key: "active_projects",
          label: "Active projects",
          source: "project",
          query: {
            filter: { path: ["field-status"], operator: "eq", value: "active" },
            select: [{ path: ["field-name"], as: "name" }],
          },
          presentation: { block: "table" },
        },
      ],
    };
    expect(validateSpec(withView)).toEqual([]);
    expect(
      validateSpec({
        ...withView,
        views: [
          {
            ...withView.views[0]!,
            query: {
              select: [{ path: ["field-name", "field-status"], as: "joined_without_reference" }],
            },
          },
        ],
      }),
    ).toContainEqual(expect.objectContaining({ code: "SPEC.RELATION_INVALID" }));
  });

  it("rejects ambiguous and empty Source filter groups", () => {
    expect.hasAssertions();
    const spec = projectSpec();
    const view = {
      id: "view-projects",
      key: "projects",
      label: "Projects",
      source: "project",
      query: { filter: { all: [], any: [] } },
    };
    expect(validateSpec({ ...spec, views: [view] })).toContainEqual(
      expect.objectContaining({ code: "SPEC.FILTER_SHAPE_INVALID" }),
    );
    expect(
      validateSpec({
        ...spec,
        views: [{ ...view, query: { filter: { all: [] } } }],
      }),
    ).toContainEqual(
      expect.objectContaining({
        path: "views.0.query.filter.all",
        code: "SPEC.TYPE_INVALID",
      }),
    );
  });

  it("validates collection and standalone Forms with stable Field references", () => {
    expect.hasAssertions();
    const spec = projectSpec();
    const withForms: Spec = {
      ...spec,
      forms: [
        {
          id: "form-create-project",
          key: "create_project",
          label: "Create project",
          mode: "create",
          collectionId: "collection-project",
          fieldIds: ["field-name", "field-budget"],
        },
        {
          id: "form-contact",
          key: "contact_us",
          label: "Contact us",
          mode: "standalone",
          fields: [
            {
              id: "field-contact-email",
              key: "email",
              label: "Email",
              type: "text",
              format: "email",
              required: true,
            },
          ],
          submit: { success: { title: "Thanks" } },
        },
      ],
    };
    expect(validateSpec(withForms)).toEqual([]);
    expect(
      validateSpec({
        ...withForms,
        forms: [{ ...withForms.forms[0]!, fieldIds: ["field-name", "field-name", "missing"] }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPEC.REFERENCE_DUPLICATE" }),
        expect.objectContaining({ code: "SPEC.REFERENCE_UNRESOLVED" }),
      ]),
    );
  });

  it("validates Page layout nodes separately from Blocks", () => {
    expect.hasAssertions();
    const spec: Spec = {
      ...projectSpec(),
      pages: [
        {
          id: "page-dashboard",
          key: "dashboard",
          label: "Dashboard",
          layout: [
            { id: "block-heading", kind: "block", block: "heading", config: { text: "Hello" } },
            {
              id: "group-overview",
              kind: "group",
              columns: 2,
              children: [{ id: "block-table", kind: "block", block: "table" }],
            },
          ],
        },
      ],
    };
    expect(validateSpec(spec)).toEqual([]);
    expect(
      validateSpec({
        ...spec,
        pages: [
          {
            ...spec.pages[0]!,
            layout: [
              {
                id: "group-overview",
                kind: "group",
                columns: 13,
                children: [{ id: "group-overview", kind: "block", block: "Not valid" }],
              },
            ],
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPEC.RANGE_INVALID" }),
        expect.objectContaining({ code: "SPEC.KEY_INVALID" }),
        expect.objectContaining({ code: "SPEC.ID_DUPLICATE" }),
      ]),
    );
  });
});

function projectSpec(): Spec {
  return {
    version: 2,
    id: "spec-projects",
    key: "projects_app",
    label: "Projects",
    collections: [
      {
        id: "collection-project",
        key: "project",
        label: "Project",
        titleFieldId: "field-name",
        fields: [
          {
            id: "field-name",
            key: "name",
            label: "Name",
            type: "text",
            required: true,
            validation: { minLength: 2 },
          },
          {
            id: "field-status",
            key: "status",
            label: "Status",
            type: "choice",
            options: [
              { id: "choice-draft", key: "draft", label: "Draft" },
              { id: "choice-active", key: "active", label: "Active" },
              { id: "choice-done", key: "done", label: "Done" },
            ],
          },
          {
            id: "field-budget",
            key: "budget",
            label: "Budget",
            type: "number",
            format: "currency",
            currency: "USD",
            validation: { min: 0 },
            behavior: {
              visibleWhen: { fieldId: "field-status", operator: "neq", value: "draft" },
            },
          },
        ],
        lifecycle: {
          fieldId: "field-status",
          initial: "draft",
          terminal: ["done"],
          transitions: [
            {
              id: "transition-activate",
              key: "activate",
              label: "Activate",
              from: ["draft"],
              to: "active",
            },
            {
              id: "transition-complete",
              key: "complete",
              label: "Complete",
              from: ["active"],
              to: "done",
            },
          ],
        },
      },
    ],
    sources: [],
    views: [],
    forms: [],
    pages: [],
    rules: [],
  };
}
