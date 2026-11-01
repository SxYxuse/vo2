import { onboardNewAthlete } from "./onboard.ts";
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

// The athlete starts over above, so one more onboarding needs no second mock athlete.
test("an athlete who onboards with planning off lands on the calendar with no week", async ({
  page,
}) => {
  await onboardNewAthlete(page, { planningOff: true });
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await expect(page.getByRole("link", { name: "Season" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan", exact: true })).toHaveCount(0);

  await page.goto("/week");
  await expect(page.getByText("Planning is off", { exact: true })).toBeVisible();
});

test("an athlete who onboards with the coach plan sees their four weeks written", async ({
  page,
}) => {
  // This page still holds the session deleted above: sign in again as the athlete just onboarded.
  await page.goto("/");
  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/");
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "Delete my VO2 data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();

  await onboardNewAthlete(page, { coachPlan: true });
  await expect(page.getByRole("heading", { name: /^This week · / })).toBeVisible();
});
