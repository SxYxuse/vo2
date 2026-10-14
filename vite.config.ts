import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      "src/components/reui/**",
      "src/components/ui/map.tsx",
      "src/integrations/strava/strava.types.ts",
      "src/integrations/strava/openapi.json",
    ],
  },
  resolve: { tsconfigPaths: true },
  plugins: lazyPlugins(() => [devtools(), tailwindcss(), tanstackStart(), viteReact()]),
});

export default config;
