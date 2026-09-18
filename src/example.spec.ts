import { describe, expect, it } from "vite-plus/test";
import { openMinimalHost } from "../examples/minimal-host.ts";

describe("minimal host example", () => {
  it("applies the Spec and queries a created record", async () => {
    expect.hasAssertions();
    const { kernel, client } = await openMinimalHost();
    try {
      const created = await client.createRecord("task", {
        title: "Read the Framework guide",
      });
      const result = await client.queryView("open_tasks");

      expect(created.values).toEqual({ title: "Read the Framework guide", done: false });
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.rows[0]?.id).toBe(created.id);
    } finally {
      await kernel.close();
    }
  });
});
