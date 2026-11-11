import { expect, type Page } from "@playwright/test";

/** Waits for React to hydrate the page (`data-hydrated`, __root.tsx): clicks before it are lost. */
export async function waitForHydration(page: Page) {
  await expect(page.locator("body[data-hydrated]")).toBeAttached();
}

/** Signs in through mock Strava as a new athlete, ending on onboarding with nothing copied. */
export async function connectStrava(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();
  await waitForHydration(page);
  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/onboarding");
  await waitForHydration(page);
  await expect(page.getByText("Never copied")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
}

/** Onboarding's first step: copies the athlete's training, activities and streams. */
export async function copyTraining(page: Page, timeout = 60_000) {
  await page.getByRole("button", { name: "Start sync" }).click();
  await expect(page.getByText("Full success")).toBeVisible({ timeout });
}

/**
 * Connects mock Strava, copies the training, and finishes onboarding, ending on the calendar with
 * planning off, or on Plan with the coach plan written. Shared by the e2e setup, the teardown,
 * the signed-in Lighthouse run (scripts/lighthouse.ts), and `vp run dev:seed`.
 */
export async function onboardNewAthlete(
  page: Page,
  {
    onPlanningStyle,
    coachPlan = false,
    syncTimeout,
  }: { onPlanningStyle?: () => Promise<void>; coachPlan?: boolean; syncTimeout?: number } = {},
) {
  await connectStrava(page);
  await copyTraining(page, syncTimeout);
  const next = page.getByRole("button", { name: "Continue" });
  await next.click();

  await page.getByRole("button", { name: "Birthday" }).click();
  await page.getByRole("button", { name: /January 15th, 1990/ }).click();
  await page.getByRole("textbox", { name: "Weight" }).fill("72");
  await next.click();

  await expect(page.getByRole("heading", { name: "Your sports" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Ride sports" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Run sports" })).toBeChecked();
  await next.click();

  await expect(page.getByRole("heading", { name: "Planning style" })).toBeVisible();
  // The coach plan is the only planning style (ADR 0050), and the default.
  await expect(page.getByRole("radio", { name: /^Coach plan/ })).toBeChecked();
  await expect(page.getByRole("radio")).toHaveCount(2);
  await onPlanningStyle?.();
  if (coachPlan) {
    await onboardWithCoachPlan(page);
    return;
  }
  // Off saves the setup at once; the key step still follows.
  await page.getByRole("radio", { name: /^Off/ }).click();
  await next.click();
  // The OpenRouter key is optional: mock Strava's mock coach answers without one.
  await expect(page.getByRole("heading", { name: "Add your OpenRouter key" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText(/^Planning is off:/)).toBeVisible();
  await page.getByRole("button", { name: "Open the calendar" }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("heading", { name: "Activity calendar" })).toBeVisible();
}

/**
 * The coach plan's branch: the key (the mock coach stands in for one), an A race added on the
 * spot, availability, paces, then "Write my plan"; ends on Plan with the plan written.
 */
async function onboardWithCoachPlan(page: Page) {
  const next = page.getByRole("button", { name: "Continue" });
  await page.getByRole("radio", { name: /^Coach plan/ }).click();
  await next.click();
  await expect(page.getByRole("heading", { name: "Add your OpenRouter key" })).toBeVisible();
  await next.click();

  await expect(page.getByRole("heading", { name: "Your A race" })).toBeVisible();
  await expect(next).toBeDisabled();
  // Ten weeks from the page's today: E2E_NOW under e2e, the real date under `vp run dev:seed`.
  const today = await page.evaluate(() => Date.now());
  const raceDay = new Date(today + 70 * 86_400_000).toISOString().slice(0, 10);
  await page.getByRole("textbox", { name: "Race name" }).fill("Autumn half");
  await page.getByLabel("Race date").fill(raceDay);
  await page.getByRole("button", { name: "Half", exact: true }).click();
  await page.getByRole("button", { name: "Add A race" }).click();
  await expect(page.getByText("Autumn half")).toBeVisible();
  await next.click();

  await expect(page.getByRole("heading", { name: "How often can you train?" })).toBeVisible();
  // A run goal starts on runs; rides are added beside them (ADR 0050).
  await expect(page.getByRole("button", { name: "3 runs a week" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "4 runs a week" }).click();
  await page.getByRole("button", { name: "2 rides a week" }).click();
  // Sessions a week only: no days, no long run day (ADR 0048), no time per day (ADR 0041).
  await expect(page.getByText("Days you can run")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await next.click();

  await expect(page.getByRole("heading", { name: "Your paces" })).toBeVisible();
  await page.getByRole("button", { name: "Write my plan" }).click();
  await expect(page.getByText(/^Your coach is writing your next four weeks/)).toBeVisible();
  await page.getByRole("button", { name: "Open Plan" }).click();
  await page.waitForURL("/week");
  await expect(page.getByRole("heading", { name: / · \d+ km running · .+ riding$/ })).toBeVisible({
    timeout: 30_000,
  });
}
