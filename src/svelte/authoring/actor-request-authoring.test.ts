import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import RuleSteps from "./automation-step-list.svelte";

describe("ActorRequest authoring", () => {
  it("renders user request authoring with shared fields and no runtime reads", () => {
    const body = render(RuleSteps, {
      props: {
        steps: [
          {
            id: "ask",
            wait: {
              request: {
                label: "Review expense",
                fields: [
                  {
                    id: "answer",
                    key: "approved",
                    label: "Approve?",
                    type: "boolean",
                    required: true,
                  },
                ],
              },
              as: "review",
            },
          },
        ],
        onStepsChange: () => {},
        inputName: "values",
        inputType: "",
        types: [],
        workflows: [],
        actorRequests: true,
        recordInput: false,
      },
    }).body;
    expect(body).toContain("Request title");
    expect(body).toContain("Response fields");
    expect(body).toContain("Approve?");
    expect(body).toContain("Assigned actor binding");
    expect(body).not.toContain("Optional signal key");
  });
});
