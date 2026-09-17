import { describe, expect, it } from "vite-plus/test";
import type { EditorContext } from "./authoring.js";
import { ruleSummary } from "./rule-summary.js";

const context = {
  collections: [
    {
      id: "collection-project",
      key: "project",
      label: "Projects",
      fields: [{ id: "field-status", key: "status", label: "Status", type: "text" }],
    },
  ],
  views: [],
  forms: [{ id: "form-intake", key: "intake", label: "Project intake", mode: "standalone" }],
  rules: [],
} satisfies EditorContext;

describe("Rule summaries", () => {
  it("describes automatic and manual rules from canonical drafts", () => {
    expect(
      ruleSummary(
        {
          id: "rule-one",
          key: "notify",
          label: "Notify",
          trigger: { key: "project.status.changed" },
          steps: [{ effect: { key: "records.update", params: {} } }],
        },
        context,
      ),
    ).toBe("When Projects status changes · 1 step");

    expect(
      ruleSummary(
        {
          id: "rule-two",
          key: "approve",
          label: "Approve",
          input: { project: { record: "project" } },
          steps: [],
        },
        context,
      ),
    ).toBe("On Projects");
  });

  it("counts nested steps", () => {
    expect(
      ruleSummary(
        {
          id: "rule-three",
          key: "submitted",
          label: "Submitted",
          trigger: { key: "form.submitted", config: { form: "intake" } },
          steps: [
            {
              gate: {
                predicate: { path: "trigger.id", op: "present" },
                pass: [{ effect: { key: "records.create", params: {} } }],
                fail: [],
              },
            },
          ],
        },
        context,
      ),
    ).toBe("When Project intake is submitted · 2 steps");
  });
});
