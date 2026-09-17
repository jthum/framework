import { describe, expect, it } from "vite-plus/test";
import { isStudioManaged, withStudioManaged } from "./studio-meta.js";

describe("Studio metadata", () => {
  it("adds and removes the managed hint without disturbing host metadata", () => {
    const managed = withStudioManaged({ host: { icon: "table" } }, true);
    expect(managed).toEqual({ host: { icon: "table" }, studio: { managed: true } });
    expect(isStudioManaged(managed)).toBe(true);
    expect(withStudioManaged(managed, false)).toEqual({ host: { icon: "table" } });
  });
});
