import { onboardNewAthlete } from "./onboard.ts";
import { test, expect } from "./test.ts";

// The journey every athlete takes first. It leaves a synced, onboarded athlete for the other specs.

test("a new athlete connects Strava, copies their training, and lands on their week", async ({
  page,
}) => {
  await onboardNewAthlete(page, {
    onPlanningStyle: () =>
      expect(page).toHaveScreenshot("onboarding-planning-style.png", { fullPage: true }),
  });
  await expect(page.getByRole("button", { name: "Today: open the day" })).toContainText(
    "Lunch run",
  );

  await page.context().storageState({ path: "e2e/.auth/athlete.json" });
});
