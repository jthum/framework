import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { expect, it } from "vite-plus/test";

it.each(["spec", "kernel"])(
  "keeps unused People components and Svelte out of a %s consumer bundle",
  async (kind) => {
    const modules: string[] = [];
    const exports: string[] = [];
    await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "consumer-fixture",
          generateBundle(_options, bundle) {
            for (const output of Object.values(bundle))
              if (output.type === "chunk") {
                modules.push(...Object.keys(output.modules));
                exports.push(...output.exports);
              }
          },
        },
      ],
      build: {
        write: false,
        lib: {
          entry: fileURLToPath(
            new URL(`../../testing/bundle/${kind}-consumer.ts`, import.meta.url),
          ),
          formats: ["es"],
        },
        minify: false,
      },
    });
    expect(exports).toContain(kind === "spec" ? "createEmptySpec" : "Kernel");
    expect(modules.filter((id) => /\/svelte\/|\/people\/|\/bits-ui\//.test(id))).toEqual([]);
  },
);
