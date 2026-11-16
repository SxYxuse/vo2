import { onboardNewAthlete, waitForHydration } from "./onboard.ts";
import { test, expect, type Page } from "./test.ts";

test.describe.configure({ mode: "serial" });

async function expectFreshStart(page: Page) {
  await waitForHydration(page);
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
  await waitForHydration(page);
  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/onboarding");

  await page.request.post("/api/mock-strava/dev/deauthorize");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();

  await expectFreshStart(page);
});

test("an athlete who onboards with planning off lands on the calendar with no week", async ({
  page,
}) => {
  await onboardNewAthlete(page);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("link", { name: "Season" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan", exact: true })).toHaveCount(0);

  await page.goto("/week");
  await expect(page.getByText("Planning is off", { exact: true })).toBeVisible();
});

test("an athlete who onboards with the coach plan sees their four weeks written", async ({
  page,
}) => {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/");
  await page.goto("/settings/profile");
  await page.getByRole("button", { name: "Delete my VO2 data" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();

  await onboardNewAthlete(page, { coachPlan: true });
  await expect(page.getByRole("heading", { name: /^This week · / })).toBeVisible();
});
