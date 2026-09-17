import { describe, expect, it } from "vite-plus/test";
import { cloneData, conditionFieldKeys, renameConditionField, uniqueKey } from "./editor-data.js";
describe("Studio authoring data", () => {
  it("hands a host plain independent data, preserving arbitrary metadata keys", () => {
    const original = new Proxy({ meta: { fields: { values: [1, 2] }, custom: "kept" } }, {});
    const copy = cloneData(original);
    expect(structuredClone(copy)).toEqual(original);
    copy.meta.fields.values.push(3);
    expect(original.meta.fields.values).toEqual([1, 2]);
  });
  it("renames only field references in nested conditions", () => {
    const condition = { all: [{ field: "name", value: "name" }, { not: { field: "other" } }] };
    const result = renameConditionField(condition, "name", "title");
    expect(conditionFieldKeys(result)).toEqual(["title", "other"]);
    expect(result).toEqual({
      all: [{ field: "title", value: "name" }, { not: { field: "other" } }],
    });
    expect(condition.all[0]?.field).toBe("name");
  });
  it("makes duplicate keys deterministic without allocating persisted identities", () => {
    expect(uniqueKey("Contact", ["contact", "contact_2"])).toBe("contact_3");
  });
});
