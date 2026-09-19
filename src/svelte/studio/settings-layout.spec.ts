import { describe, expect, it } from "vite-plus/test";
import type { FieldDefinition } from "../../spec/model.ts";
import { layoutSettings, parseSettingDraft, settingDraft } from "./settings-layout.ts";

const text: FieldDefinition = {
  id: "field-provider",
  key: "web.search.provider",
  label: "Search provider",
  type: "text",
  required: true,
  validation: { minLength: 3 },
};

describe("host settings layout", () => {
  it("keeps stable keys separate from visual placement", () => {
    const controls = layoutSettings({
      tabs: [
        {
          key: "integrations",
          label: "Integrations",
          sections: [{ key: "search", label: "Search", settings: [{ field: text }] }],
        },
      ],
    });
    expect(controls.map((control) => control.field.key)).toEqual(["web.search.provider"]);
  });

  it("rejects duplicate keys and non-text secrets", () => {
    expect(() =>
      layoutSettings({
        tabs: [
          {
            key: "a",
            label: "A",
            sections: [{ key: "one", label: "One", settings: [{ field: text }, { field: text }] }],
          },
        ],
      }),
    ).toThrow(/unique/);
    expect(() =>
      layoutSettings({
        tabs: [
          {
            key: "a",
            label: "A",
            sections: [
              {
                key: "one",
                label: "One",
                settings: [
                  {
                    field: { id: "b", key: "enabled", label: "Enabled", type: "boolean" },
                    secret: true,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(/text field/);
  });

  it("reuses field parsing and validation for typed values", () => {
    const count: FieldDefinition = {
      id: "field-count",
      key: "max_results",
      label: "Max results",
      type: "number",
      validation: { min: 1, integer: true },
    };
    expect(parseSettingDraft(count, "12")).toBe(12);
    expect(() => parseSettingDraft(count, "0")).toThrow();
    expect(() => parseSettingDraft(text, "a")).toThrow();
    expect(settingDraft(count, 12)).toBe("12");
    expect(
      parseSettingDraft({ id: "b", key: "enabled", label: "Enabled", type: "boolean" }, "false"),
    ).toBe(false);
  });
});
