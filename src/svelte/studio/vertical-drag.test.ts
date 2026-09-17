import { describe, expect, it } from "vite-plus/test";
import { reorderAtVerticalTarget } from "./vertical-drag.js";

describe("vertical sorting", () => {
  const items = ["first", "second", "third"];
  const keyOf = (item: string) => item;

  it("moves down only after crossing the target midpoint", () => {
    expect(reorderAtVerticalTarget(items, "first", { key: "second", after: false }, keyOf)).toBe(
      items,
    );
    expect(reorderAtVerticalTarget(items, "first", { key: "second", after: true }, keyOf)).toEqual([
      "second",
      "first",
      "third",
    ]);
  });

  it("moves up only before crossing the target midpoint", () => {
    expect(reorderAtVerticalTarget(items, "third", { key: "second", after: true }, keyOf)).toBe(
      items,
    );
    expect(reorderAtVerticalTarget(items, "third", { key: "second", after: false }, keyOf)).toEqual(
      ["first", "third", "second"],
    );
  });
});
