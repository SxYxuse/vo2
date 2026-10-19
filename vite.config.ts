import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const isTest = process.env.VITEST === "true";

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
  staged: {
    "*": "vp check --fix",
  },
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
  },
  plugins: isTest
    ? []
    : lazyPlugins(() => [
        devtools(),
        tailwindcss(),
        tanstackStart(),
        nitro({ preset: "bun" }),
        viteReact(),
      ]),
});

export default config;
