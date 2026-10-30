import { test, expect, type Page } from "./test.ts";

// The ways out, run once every other spec is done with the athlete.

test.describe.configure({ mode: "serial" });

async function expectFreshStart(page: Page) {
  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/onboarding");
  await expect(page.getByText("Never copied")).toBeVisible();
}

test("a deleted athlete is signed out and starts over on the next connection", async ({ page }) => {
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "Delete my VO2 data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();

  await expectFreshStart(page);
});

test("an athlete who revokes VO2 on Strava is signed out and starts over", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/onboarding");

  // What Strava does when the athlete revokes VO2 there: kill the tokens and push the event.
  await page.request.post("/api/mock-strava/dev/deauthorize");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();

  await expectFreshStart(page);
});
