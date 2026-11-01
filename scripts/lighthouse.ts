/*
 * Lighthouse CI on the sign-in page, then on the screens a signed-in athlete opens most, as an
 * athlete onboarded against mock Strava. Needs `vp build` and a migrated database; serves the build
 * itself (lighthouserc.json holds the run count and the assertions).
 *
 *   bun scripts/lighthouse.ts [extra lhci collect flags]
 */

import { execFileSync, spawn } from "node:child_process";

import { chromium } from "@playwright/test";

import { onboardNewAthlete } from "../e2e/onboard.ts";

const BASE = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
const extraFlags = process.argv.slice(2);

function lhci(...args: string[]) {
  execFileSync("vp", ["dlx", "@lhci/cli@0.15.1", ...args], { stdio: "inherit" });
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/sign-in`).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The server did not answer on ${BASE} within a minute`);
}

/** Onboards a new athlete and returns their session cookie and one of their activities. */
async function signedInAthlete() {
  const browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
  );
  try {
    const context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await onboardNewAthlete(page);
    await page.goto("/");
    const activity = page.locator("[data-event-id]").first();
    // Early in a month the calendar's current period has no activity yet: step back one.
    const shown = await activity.waitFor({ timeout: 10_000 }).then(
      () => true,
      () => false,
    );
    if (!shown) await page.getByRole("button", { name: /^Previous / }).click();
    await activity.click();
    await page.waitForURL(/\/activities\//);
    const cookie = (await context.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
    return { cookie, activityPath: new URL(page.url()).pathname };
  } finally {
    await browser.close();
  }
}

const server = spawn("bun", ["run", ".output/server/index.mjs"], {
  stdio: ["ignore", "ignore", "inherit"],
});
try {
  await waitForServer();
  lhci("collect", `--url=${BASE}/sign-in`, ...extraFlags);

  const { cookie, activityPath } = await signedInAthlete();
  lhci(
    "collect",
    "--additive",
    `--url=${BASE}/`,
    `--url=${BASE}/week`,
    `--url=${BASE}${activityPath}`,
    `--settings.extraHeaders=${JSON.stringify({ Cookie: cookie })}`,
    ...extraFlags,
  );

  // Upload first, so a failed assertion still leaves the reports for the pull request.
  lhci("upload");
  lhci("assert");
} finally {
  server.kill();
}
