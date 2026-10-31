import { expect, type Page } from "@playwright/test";

/**
 * Connects mock Strava, copies the training, and finishes onboarding, ending on This week, or on
 * the calendar with planning off. Shared by the e2e setup, the teardown, and the signed-in
 * Lighthouse run (scripts/lighthouse.ts).
 */
export async function onboardNewAthlete(
  page: Page,
  {
    onPlanningStyle,
    planningOff = false,
  }: { onPlanningStyle?: () => Promise<void>; planningOff?: boolean } = {},
) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();

  await page.getByRole("button", { name: "Connect Strava" }).click();
  await page.waitForURL("/onboarding");
  const next = page.getByRole("button", { name: "Continue" });
  await expect(page.getByText("Never copied")).toBeVisible();
  await expect(next).toBeDisabled();

  await page.getByRole("button", { name: "Start sync" }).click();
  await expect(page.getByText("Full success")).toBeVisible({ timeout: 60_000 });
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
  await expect(page.getByRole("radio", { name: /Week planner/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Coach plan/ })).toBeDisabled();
  await onPlanningStyle?.();
  if (planningOff) {
    // Off saves the setup at once and skips the plan builder; the key step still follows.
    await page.getByRole("radio", { name: /^Off/ }).click();
    await next.click();
    await expect(page.getByRole("heading", { name: "Add your OpenRouter key" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page.getByText(/^Planning is off:/)).toBeVisible();
    await page.getByRole("button", { name: "Open the calendar" }).click();
    await page.waitForURL("/");
    await expect(page.getByRole("heading", { name: "Activity calendar" })).toBeVisible();
    return;
  }
  await next.click();

  await expect(page.getByRole("heading", { name: "Your season" })).toBeVisible();
  await next.click();
  await expect(page.getByRole("heading", { name: "Where you're starting" })).toBeVisible();
  await page.getByRole("button", { name: "Looks right" }).click();
  await expect(page.getByRole("heading", { name: "When can you train?" })).toBeVisible();
  await next.click();
  await page.getByRole("button", { name: "Start my plan" }).click();
  // The OpenRouter key is optional: mock Strava's mock coach answers without one.
  await expect(page.getByRole("heading", { name: "Add your OpenRouter key" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Open This week" }).click();

  await page.waitForURL("/week");
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
}
