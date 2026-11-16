import { E2E_NOW } from "./env.ts";
import {
  test,
  expect,
  openFresh,
  settle,
  syncButton,
  waitForOfflineCopy,
  waitForSave,
  withDatabase,
  type Locator,
  type Page,
} from "./test.ts";

// An installed PWA has no browser back button: the in-app link is the way back on iOS, and the
// system back gesture on Android.
const WAYS_BACK = {
  "the Calendar link": (page: Page) =>
    page.getByRole("main").getByRole("link", { name: "Calendar" }).click(),
  "the back gesture": (page: Page) => page.goBack(),
};

for (const [way, goBack] of Object.entries(WAYS_BACK)) {
  test(`returning from an activity by ${way} keeps the calendar where it was`, async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await page.getByRole("button", { name: /^Previous / }).click();
    const range = page.locator('button[aria-haspopup="dialog"][aria-live="polite"]');
    const shown = await range.innerText();

    await page.locator("[data-event-id]").filter({ hasText: "Long run" }).first().click();
    await expect(page.getByRole("heading", { name: "Long run", level: 1 })).toBeVisible();
    await goBack(page);

    await expect(range).toHaveText(shown);
  });
}

async function pickInModelPicker(page: Page, option: Locator, saves: string) {
  await waitForSave(page, saves, () => option.click());
}

const modelRow = (page: Page, feature: string) =>
  page.getByRole("button", { name: new RegExp(`^${feature}`) });

test("a model and reasoning picked for a coach feature stay picked on every visit", async ({
  page,
}) => {
  await page.goto("/settings/coach");
  await settle(page);
  await expect(modelRow(page, "Coach chat")).toContainText("GPT-6 Luna");
  await expect(modelRow(page, "Coach chat")).toContainText("Auto reasoning · via OpenRouter");

  await modelRow(page, "Coach chat").click();
  const picker = page.getByRole("dialog");
  await pickInModelPicker(
    page,
    picker.getByRole("radio", { name: "Claude Sonnet 5.5 via OpenRouter" }),
    "anthropic/claude-sonnet-5.5",
  );
  await pickInModelPicker(page, picker.getByRole("button", { name: "High", exact: true }), "high");
  await page.reload();
  await settle(page);

  await expect(modelRow(page, "Coach chat")).toContainText("Claude Sonnet 5.5");
  await expect(modelRow(page, "Coach chat")).toContainText("High reasoning · via OpenRouter");
  await expect(modelRow(page, "Plan writing")).toContainText("GPT-6 Luna");
  await expect(modelRow(page, "Plan writing")).toContainText("Auto reasoning");

  await modelRow(page, "Coach chat").click();
  await picker.getByRole("searchbox", { name: "Search models" }).fill("claude-sonnet-4.6");
  await expect(picker.getByText(/Not tested with VO2/)).toBeVisible();
  await pickInModelPicker(
    page,
    picker.getByRole("radio", { name: "claude-sonnet-4.6 via OpenRouter" }),
    "anthropic/claude-sonnet-4.6",
  );
  await page.keyboard.press("Escape");
  await expect(modelRow(page, "Coach chat")).toContainText("claude-sonnet-4.6");
  await expect(modelRow(page, "Coach chat")).not.toContainText("no longer offered");
});

async function choosePlanningStyle(page: Page, label: "Off" | "Coach plan", style: string) {
  if (!page.url().endsWith("/settings/training")) await page.goto("/settings/training");
  await settle(page);
  const radio = page.getByRole("radio", { name: new RegExp(`^${label}`) });
  if (!(await radio.isChecked())) {
    await radio.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  }
  await waitForOfflineCopy(
    page,
    (views) =>
      views["app-shell"]?.planningStyle === style &&
      (views["settings-snapshot"]?.settings as { planningStyle?: string } | undefined)
        ?.planningStyle === style,
  );
}

test("an athlete with planning off sees no plan, and turns the coach plan on from Plan", async ({
  page,
}) => {
  const planLinks = async () => {
    if (test.info().project.name !== "phone") {
      return page.getByRole("link", { name: "Plan", exact: true }).count();
    }
    const tabs = await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Plan", exact: true })
      .count();
    await page.getByRole("button", { name: "More", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: "Season" })).toBeVisible();
    const sidebar = await sheet.getByRole("link", { name: "Plan", exact: true }).count();
    expect(tabs).toBe(sidebar);
    return sidebar;
  };
  const planningOff = page.getByText("Planning is off", { exact: true });
  await page.goto("/week");
  await expect(planningOff).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("week-planning-off.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
  expect(await planLinks()).toBe(0);
  await page.goto("/plan");
  await page.waitForURL("/week");
  await expect(planningOff).toBeVisible();

  await page.getByRole("button", { name: "Choose a planning style" }).click();
  await page.waitForURL("/settings/training");
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await expect(page.getByText(BASE_FITNESS)).toBeVisible();

  await page.goto("/week");
  await expect(page.getByText("The coach plan can't be written yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Set it in Settings → Training" })).toBeVisible();
  expect(await planLinks()).toBe(1);
});

