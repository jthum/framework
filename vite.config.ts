import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";

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
    expect: { requireAssertions: true },
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}"],
  },
  pack: {
    entry: [
      "src/index.ts",
      "src/blocks/index.ts",
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
