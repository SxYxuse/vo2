import { test, expect, settle, syncButton } from "./test.ts";

// Mock BRouter draws loops through the waypoints with made-up OSM tags, so the proposals, their
// confidence, and the screenshot are the same on every run.

test("an athlete finds loops in a zone, picks one, changes the bike, and downloads a GPX", async ({
  page,
}) => {
  await page.goto("/route-builder");
  await expect(page.getByRole("heading", { name: "Route builder", level: 1 })).toBeVisible();
  await settle(page);

  // The zone starts where the latest outdoor ride did, so the athlete can search at once.
  await page.getByRole("button", { name: "Find routes" }).click();
  const routes = page.getByRole("list", { name: "Proposed routes" }).getByRole("button");
  await expect(routes).toHaveCount(3);
  await expect(routes.first()).toHaveAttribute("aria-pressed", "true");
  await expect(routes.first()).toContainText(/(High|Medium|Low) confidence · \d+/);
  await settle(page);
  await expect(page).toHaveScreenshot("route-builder-routes.png", {
    fullPage: true,
    mask: [syncButton(page), page.locator(".maplibregl-canvas")],
  });

  await routes.nth(1).click();
  await expect(routes.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(routes.first()).toHaveAttribute("aria-pressed", "false");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download GPX" }).click();
  expect((await download).suggestedFilename()).toMatch(/^Road-loop-\d+-km\.gpx$/);

  // Loops found for a road bike don't answer for a gravel bike: the way out is to search again.
  await page.getByRole("button", { name: "Gravel", exact: true }).click();
  await expect(routes).toHaveCount(0);
  await page.getByRole("button", { name: "Find routes" }).click();
  await expect(routes).toHaveCount(3);
  await expect(routes.first()).toContainText("Unpaved");

  // The proposals survive a reload, as they do when the phone unloads the installed app.
  await page.reload();
  await settle(page);
  await expect(routes).toHaveCount(3);
});
