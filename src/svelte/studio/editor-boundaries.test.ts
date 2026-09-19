/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

describe("Studio dependency boundary", () => {
  const directory = new URL("./", import.meta.url);
  const sources = readdirSync(directory).filter(
    (name) =>
      (name.endsWith(".svelte") || name.endsWith(".ts")) && !/\.(test|spec)\.ts$/.test(name),
  );
  it.each(sources)("%s stays independent of host globals and adapters", (name) => {
    const source = readFileSync(new URL(name, directory), "utf8");
    const runtimeSource = source.replace(/import\s+type\s+[^;]+;/g, "");
    expect(source).not.toMatch(/from\s+["']\$(?:app|lib)\//);
    expect(source).not.toMatch(/from\s+["'][^"']*(?:\/runtime\/|\/sqlite\/|session\.svelte)/);
    expect(runtimeSource).not.toMatch(/from\s+["']\.\.\/\.\.\/kernel\//);
  });
});
