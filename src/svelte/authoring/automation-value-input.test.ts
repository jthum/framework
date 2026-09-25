import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import AutomationValueInput from "./automation-value-input.svelte";

describe("Rule value input", () => {
  it("presents an authored selection as a readable expression with an edit control", () => {
    const body = render(AutomationValueInput, {
      props: {
        value: {
          $select: {
            from: { $ref: "vars.responses" },
            where: { path: "actor", op: "ne", value: { $ref: "vars.reviewer" } },
          },
        },
        onValueChange: () => {},
      },
    }).body;
    expect(body).toContain("Select from =vars.responses where actor ≠ =vars.reviewer");
    expect(body).toContain("Edit list selection");
  });
});