const BASE_FITNESS = "No A goal ahead: the plan builds your base fitness.";

test("an athlete with no race gets a coach plan that builds base fitness, then adds a race", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await expect(page.getByText(BASE_FITNESS)).toBeVisible();
  await saveAvailabilityAndWrite(page, { runs: 4, rides: 0 });

  const weekHeading = page.getByRole("heading", { name: WEEK_HEADING });
  await expect(weekHeading).toHaveText(/^This week · Base · \d+ km running$/);
  await expect(page.getByText("Base now.")).toBeVisible();
  await expect(page.getByText(/^Progression: running Standard$/)).toBeVisible();

  const raceDay = new Date(Date.parse(E2E_NOW) + 70 * 86_400_000).toISOString().slice(0, 10);
  await pasteGoal(page, {
    name: "Autumn half",
    sportType: "Run",
    date: raceDay,
    distanceM: 21_097.5,
    elevationGainM: null,
    priority: "A",
  });
  const written = writingStarts(page);
  await page.goto("/week");
  await expectPlanWritten(page, written);
  await expect(page.getByText(/^Build now, /)).toBeVisible();
});

test("an athlete sets a race result, sees a predicted race time, and clears it", async ({
  page,
}) => {
  const raceDay = new Date(Date.parse(E2E_NOW) + 35 * 86_400_000).toISOString().slice(0, 10);
  await page.goto("/settings/paces");
  await settle(page);
  await expect(page.getByText(/^Estimated from /)).toBeVisible();
  await page.getByRole("radio", { name: /^A race result/ }).click();
  await page.getByRole("textbox", { name: "Time" }).fill("42:30");
  await page.getByRole("button", { name: "Set race result" }).click();
  await expect(page.getByText(/^From your race result: 10 km in 42:30/)).toBeVisible();

  await page.goto("/season");
  await settle(page);
  await openSeasonPaste(page);
  await page.getByRole("textbox", { name: "Copied season" }).fill(
    JSON.stringify({
      vo2Season: 1,
      goals: [
        {
          name: "City 10K",
          sportType: "Run",
          date: raceDay,
          distanceM: 10_000,
          elevationGainM: null,
          priority: "C",
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "Add goals" }).click();
  await expect(page.getByText("Predicted 42:30")).toBeVisible();
  await expect(page.getByRole("region", { name: "Upcoming goals" })).toHaveScreenshot(
    "season-prediction.png",
  );

  await openFresh(page, "/settings/paces");
  await page.getByRole("radio", { name: /^A race result/ }).click();
  await page.getByRole("button", { name: "Clear race result" }).click();
  await expect(page.getByRole("radio", { name: /^Automatic/ })).toBeChecked();
});

test("an athlete adds a steady supporting race, is kept out of the main goal's taper, and removes it", async ({
  page,
}) => {
  await pasteGoal(page, {
    name: "Summer 10K",
    sportType: "Run",
    date: "2026-07-12",
    distanceM: 10_000,
    elevationGainM: null,
    priority: "A",
  });
  await expect(page.getByRole("region", { name: "Upcoming goals" })).toContainText("Main");

  await page.getByRole("button", { name: "Add a goal" }).first().click();
  await page.getByRole("textbox", { name: "Name" }).fill("Club 5K");
  await page.getByRole("combobox", { name: "Sport" }).click();
  await page.getByRole("option", { name: "Run", exact: true }).click();
  const pickDate = async (day: string) => {
    await page.getByRole("button", { name: "Date", exact: true }).click();
    await page.locator(`[data-day="${day}"]`).click();
  };
  await pickDate("30/06/2026");
  await page.getByRole("textbox", { name: "Distance" }).fill("5");
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByRole("radio", { name: /^Supporting race/ }).click();
  await expect(page.getByRole("radio", { name: /^Strong and steady/ })).toBeChecked();
  await expect(page.getByText(/falls in the taper for Summer 10K/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add goal" })).toBeDisabled();
  await expect(page).toHaveScreenshot("goal-supporting-race-blocked.png", {
    mask: [syncButton(page)],
  });

  await page.getByRole("button", { name: "Back" }).click();
  await pickDate("27/06/2026");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("radio", { name: /^Strong and steady/ })).toBeChecked();
  await expect(page.getByText(/falls in the taper/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Upcoming goals" })).toContainText("Steady");

  await deleteGoalIfThere(page, /Run · 5\.00 km/);
  await expect(page.getByRole("region", { name: "Upcoming goals" })).not.toContainText("Steady");
});

test("an athlete picks a best effort for their paces, and goes back to Automatic", async ({
  page,
}) => {
  await openFresh(page, "/settings/paces");
  await expect(page.getByRole("radio", { name: /^Automatic/ })).toBeChecked();
  await page.getByRole("radio", { name: /^One of your best efforts/ }).click();
  const efforts = page.getByRole("radiogroup", { name: "Best efforts" });
  await expect(efforts).toBeVisible();
  await expect(page).toHaveScreenshot("settings-paces-efforts.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
  await efforts.getByRole("radio", { name: /^5 km/ }).first().click();
  await expect(page.getByText(/^From your best effort: 5 km in/)).toBeVisible();
  await openFresh(page, "/settings/paces");
  await expect(page.getByRole("radio", { name: /^One of your best efforts/ })).toBeChecked();
  await expect(page.getByText(/^From your best effort: 5 km in/)).toBeVisible();

  await page.getByRole("radio", { name: /^Automatic/ }).click();
  await expect(page.getByText(/^Estimated from /)).toBeVisible();
});

test("an athlete switches where the easy pace comes from, and sees why zone 2 is not used", async ({
  page,
}) => {
  const easyHint = page.getByText(/^From your zone 2 heart rate\./);
  await openFresh(page, "/settings/paces");
  await expect(page.getByRole("radio", { name: /^Heart rate \(zone 2\)/ })).toBeChecked();
  await expect(easyHint).toBeVisible();
  await page.getByRole("radio", { name: /^Fitness estimate \(VDOT\)/ }).click();
  await expect(easyHint).toHaveCount(0);
  await page.getByRole("radio", { name: /^Heart rate \(zone 2\)/ }).click();
  await expect(easyHint).toBeVisible();

  await setRunningLthr(page, "110");
  await openFresh(page, "/settings/paces");
  await expect(page.getByText(/^Not enough zone 2 running yet/)).toBeVisible();
  await expect(easyHint).toHaveCount(0);
  await expect(page).toHaveScreenshot("settings-paces-easy-fallback.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

async function setRunningLthr(page: Page, bpm: string) {
  await page.goto("/settings/heart-rate");
  await settle(page);
  const lthr = page.locator("#settings-running-lthr");
  await lthr.fill(bpm);
  await lthr.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function openSeasonPaste(page: Page) {
  const fromEmpty = page.getByRole("button", { name: "Paste a season" });
  if (await fromEmpty.isVisible()) return fromEmpty.click();
  await page.getByRole("button", { name: "More season actions" }).click();
  await page.getByRole("menuitem", { name: "Paste season" }).click();
}

async function pasteGoal(page: Page, ...goals: Record<string, unknown>[]) {
  await page.goto("/season");
  await settle(page);
  await openSeasonPaste(page);
  await page
    .getByRole("textbox", { name: "Copied season" })
    .fill(JSON.stringify({ vo2Season: 1, goals }));
  await page.getByRole("button", { name: "Add goals" }).click();
  await expect(page.getByRole("heading", { name: "Paste a season" })).toHaveCount(0);
}

async function deleteGoalIfThere(page: Page, name: RegExp) {
  await page.goto("/season");
  await settle(page);
  const goal = page.getByRole("button", { name });
  if (!(await goal.isVisible())) return;
  await goal.click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(goal).toHaveCount(0);
}

async function setAvailability(
  page: Page,
  { runs, rides, swims = 0 }: { runs: number; rides: number; swims?: number },
) {
  await page.getByRole("button", { name: `${runs} runs a week` }).click();
  await page.getByRole("button", { name: `${rides} rides a week` }).click();
  await page.getByRole("button", { name: `${swims} swims a week` }).click();
  await expect(page.getByText("Days you can run")).toHaveCount(0);
  await expect(page.getByText("Long run day")).toHaveCount(0);
  await expect(page.getByText("Time you have")).toHaveCount(0);
}

const weekSessions = (page: Page) =>
  page.getByRole("region", { name: "The week's sessions" }).getByRole("listitem");

async function expectPlanWritten(page: Page, writing: Promise<unknown>) {
  await writing;
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Plan writing failed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: WEEK_HEADING })).toBeVisible();
}

const WEEK_HEADING = /^(This week|Week of .+) · .+ · \d+ km running/;

function writingStarts(page: Page) {
  return expect(page.getByText("Writing your plan…").first()).toBeVisible({ timeout: 30_000 });
}

test("an athlete switches to the coach plan, sets it up, and switches away and back", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await expect(page.getByText(BASE_FITNESS)).toBeVisible();

  await addRaceAndWritePlan(page, { runs: 4, rides: 2 });
  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page).toHaveScreenshot("settings-training-coach-plan.png", {
    fullPage: true,
    mask: [syncButton(page), page.getByText(/^Written /)],
  });
  await page.goto("/week");
  await settle(page);
  await expect(page).toHaveScreenshot("week-coach-plan.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });

  const weekHeading = page.getByRole("heading", { name: WEEK_HEADING });
  await expect(weekHeading).toHaveText(/ · [^·]+ riding$/);
  const previous = page.getByRole("button", { name: "Previous week" });
  const next = page.getByRole("button", { name: "Next week" });
  const back = page.getByRole("button", { name: "Back to this week" });
  const markDone = page.getByRole("button", { name: "Mark done" });
  await expect(weekHeading).toHaveText(/^This week · /);
  await expect(weekSessions(page)).toHaveCount(6);
  await expect(weekSessions(page).filter({ has: page.getByLabel("Ride") })).toHaveCount(2);
  await expect(page.getByText(/^0 of 6 done/)).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(back).toHaveCount(0);
  for (let step = 1; step <= 3; step++) {
    const shown = await weekHeading.textContent();
    await next.click();
    await expect(weekHeading).not.toHaveText(shown ?? "");
    await expect(weekHeading).toHaveText(/^Week of /);
    await expect(markDone).toHaveCount(0);
  }
  await expect(next).toBeDisabled();
  await expect(page).toHaveURL(/[?&]week=/);

  const shownWeek = await weekHeading.textContent();
  await page.getByRole("button", { name: "Open the session" }).first().click();
  await expect(page.getByText("You can mark it done from its week on.")).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();
  await expect(weekHeading).toHaveText(shownWeek ?? "");
  await previous.click();
  await expect(next).toBeEnabled();
  await back.click();
  await expect(weekHeading).toHaveText(/^This week · /);
  await expect(back).toHaveCount(0);

  const season = page.getByRole("region", { name: "Your season" });
  const writtenWeeks = season.getByRole("list", { name: "Written weeks" }).getByRole("button");
  await expect(writtenWeeks).toHaveCount(4);
  await writtenWeeks.nth(2).click();
  await expect(weekHeading).toHaveText(/^Week of /);
  await expect(writtenWeeks.nth(2)).toHaveAttribute("aria-current", "true");
  await writtenWeeks.first().click();
  await expect(weekHeading).toHaveText(/^This week · /);

  const first = weekSessions(page).first();
  await first.getByRole("button", { name: "Mark done" }).click();
  await expect(first.getByRole("button", { name: "Done" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/^1 of 6 done/)).toBeVisible();
  await first.getByRole("button", { name: "Open the session" }).click();
  await expect(page.getByText("Done", { exact: true }).first()).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("coach-session.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Mark done" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByText(/^0 of 6 done/)).toBeVisible();

  await weekSessions(page)
    .filter({ has: page.getByLabel("Ride") })
    .first()
    .getByRole("button", { name: "Open the session" })
    .click();
  await expect(page.getByText("Width is time, height and colour are effort.")).toBeVisible();
  await expect(page.getByText(/endurance/).first()).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();

  await choosePlanningStyle(page, "Off", "off");
  await page.goto("/week");
  await expect(page.getByText("Planning is off", { exact: true })).toBeVisible();
  const rewritten = writingStarts(page);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await expect(page.getByRole("button", { name: "Save and rewrite plan" })).toBeDisabled();
  await page.goto("/week");
  await expectPlanWritten(page, rewritten);
});

test("an athlete sets their own running peak, holds running, and goes back to the recommended progression", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await addRaceAndWritePlan(page, { runs: 4, rides: 2 });
  const season = page.getByRole("region", { name: "Your season" });
  await expect(season.getByText(/^Progression: running Standard · riding Hold/)).toBeVisible();

  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  const running = page.getByRole("group", { name: "Running" });
  const slider = running.getByRole("slider", { name: "Running progression" });
  const save = page.getByRole("button", { name: "Save progression" });
  await expect(save).toBeDisabled();

  await running.getByRole("button", { name: "My own" }).click();
  for (let step = 0; step < 6; step++) {
    await running.getByRole("button", { name: "Raise running peak" }).click();
  }
  await expect(running.getByText(/% above the recommended peak/)).toBeVisible();
  await save.click();
  await expect(save).toBeDisabled();
  await page.goto("/week");
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(season.getByText(/running Standard, your peak \d+ km/)).toBeVisible();

  await page.goto("/settings/training");
  await settle(page);
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(running.getByText("Hold · no growth")).toBeVisible();
  await save.click();
  await expect(save).toBeDisabled();
  await page.goto("/week");
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(
    season.getByText("Running is set to Hold, so it won't build toward Autumn half."),
  ).toBeVisible();

  await page.goto("/settings/training");
  await settle(page);
  await running.getByRole("button", { name: "Recommended" }).click();
  await slider.focus();
  for (let step = 0; step < 10; step++) await page.keyboard.press("ArrowRight");
  await expect(running.getByText("Standard · +5 % a week")).toBeVisible();
  await save.click();
  await expect(save).toBeDisabled();
  await page.goto("/week");
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(season.getByText(/^Progression: running Standard · riding Hold$/)).toBeVisible();
});

async function addRaceAndWritePlan(page: Page, availability: { runs: number; rides: number }) {
  const raceDay = new Date(Date.parse(E2E_NOW) + 70 * 86_400_000).toISOString().slice(0, 10);
  await pasteGoal(page, {
    name: "Autumn half",
    sportType: "Run",
    date: raceDay,
    distanceM: 21_097.5,
    elevationGainM: null,
    priority: "A",
  });
  await saveAvailabilityAndWrite(page, availability);
}

async function saveAvailabilityAndWrite(
  page: Page,
  availability: { runs: number; rides: number; swims?: number },
) {
  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("The coach plan can't be written yet")).toHaveCount(0);
  const written = writingStarts(page);
  await setAvailability(page, availability);
  const save = page.getByRole("button", { name: /^Save (availability|and rewrite plan)$/ });
  if (await save.isEnabled()) await save.click();
  await expect(page.getByRole("button", { name: "Save and rewrite plan" })).toBeDisabled();

  await page.goto("/week");
  await expectPlanWritten(page, written);
}

test("a triathlete plans swims beside rides and runs, opens a swim, and stops swimming", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const raceDay = new Date(Date.parse(E2E_NOW) + 84 * 86_400_000).toISOString().slice(0, 10);
  const leg = (sportType: string, distanceM: number) => ({
    name: "Lake tri",
    sportType,
    date: raceDay,
    distanceM,
    elevationGainM: null,
    priority: "A",
  });
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await pasteGoal(page, leg("Swim", 1500), leg("Ride", 40_000), leg("Run", 10_000));
  await saveAvailabilityAndWrite(page, { runs: 3, rides: 2, swims: 2 });

  const weekHeading = page.getByRole("heading", { name: WEEK_HEADING });
  await expect(weekHeading).toHaveText(/ · [\d,]+ m swimming$/);
  const swims = weekSessions(page).filter({ has: page.getByLabel("Swim") });
  await expect(swims.first()).toBeVisible();
  const season = page.getByRole("region", { name: "Your season" });
  await expect(
    season.getByText(/^Progression: running Standard · riding Standard · swimming Standard$/),
  ).toBeVisible();

  await swims.first().getByRole("button", { name: "Open the session" }).click();
  await expect(page.getByText("Width is distance, height and colour are effort.")).toBeVisible();
  await expect(page.getByText(/^[\d,]+ m$/).first()).toBeVisible();
  await expect(page.getByText(/endurance at \d:\d\d–\d:\d\d \/100m/).first()).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("coach-swim-session.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
  await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();

  await page.getByRole("button", { name: "Next week" }).click();
  await weekSessions(page)
    .filter({ hasText: "Technique: catch-up and fist" })
    .getByRole("button", { name: "Open the session" })
    .click();
  await expect(page.getByText("4 × 50 m catch-up drill, easy, 15 s rest")).toBeVisible();
  await expect(page.getByText(/^Freestyle with closed fists/)).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("coach-technique-swim.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
  await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();

  await saveAvailabilityAndWrite(page, { runs: 3, rides: 2, swims: 0 });
  await expect(weekHeading).not.toHaveText(/swimming/);
  await expect(weekSessions(page).filter({ has: page.getByLabel("Swim") })).toHaveCount(0);
});

test("an athlete changes the coach plan from the chat and from a note on a week", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await addRaceAndWritePlan(page, { runs: 4, rides: 0 });
  await expect(weekSessions(page)).toHaveCount(4);

  await page.getByRole("button", { name: "Ask the coach to change my plan" }).click();
  await page.getByRole("button", { name: "I can only run twice this week" }).click();
  const card = page.getByRole("group", { name: "Plan change" }).last();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Week of 15 Jun");
  await expect(card.getByRole("listitem")).toHaveCount(1);
  await expect(card.getByRole("listitem")).toContainText("Removed:");
  const composer = page.getByRole("textbox", { name: "Message the coach" });
  await expect(composer).toBeDisabled();
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toContainText("Declined: your plan stays as it was");
  await expect(page.getByText("No problem: your plan stays as it was.")).toBeVisible();

  await composer.fill("I'm travelling for a while");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: /^Apply \d+ changes$/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(card.getByRole("region", { name: /^Week of/ })).toHaveCount(2);
  await card.getByRole("button", { name: /^Show 1 more week/ }).click();
  await expect(card.getByRole("region", { name: /^Week of/ })).toHaveCount(3);
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toContainText("Declined: your plan stays as it was");

  await composer.fill("I can only run twice this week");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toContainText("Applied to your plan");
  await expect(page.getByText("Done: the change is in your plan.")).toBeVisible();

  await composer.fill("This week feels too hard");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await withDatabase((client) =>
    client.query("update coach_plans set plan = jsonb_set(plan, '{model}', '\"edited\"')"),
  );
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toContainText(/^.*Your plan changed since the coach proposed this/);

  await page.goto("/week");
  await expect(weekSessions(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Indoor only" })).toHaveCount(0);
});

async function saveBriefAndWrite(page: Page, brief: string) {
  await page.goto("/settings/training");
  await settle(page);
  const written = writingStarts(page);
  await page.getByRole("textbox", { name: "Coach brief" }).fill(brief);
  await page.getByRole("button", { name: "Save brief and rewrite plan" }).click();
  await expect(page.getByRole("button", { name: "Save brief and rewrite plan" })).toBeDisabled();
  await page.goto("/week");
  await expectPlanWritten(page, written);
}

test("an athlete writes a coach brief, the coach changes it in the chat, and they clear it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await addRaceAndWritePlan(page, { runs: 4, rides: 0 });
  const notFit = page.getByRole("alert").filter({ hasText: "Not all of your brief fit" });
  await expect(notFit).toHaveCount(0);

  await saveBriefAndWrite(page, "Fridays: 30 min at most.");
  await expect(notFit).toContainText("The mock coach doesn't read your brief.");
  await settle(page);
  await expect(page).toHaveScreenshot("coach-brief-not-fit.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });

  await page.goto("/coach");
  const composer = page.getByRole("textbox", { name: "Message the coach" });
  await composer.fill("From now on, no track sessions.");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByRole("group", { name: "Brief change" }).last();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Fridays: 30 min at most.");
  await expect(card).toContainText("Applying rewrites your coming weeks.");
  await settle(page);
  await expect(card).toHaveScreenshot("coach-brief-change.png", {
    mask: [page.getByRole("button", { name: "Scroll to end" })],
  });
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toContainText("Declined: your brief stays as it was");

  await composer.fill("From now on, no track sessions.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await withDatabase((client) => client.query("update coach_plans set brief = 'Edited.'"));
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toContainText("Your brief changed since the coach offered this");
  await withDatabase((client) =>
    client.query("update coach_plans set brief = 'Fridays: 30 min at most.'"),
  );

  await composer.fill("From now on, no track sessions.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toContainText("Saved to your brief");
  await expect(page.getByText("Done: it's in your brief")).toBeVisible();
  await page.goto("/settings/training");
  await expect(page.getByRole("textbox", { name: "Coach brief" })).toHaveValue(
    "Fridays: 30 min at most.\nNo track sessions.",
  );

  await page.goto("/week");
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await saveBriefAndWrite(page, "");
  await expect(notFit).toHaveCount(0);
});

test("an athlete asks the coach a question and gets an answer", async ({ page }) => {
  await page.goto("/coach");
  await page.getByRole("button", { name: "How did my last run go?" }).click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible({ timeout: 30_000 });

  await page.goto("/settings/coach");
  await expect(page.getByText(/Coach chat (< \$0\.01|\$(?!0\.00)\d+\.\d\d)/).first()).toBeVisible();
});

type ViewCounts = { inView: number; outOfView: number; stopped?: boolean };

async function watchInView(page: Page, text: string) {
  await page.evaluate((text) => {
    const counts: ViewCounts = { inView: 0, outOfView: 0 };
    (window as unknown as { viewCounts: ViewCounts }).viewCounts = counts;
    const check = () => {
      if (counts.stopped) return;
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]');
      const item = [...document.querySelectorAll('[data-slot="message-scroller-item"]')].find(
        (element) => element.textContent?.includes(text),
      );
      if (viewport && item) {
        const view = viewport.getBoundingClientRect();
        const box = item.getBoundingClientRect();
        if (box.bottom <= view.top || box.top >= view.bottom) counts.outOfView += 1;
        else counts.inView += 1;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, text);
  return () =>
    page.evaluate(() => {
      const counts = (window as unknown as { viewCounts: ViewCounts }).viewCounts;
      counts.stopped = true;
      return counts;
    });
}

test("an athlete reopens an earlier coach chat from Chats, then deletes it", async ({ page }) => {
  await page.goto("/coach");
  await page
    .getByRole("button", { name: "Am I fresh enough for a hard session tomorrow?" })
    .click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Ask the coach", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Chats" }).click();
  const sheet = page.getByRole("dialog", { name: "Chats" });
  await sheet.getByRole("link", { name: "Am I fresh enough for a hard session tomorrow?" }).click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible();

  const followUp = "And how is my form?";
  const viewCounts = await watchInView(page, followUp);
  await page.getByRole("textbox", { name: "Message the coach" }).fill(followUp);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/This is the mock coach/)).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  const { inView, outOfView } = await viewCounts();
  expect(inView).toBeGreaterThan(0);
  expect(outOfView).toBe(0);

  await page.getByRole("button", { name: "Chats" }).click();
  await sheet
    .getByRole("button", { name: "Delete “Am I fresh enough for a hard session tomorrow?”" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Ask the coach", { exact: true })).toBeVisible();
  await expect(
    sheet.getByRole("link", { name: "Am I fresh enough for a hard session tomorrow?" }),
  ).toHaveCount(0);
});

test("an athlete saves a key for each provider, sees them kept, and removes them", async ({
  page,
}) => {
  await page.goto("/settings/coach");
  await settle(page);
  for (const [provider, value] of [
    ["OpenRouter", "sk-or-e2e-not-a-real-key"],
    ["OpenAI", "sk-e2e-not-a-real-key"],
  ]) {
    const field = page.getByRole("group", { name: `${provider} key` });
    await field.getByRole("textbox", { name: `${provider} key` }).fill(value);
    await field.getByRole("button", { name: "Save key" }).click();
    await expect(field.getByText(/^Saved /)).toBeVisible();
  }

  await page.reload();
  for (const provider of ["OpenRouter", "OpenAI"]) {
    const field = page.getByRole("group", { name: `${provider} key` });
    await expect(field.getByText(/^Saved /)).toBeVisible();
    await field.getByRole("button", { name: "Remove" }).click();
    await expect(field.getByRole("textbox", { name: `${provider} key` })).toBeVisible();
  }
  await expect(page.getByText("not-a-real-key")).toHaveCount(0);
});

test("an athlete tries each phone calendar layout from Settings, and goes back to the day list", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "phone", "The calendar layouts are for phones.");
  await withDatabase((client) =>
    client.query(
      `insert into time_outs (id, user_id, kind, start_day, end_day) select 'e2e-injured', id, 'injured', '2026-06-15', null from "user"`,
    ),
  );
  const layouts = [
    {
      label: "Week strip",
      name: "strip",
      shows: () => page.getByRole("list", { name: "Days of the week" }),
    },
    {
      label: "Week summary",
      name: "summary",
      shows: () => page.getByText("Activities", { exact: true }),
    },
    { label: "Day list", name: null, shows: () => page.getByRole("group", { name: /^Mon, / }) },
  ];
  for (const layout of layouts) {
    await page.goto("/settings/calendar");
    await settle(page);
    await page.getByRole("radio", { name: new RegExp(`^${layout.label}`) }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Calendar" })
      .click();
    await expect(layout.shows()).toBeVisible();
    await settle(page);
    if (layout.name) {
      await expect(page).toHaveScreenshot(`calendar-${layout.name}.png`, {
        fullPage: true,
        mask: [syncButton(page)],
      });
    }
  }
});

test("an athlete on the coach plan marks themselves sick on Plan, comes back, and deletes the time out", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await addRaceAndWritePlan(page, { runs: 4, rides: 0 });
  const weekHeading = page.getByRole("heading", { name: WEEK_HEADING });
  const km = async () => Number((await weekHeading.textContent())?.match(/(\d+) km running/)?.[1]);
  await expect(weekHeading).toHaveText(/^This week · /);
  const fullWeek = await km();
  const sheet = page.getByRole("dialog", { name: "Sick or injured" });
  const banner = page.getByRole("region", { name: "Sick" });

  await weekSessions(page).first().getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText(/^1 of \d+ done/)).toBeVisible();

  await page.getByRole("button", { name: "Sick or injured" }).click();
  await sheet.getByRole("button", { name: "From", exact: true }).click();
  await page.locator('[data-day="15/06/2026"]').click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(banner).toContainText("Sick · day 3");
  await expect(banner).toContainText("Sick since Mon 15 Jun");
  await expect(banner).toContainText(
    "Your coach plan is paused. When you're back, your first week is 80 % of a normal one",
  );
  await expect(page.getByRole("button", { name: "Sick or injured" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "This week's done sessions" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next week" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your season" })).toHaveCount(0);
  await page.reload();
  await expect(banner).toBeVisible();
  await expect(page.getByText("Writing your plan…")).toHaveCount(0);

  const rewritten = writingStarts(page);
  await banner.getByRole("button", { name: "I'm back" }).click();
  await expectPlanWritten(page, rewritten);
  await expect(banner).toHaveCount(0);
  await expect(weekHeading).toHaveText(/^This week · /);
  expect(await km()).toBeLessThan(fullWeek);
  await expect(page.getByText(/^1 of \d+ done/)).toBeVisible();

  await page.getByRole("button", { name: "Next week" }).click();
  await expect(weekHeading).toHaveText(/^Week of /);
  expect(await km()).toBeLessThan(fullWeek);
  await expect(page.getByRole("list", { name: "Written weeks" })).toContainText("easing back 80 %");
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(weekHeading).toHaveText(/^This week · /);

  await page.goto("/fitness");
  await settle(page);
  await page.getByRole("button", { name: "Edit Sick · 15–16 Jun" }).click();
  await sheet.getByRole("button", { name: "Delete" }).click();
  const again = writingStarts(page);
  await sheet.getByRole("button", { name: "Delete for good" }).click();
  await expect(sheet).toHaveCount(0);
  await page.goto("/week");
  await expectPlanWritten(page, again);
  expect(await km()).toBeGreaterThan(fullWeek * 0.9);
});

test("an athlete on the coach plan marks a time out past the written weeks, and the season chart backs off for it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  await addRaceAndWritePlan(page, { runs: 4, rides: 0 });
  const season = page.getByRole("region", { name: "Your season" });
  const bar = (week: string) => season.getByRole("button", { name: new RegExp(`^${week}: `) });
  const km = async (week: string) =>
    Number((await bar(week).getAttribute("aria-label"))?.match(/: (\d+) km$/)?.[1]);
  const before = await km("27 Jul");
  expect(before).toBeGreaterThan(0);

  await withDatabase((client) =>
    client.query(
      "insert into time_outs (id, user_id, kind, start_day, end_day) select 'e2e-ahead', id, 'injured', '2026-07-13', '2026-07-26' from \"user\"",
    ),
  );
  await page.reload();
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(bar("13 Jul")).toHaveAccessibleName("13 Jul: 0 km");
  await expect(bar("20 Jul")).toHaveAccessibleName("20 Jul: 0 km");
  expect(await km("27 Jul")).toBeLessThan(before);
  await settle(page);
  await expect(season).toHaveScreenshot("plan-season-time-out.png");

  await withDatabase((client) =>
    client.query(
      "insert into time_outs (id, user_id, kind, start_day, end_day) select 'e2e-written', id, 'injured', '2026-06-29', '2026-07-05' from \"user\"",
    ),
  );
  const rewritten = writingStarts(page);
  await page.reload();
  await expectPlanWritten(page, rewritten);
  const rows = page.getByRole("list", { name: "Written weeks" }).getByRole("listitem");
  await expect(rows.filter({ hasText: "29 Jun" })).toContainText("Injured");
  await expect(rows.filter({ hasText: "6 Jul" })).toContainText("easing back 60 %");
});

test("an athlete with planning off marks a time out from Fitness, edits it, ends it, and deletes it", async ({
  page,
}) => {
  await page.goto("/fitness");
  await settle(page);
  const sheet = page.getByRole("dialog", { name: "Sick or injured" });
  const pickDay = async (field: "From" | "Until", day: string) => {
    await sheet.getByRole("button", { name: field, exact: true }).click();
    await page.locator(`[data-day="${day}"]`).click();
    await expect(page.locator("[data-day]")).toHaveCount(0);
  };
  const band = page.locator(".recharts-reference-area.cursor-pointer");

  await page.getByRole("button", { name: "Sick or injured" }).click();
  await expect(sheet.getByRole("button", { name: "Sick", pressed: true })).toBeVisible();
  await pickDay("From", "12/06/2026");
  await pickDay("Until", "14/06/2026");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Sick · 12–14 Jun" })).toBeVisible();
  await expect(band).toHaveCount(1);

  await band.click();
  await expect(sheet.getByRole("button", { name: "From", exact: true })).toHaveText("Fri 12 Jun");
  await expect(sheet.getByRole("button", { name: "Until", exact: true })).toHaveText("Sun 14 Jun");
  await expect(sheet.getByRole("button", { name: "I'm back" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Injured" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  const injured = page.getByRole("button", { name: "Edit Injured · 12–14 Jun" });
  await expect(injured).toBeVisible();

  await injured.click();
  await expect(sheet.getByRole("button", { name: "Injured", pressed: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { name: "Sick or injured" }).click();
  await pickDay("From", "14/06/2026");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toContainText("These days overlap others you marked sick or injured.");
  await pickDay("From", "15/06/2026");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Sick · since Mon 15 Jun" }).click();
  await sheet.getByRole("button", { name: "I'm back" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Sick · 15–16 Jun" })).toBeVisible();
  await expect(band).toHaveCount(2);

  for (const timeOut of [injured, page.getByRole("button", { name: /^Edit Sick/ })]) {
    await timeOut.click();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await sheet.getByRole("button", { name: "Delete for good" }).click();
    await expect(sheet).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /^Edit (Sick|Injured)/ })).toHaveCount(0);
  await expect(band).toHaveCount(0);
});
