import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";
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

/** Busts the offline copy saved by another build, whose data shapes may differ (ADR 0031). */
const BUILD_ID = Date.now().toString(36);

const config = defineConfig({
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID),
  },
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
  server: {
    // BETTER_AUTH_URL names this port, so sliding onto another one would break sign-in.
    port: Number(loadEnv("development", process.cwd(), "PORT").PORT) || 3000,
    strictPort: true,
  },
  build: {
    // MapLibre alone is about 1 MB minified and loads only with the map page; every other
    // chunk stays well under the 500 kB default.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
  plugins: isTest
    ? []
    : lazyPlugins(() => [
        devtools(),
        tailwindcss(),
        tanstackStart({
          router: {
            codeSplittingOptions: {
              // TanStack keeps pending components in the entry by default, and with them every
              // component file a skeleton imports from; ship each with its page instead.
              defaultBehavior: [
                ["component", "pendingComponent"],
                ["errorComponent"],
                ["notFoundComponent"],
              ],
            },
          },
        }),
        nitro({
          preset: "bun",
          // Bun serves files raw; ship .br and .gz copies so phones download a fraction of the JS.
          compressPublicAssets: { gzip: true, brotli: true },
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
