import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const packages = [
  ".",
  "packages/http",
  "packages/sqlite/browser",
  "packages/inference/yair/core",
  "packages/inference/yair/providers/openai",
];

describe("installable packages", () => {
  it.each(packages)("ships compiled and development exports for %s", (directory) => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../${directory}/package.json`, import.meta.url)), "utf8"),
    );
    expect(manifest.files).toEqual(expect.arrayContaining(["src", "dist"]));
    expect(manifest.scripts.prepack).toBe(
      directory === "." ? "vp pack" : `vp run --filter ${manifest.name}... build`,
    );
    if (directory !== ".") {
      expect(manifest.peerDependencies["@jthum/framework"]).toBe("0.0.0");
      expect(manifest.devDependencies["@jthum/framework"]).toBe("workspace:*");
      expect(manifest.dependencies?.["@jthum/framework"]).toBeUndefined();
    }
  });
});
