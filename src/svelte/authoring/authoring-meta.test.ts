import { describe, expect, it } from "vite-plus/test";
import { isAuthoringManaged, withAuthoringManaged } from "./authoring-meta.js";

describe("authoring metadata", () => {
  it("adds and removes the managed hint without disturbing host metadata", () => {
    const managed = withAuthoringManaged({ host: { icon: "table" } }, true);
    expect(managed).toEqual({ host: { icon: "table" }, authoring: { managed: true } });
    expect(isAuthoringManaged(managed)).toBe(true);
    expect(withAuthoringManaged(managed, false)).toEqual({ host: { icon: "table" } });
  });
});
