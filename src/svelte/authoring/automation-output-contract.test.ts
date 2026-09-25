import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import AutomationOutputContract from "./automation-output-contract.svelte";

describe("Rule output contract editor", () => {
  it("renders nested declared fields without asking for a closed external schema", () => {
    const body = render(AutomationOutputContract, {
      props: {
        value: {
          type: "object",
          fields: {
            review: {
              type: "object",
              fields: { verdict: { type: "text", required: true } },
            },
          },
        },
        onValueChange: () => {},
      },
    }).body;
    expect(body).toContain("review");
    expect(body).toContain("verdict");
    expect(body).toContain("Extra object fields remain allowed");
  });
});
