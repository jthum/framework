import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const docs = resolve(root, "docs");
const markdownFiles = [
  resolve(root, "AGENTS.md"),
  resolve(root, "README.md"),
  ...readdirSync(docs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(entry.parentPath, entry.name)),
];

describe("documentation", () => {
  it("keeps local Markdown links valid", () => {
    expect.hasAssertions();
    for (const file of markdownFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = match[1]?.trim();
        if (!href || /^(?:#|https?:|mailto:)/.test(href)) continue;
        const target = decodeURIComponent(href.split("#", 1)[0]!);
        expect(existsSync(resolve(dirname(file), target)), `${file} -> ${href}`).toBe(true);
      }
    }
  });

  it("documents every published package entry point", () => {
    expect.hasAssertions();
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      name: string;
      exports: Record<string, unknown>;
    };
    const apiMap = readFileSync(resolve(docs, "public-api.md"), "utf8");

    for (const entry of Object.keys(packageJson.exports)) {
      const specifier = entry === "." ? packageJson.name : `${packageJson.name}/${entry.slice(2)}`;
      expect(apiMap, `Missing ${specifier} from docs/public-api.md`).toContain(`\`${specifier}\``);
    }
  });
});
