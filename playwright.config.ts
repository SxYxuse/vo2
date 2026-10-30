import { readFileSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { E2E_BROWSER_PORT, E2E_URL } from "./e2e/env.ts";

const ci = Boolean(process.env.CI);

/**
 * The browser runs in Playwright's own image, here and in CI, because fonts and anti-aliasing
 * differ between machines and would fail screenshot comparisons that nothing on screen changed.
 * The image must match the installed @playwright/test exactly.
 */
const { version } = JSON.parse(
  readFileSync("node_modules/@playwright/test/package.json", "utf8"),
) as { version: string };
const browserContainer = `vo2-e2e-browser-${E2E_BROWSER_PORT}`;

/** Phone first (AGENTS.md): every spec runs at a phone size and again at desktop size. */
const phone = devices["Pixel 7"];
const desktop = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "e2e/screenshots/{projectName}/{arg}{ext}",
  // Mock Strava has one athlete, so specs share it and run one at a time.
  workers: 1,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: E2E_URL,
    locale: "en-GB",
    timezoneId: "Europe/Brussels",
    colorScheme: "light",
    reducedMotion: "reduce",
    // A cached service worker would serve the last run's build; offline gets its own spec later.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    // <loopback> sends the container's localhost back to this machine, where the app runs.
    connectOptions: {
      wsEndpoint: `ws://127.0.0.1:${E2E_BROWSER_PORT}/`,
      exposeNetwork: "<loopback>",
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /athlete\.setup\.ts/,
      teardown: "teardown",
      use: phone,
    },
    {
      name: "teardown",
      testMatch: /athlete\.teardown\.ts/,
      use: { ...phone, storageState: "e2e/.auth/athlete.json" },
    },
    {
      name: "phone",
      dependencies: ["setup"],
      use: { ...phone, storageState: "e2e/.auth/athlete.json" },
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: { ...desktop, storageState: "e2e/.auth/athlete.json" },
    },
  ],
  webServer: [
    {
      command: "vp build && bun e2e/serve.ts",
      url: E2E_URL,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // Removes a container a killed run left behind, then serves the browser until the run ends.
      command:
        `docker rm -f ${browserContainer} >/dev/null 2>&1; ` +
        `docker run --rm --init --name ${browserContainer} -p ${E2E_BROWSER_PORT}:${E2E_BROWSER_PORT} ` +
        `--workdir /home/pwuser --user pwuser mcr.microsoft.com/playwright:v${version}-noble ` +
        `npx -y playwright@${version} run-server --port ${E2E_BROWSER_PORT} --host 0.0.0.0`,
      // Docker opens the port at once; the server answers HTTP only once it listens.
      url: `http://127.0.0.1:${E2E_BROWSER_PORT}/`,
      reuseExistingServer: false,
      timeout: 300_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
