import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const isTest = process.env.VITEST === "true";

/**
 * Nitro's own ignored codes, which this `onwarn` replaces, plus the `"use client"` directives
 * React libraries ship: the server bundle has no client boundary for them to mark.
 */
const IGNORED_SERVER_WARNINGS = new Set([
  "EVAL",
  "CIRCULAR_DEPENDENCY",
  "THIS_IS_UNDEFINED",
  "EMPTY_BUNDLE",
  "MODULE_LEVEL_DIRECTIVE",
]);

const config = defineConfig({
  ssr: {
    external: ["winston", "winston-loki"],
  },
  fmt: {
    ignorePatterns: [
      "drizzle/meta/**",
      "src/components/ui/**",
      "src/integrations/strava/strava.types.ts",
      "src/integrations/strava/openapi.json",
      "src/routeTree.gen.ts",
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      "src/components/reui/**",
      "src/components/ui/**",
      "src/integrations/strava/strava.types.ts",
      "src/integrations/strava/openapi.json",
    ],
  },
  resolve: { tsconfigPaths: true },
  build: {
    // MapLibre alone is about 1 MB minified and loads only with the map page; every other
    // chunk stays well under the 500 kB default.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  plugins: isTest
    ? []
    : lazyPlugins(() => [
        devtools(),
        tailwindcss(),
        tanstackStart(),
        nitro({
          preset: "bun",
          rolldownConfig: {
            onwarn(warning, warn) {
              if (!IGNORED_SERVER_WARNINGS.has(warning.code ?? "")) warn(warning);
            },
          },
        }),
        viteReact(),
      ]),
});

export default config;
