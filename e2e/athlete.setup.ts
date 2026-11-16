import { onboardNewAthlete } from "./onboard.ts";
import { test, expect, snapshotAthlete } from "./test.ts";

test("a new athlete connects Strava, copies their training, and lands on their calendar", async ({
  page,
}) => {
  await onboardNewAthlete(page, {
    onPlanningStyle: () =>
      expect(page).toHaveScreenshot("onboarding-planning-style.png", { fullPage: true }),
  });
  await expect(
    page.locator("[data-event-id]").filter({ hasText: "Lunch run" }).first(),
  ).toBeVisible();

  await page.context().storageState({ path: "e2e/.auth/athlete.json" });
  await snapshotAthlete();
});
