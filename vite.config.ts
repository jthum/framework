import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  fmt: {},
  lint: {
    ignorePatterns: ["src/svelte/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    // Self-imports must exercise current source, not stale or rebuilding dist files.
    alias: [
      {
        find: /^@jthum\/framework$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
      {
        find: /^@jthum\/yair$/,
        replacement: fileURLToPath(
          new URL("./packages/inference/yair/core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@jthum\/yair-openai$/,
        replacement: fileURLToPath(
          new URL("./packages/inference/yair/providers/openai/src/index.ts", import.meta.url),
        ),
      },
      ...["client", "kernel", "spec", "errors", "persistence", "blocks", "catalog", "sqlite"].map(
        (key) => ({
          find: new RegExp(`^@jthum/framework/${key}$`),
          replacement: fileURLToPath(new URL(`./src/${key}/index.ts`, import.meta.url)),
        }),
      ),
    ],
    expect: { requireAssertions: true },
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}", "packages/inference/**/*.{test,spec}.{js,ts}"],
  },
  pack: {
    entry: [
      "src/index.ts",
      "src/blocks/index.ts",
      "src/catalog/index.ts",
      "src/client/index.ts",
      "src/errors/index.ts",
      "src/kernel/index.ts",
      "src/persistence/index.ts",
      "src/spec/index.ts",
      "src/sqlite/index.ts",
      "src/sqlite/node-index.ts",
    ],
    dts: true,
    format: ["esm"],
    sourcemap: true,
  },
});
