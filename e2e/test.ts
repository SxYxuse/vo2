import { test as base, expect, type Locator, type Page } from "@playwright/test";

import { E2E_NOW, E2E_URL } from "./env.ts";

/**
 * Every page starts at the server's clock (e2e/fixed-clock.ts), so "today" matches the data, and
 * never leaves the app: map tiles and the like would make runs depend on the network.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.install({ time: new Date(E2E_NOW) });
    await page.route(
      (url) => url.origin !== E2E_URL,
      (route) => route.abort(),
    );
    await use(page);
  },
});

export { expect, type Locator, type Page };

/** Waits until the page has its data: no requests in flight and no skeleton left. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
}

/** "Synced just now" turns into "Synced 1 min ago" while the suite runs. */
export function syncButton(page: Page) {
  return page.getByRole("button", { name: /Sync from Strava/ });
}
