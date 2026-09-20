import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import RuleSteps from "./automation-step-list.svelte";

describe("Actor binding authoring", () => {
  it("offers semantic Actor bindings without exposing runtime Actor IDs", () => {
    const body = render(RuleSteps, {
      props: {
        steps: [{ id: "ask", effect: { key: "inference.run", runAs: "researcher" } }],
        onStepsChange: () => {},
        inputName: "values",
        inputType: "",
        types: [],
        workflows: [],
        effects: [{ key: "inference.run", label: "Ask an Agent" }],
        actorOptions: [{ key: "researcher", label: "Researcher" }],
        recordInput: false,
      },
    }).body;

    expect(body).toContain("Run as");
    expect(body).toContain("Researcher");
    expect(body).toContain("What should the Agent do?");
    expect(body).toContain(
      "Choose an Agent only when this step should use that teammate’s instructions",
    );
    expect(body).not.toContain("actor-runtime-id");
  });
});
