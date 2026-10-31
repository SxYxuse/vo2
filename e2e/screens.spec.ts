import { test, expect, settle, syncButton } from "./test.ts";

// One screenshot per screen, at phone and desktop size. A diff fails the run and the HTML report
// shows expected, actual, and the difference side by side. After an intended change, update the
// baselines with `vp run e2e:update` and review the new images in the pull request.

const SCREENS = [
  { name: "calendar", path: "/", heading: "Activity calendar" },
  { name: "week", path: "/week", heading: "This week" },
  { name: "plan", path: "/plan", heading: null },
  { name: "fitness", path: "/fitness", heading: null },
  { name: "season", path: "/season", heading: null },
  { name: "bests", path: "/bests", heading: null },
  { name: "heart-rate", path: "/heart-rate", heading: null },
  { name: "map", path: "/map", heading: null },
  { name: "settings", path: "/settings/profile", heading: null },
  { name: "settings-training", path: "/settings/training", heading: null },
  { name: "settings-paces", path: "/settings/paces", heading: null },
  { name: "settings-coach", path: "/settings/coach", heading: null },
] as const;

for (const screen of SCREENS) {
  test(`${screen.name} screen`, async ({ page }) => {
    await page.goto(screen.path);
    if (screen.heading) {
      await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
    }
    await settle(page);
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
      mask: [syncButton(page), page.locator(".maplibregl-canvas")],
    });
  });
}

test("activity screen", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  await page.locator("[data-event-id]").filter({ hasText: "Lunch run" }).first().click();
  await page.waitForURL(/\/activities\//);
  await settle(page);
  await expect(page).toHaveScreenshot("activity.png", {
    fullPage: true,
    mask: [syncButton(page), page.locator(".maplibregl-canvas")],
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();
    await expect(page).toHaveScreenshot("signed-out.png", { fullPage: true });
  });
});
