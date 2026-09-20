/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const roots = ["authoring", "operations", "settings", "internal"] as const;

function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory).flatMap((name) => {
    const file = new URL(name, directory);
    if (statSync(file).isDirectory()) return sourceFiles(new URL(`${name}/`, directory));
    if (!name.endsWith(".svelte") && !name.endsWith(".ts")) return [];
    if (/\.(test|spec)\.ts$/.test(name)) return [];
    return [file];
  });
}

describe("Svelte integration boundaries", () => {
  const directory = new URL("./", import.meta.url);
  const sources = roots.flatMap((root) =>
    sourceFiles(new URL(`${root}/`, directory)).map((file) => ({
      file,
      name: decodeURIComponent(file.pathname).split("/src/svelte/").at(-1) ?? file.pathname,
    })),
  );

  it.each(sources)("$name stays independent of host globals and adapters", ({ file }) => {
    const source = readFileSync(file, "utf8");
    const runtimeSource = source.replace(/import\s+type\s+[^;]+;/g, "");
    expect(source).not.toMatch(/from\s+["']\$(?:app|lib)\//);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:\/runtime\/|\/sqlite\/|session\.svelte)/);
    expect(runtimeSource).not.toMatch(/from\s+["']\.\.\/\.\.\/kernel\//);
  });

  it("keeps internal implementation private and removes the old Studio namespace", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      exports: Record<string, unknown>;
    };
    const exports = Object.keys(packageJson.exports);

    expect(exports.some((entry) => entry.includes("/studio"))).toBe(false);
    expect(exports.some((entry) => entry.includes("/internal"))).toBe(false);
    expect(exports).not.toContain("./svelte/*");
  });
});
