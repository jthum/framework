import { describe, expect, it } from "vite-plus/test";
import type { CollectionDefinition, SourceSelection } from "./model.ts";
import { assertValidSourceQuery } from "./validate.ts";
import { projectValues, projectionKey, readProjection } from "./projection.ts";

const collection: CollectionDefinition = {
  id: "projects",
  key: "project",
  label: "Project",
  fields: [{ id: "name", key: "name", label: "Name", type: "text" }],
};

describe("explicit projection outputs", () => {
  it("assembles and reads nested plain values while preserving null, absence and falsy leaves", () => {
    const values = { name: "Launch", empty: null, zero: 0, off: false };
    const selection: SourceSelection[] = [
      { path: ["name"], as: ["project", "name"] },
      { path: ["empty"], as: ["project", "note"] },
      { path: ["zero"], as: "count" },
      { path: ["off"], as: ["flags", "active"] },
      { path: ["absent"], as: ["missing", "name"] },
    ];
    const result = projectValues(selection, ([key]) => values[key as keyof typeof values]);
    expect(result).toEqual({
      project: { name: "Launch", note: null },
      count: 0,
      flags: { active: false },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(readProjection(result, ["project", "name"])).toBe("Launch");
    expect(readProjection(result, ["project", "note"])).toBeNull();
    expect(readProjection(result, "count")).toBe(0);
    expect(readProjection(result, ["flags", "active"])).toBe(false);
    expect(readProjection(result, ["missing", "name"])).toBeUndefined();
    expect(readProjection(result, "toString")).toBeUndefined();
    expect(projectionKey(["project", "name"])).toBe("project.name");
    expect(projectionKey("project_name")).toBe("project_name");
  });

  it("allows sibling outputs and protects own properties with ordinary semantic names", () => {
    const query = {
      select: [
        { path: ["name"], as: ["constructor", "name"] },
        { path: ["name"], as: ["constructor", "label"] },
      ],
    };
    expect(() => assertValidSourceQuery(query, collection)).not.toThrow();
    expect(projectValues(query.select, () => "Launch")).toEqual({
      constructor: { name: "Launch", label: "Launch" },
    });
    expect(Object.prototype).not.toHaveProperty("label");
  });

  it.each([
    ["project", ["project", "name"]],
    [["project", "name"], "project"],
    [
      ["project", "name"],
      ["project", "name"],
    ],
    ["project", ["project"]],
  ] as const)("rejects duplicate or overlapping outputs %j and %j", (first, second) => {
    expect(() =>
      assertValidSourceQuery(
        {
          select: [
            { path: ["name"], as: first },
            { path: ["name"], as: second },
          ],
        },
        collection,
      ),
    ).toThrow(expect.objectContaining({ code: "VALIDATION.INVALID_INPUT" }));
  });

  it.each([[], [""], ["project.name"], ["project", "__proto__"], ["project", 1]].map((as) => [as]))(
    "rejects an invalid output path %j",
    (as) => {
      expect(() =>
        assertValidSourceQuery({ select: [{ path: ["name"], as }] }, collection),
      ).toThrow(expect.objectContaining({ code: "VALIDATION.INVALID_INPUT" }));
    },
  );
});
