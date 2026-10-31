import { expect, type Page } from "@playwright/test";

import { E2E_NOW } from "./env.ts";

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
    coachPlan = false,
  }: { onPlanningStyle?: () => Promise<void>; planningOff?: boolean; coachPlan?: boolean } = {},
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
  await onPlanningStyle?.();
  if (coachPlan) {
    await onboardWithCoachPlan(page);
    return;
  }
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

/**
 * The coach plan's branch: the key (the mock coach stands in for one), an A race added on the
 * spot, availability, paces, then "Write my plan"; ends on This week with the plan written.
 */
async function onboardWithCoachPlan(page: Page) {
  const next = page.getByRole("button", { name: "Continue" });
  await page.getByRole("radio", { name: /^Coach plan/ }).click();
  await next.click();
  await expect(page.getByRole("heading", { name: "Add your OpenRouter key" })).toBeVisible();
  await next.click();

  await expect(page.getByRole("heading", { name: "Your A race" })).toBeVisible();
  await expect(next).toBeDisabled();
  const raceDay = new Date(Date.parse(E2E_NOW) + 70 * 86_400_000).toISOString().slice(0, 10);
  await page.getByRole("textbox", { name: "Race name" }).fill("Autumn half");
  await page.getByLabel("Race date").fill(raceDay);
  await page.getByRole("button", { name: "Half", exact: true }).click();
  await page.getByRole("button", { name: "Add A race" }).click();
  await expect(page.getByText("Autumn half")).toBeVisible();
  await next.click();

  await expect(page.getByRole("heading", { name: "When can you run?" })).toBeVisible();
  await page.getByRole("button", { name: "4 runs a week" }).click();
  await expect(next).toBeDisabled();
  await page.getByRole("button", { name: "Saturday", exact: true }).click();
  await next.click();

  await expect(page.getByRole("heading", { name: "Your paces" })).toBeVisible();
  await page.getByRole("button", { name: "Write my plan" }).click();
  await expect(page.getByText(/^Your coach is writing your next four weeks/)).toBeVisible();
  await page.getByRole("button", { name: "Open This week" }).click();
  await page.waitForURL("/week");
  await expect(page.getByText(/km planned of a \d+ km budget/).first()).toBeVisible({
    timeout: 30_000,
  });
}
