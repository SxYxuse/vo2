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

// Every test starts from the athlete the setup onboarded (resetAthlete in e2e/test.ts): eight
// weeks of mock rides, runs, and swims synced; born 15 January 1990, 72 kg; rides and runs on;
// planning off with no plan written; no goals; automatic paces with the zone 2 easy pace and the
// estimated LTHR; GPT-6 Luna with auto reasoning for every coach feature; no keys, chats, or power
// files. The reset puts the database back, so a test needs no cleanup for it. Restore anything
// else a test changes, such as mock Strava's state, in `finally`.
//
// The phone calendar shows one week and the desktop one four, so a step that moves the calendar
// works at either size, and an event may be off screen on a phone.

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
    // One week on a phone, a month on desktop: either way, step back once.
    await page.getByRole("button", { name: /^Previous / }).click();
    const range = page.locator('button[aria-haspopup="dialog"][aria-live="polite"]');
    const shown = await range.innerText();

    await page.locator("[data-event-id]").filter({ hasText: "Long run" }).first().click();
    await expect(page.getByRole("heading", { name: "Long run", level: 1 })).toBeVisible();
    await goBack(page);

    await expect(range).toHaveText(shown);
  });
}

/** Taps an option in a coach feature's model picker and waits for its save. */
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

  // Beyond the recommended models, OpenRouter's catalog is searchable and pickable too.
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

/** Picks a planning style in Settings → Training and waits until it is saved everywhere. */
async function choosePlanningStyle(page: Page, label: "Off" | "Coach plan", style: string) {
  if (!page.url().endsWith("/settings/training")) await page.goto("/settings/training");
  await settle(page);
  const radio = page.getByRole("radio", { name: new RegExp(`^${label}`) });
  if (!(await radio.isChecked())) {
    await radio.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  }
  // A reload restores the device's copy: wait until the app shell and settings carry `style`.
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
  // The sidebar is open on desktop. A phone has the tab bar, and More opens the sidebar as a
  // sheet, left open for the next load: both must agree.
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
  // The week planner's plan builder is gone: its old link opens Plan (ADR 0050).
  await page.goto("/plan");
  await page.waitForURL("/week");
  await expect(planningOff).toBeVisible();

  await page.getByRole("button", { name: "Choose a planning style" }).click();
  await page.waitForURL("/settings/training");
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  // No A goal yet: Settings says what's missing and where to fix it.
  await expect(page.getByText("The coach plan can't be written yet")).toBeVisible();

  await page.goto("/week");
  await expect(page.getByRole("link", { name: "Add one in Season" })).toBeVisible();
  expect(await planLinks()).toBe(1);
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
  // The race result sets the paces, so the 10 km prediction is the race itself.
  await expect(page.getByText("Predicted 42:30")).toBeVisible();
  await expect(page.getByRole("region", { name: "Upcoming goals" })).toHaveScreenshot(
    "season-prediction.png",
  );

  // The way out: clearing the result the paces came from goes back to Automatic.
  await openFresh(page, "/settings/paces");
  await page.getByRole("radio", { name: /^A race result/ }).click();
  await page.getByRole("button", { name: "Clear race result" }).click();
  await expect(page.getByRole("radio", { name: /^Automatic/ })).toBeChecked();
});

test("an athlete adds a steady supporting race, is kept out of the main goal's taper, and removes it", async ({
  page,
}) => {
  // A main goal on Sunday 12 July: its taper is the week from 29 June and its race week.
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

  // A supporting race takes an effort, steady unless another is picked, and none in the taper.
  await page.getByRole("radio", { name: /^Supporting race/ }).click();
  await expect(page.getByRole("radio", { name: /^Strong and steady/ })).toBeChecked();
  await expect(page.getByText(/falls in the taper for Summer 10K/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add goal" })).toBeDisabled();
  await expect(page).toHaveScreenshot("goal-supporting-race-blocked.png", {
    mask: [syncButton(page)],
  });

  // Two days earlier it is clear of the taper.
  await page.getByRole("button", { name: "Back" }).click();
  await pickDate("27/06/2026");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("radio", { name: /^Strong and steady/ })).toBeChecked();
  await expect(page.getByText(/falls in the taper/)).toHaveCount(0);
  await page.getByRole("button", { name: "Add goal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Upcoming goals" })).toContainText("Steady");

  // And the way out: removing it leaves the main goal alone.
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
  // The pick is saved: it is still there on the next visit.
  await openFresh(page, "/settings/paces");
  await expect(page.getByRole("radio", { name: /^One of your best efforts/ })).toBeChecked();
  await expect(page.getByText(/^From your best effort: 5 km in/)).toBeVisible();

  // And back to Automatic.
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

  // A running LTHR this low puts zone 2 below every run, so there is no zone 2 to read.
  await setRunningLthr(page, "110");
  await openFresh(page, "/settings/paces");
  await expect(page.getByText(/^Not enough zone 2 running yet/)).toBeVisible();
  await expect(easyHint).toHaveCount(0);
  await expect(page).toHaveScreenshot("settings-paces-easy-fallback.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

/** Sets the running LTHR in Settings → Heart rate. */
async function setRunningLthr(page: Page, bpm: string) {
  await page.goto("/settings/heart-rate");
  await settle(page);
  const lthr = page.locator("#settings-running-lthr");
  await lthr.fill(bpm);
  await lthr.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Opens Paste: from the empty state of a season with no goals, or from its menu. */
async function openSeasonPaste(page: Page) {
  const fromEmpty = page.getByRole("button", { name: "Paste a season" });
  if (await fromEmpty.isVisible()) return fromEmpty.click();
  await page.getByRole("button", { name: "More season actions" }).click();
  await page.getByRole("menuitem", { name: "Paste season" }).click();
}

/** Pastes goals into Season: one, or each leg of a multisport event. */
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

/** Deletes the goal whose button matches `name`, if it is there. */
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

/**
 * Runs, rides, and swims a week (none unless given). Availability is only how many (ADR 0048, ADR
 * 0050, ADR 0061): no days, no long run day, and no time per day (ADR 0041).
 */
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

/** The shown week's sessions: one unordered list, no day (ADR 0048). */
const weekSessions = (page: Page) =>
  page.getByRole("region", { name: "The week's sessions" }).getByRole("listitem");

/** Waits for the plan to be written: an earlier plan stays on screen while the next is written. */
async function expectPlanWritten(page: Page, writing: Promise<unknown>) {
  await writing;
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  // A failed rewrite also ends the writing, with the earlier plan still on screen.
  await expect(page.getByText("Plan writing failed")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: WEEK_HEADING })).toBeVisible();
}

/** A written week's heading: "This week · Build · 24 km running · 3 h riding". */
const WEEK_HEADING = /^(This week|Week of .+) · .+ · \d+ km running/;

/**
 * Resolves once the app shows a writing in progress, which it does only when the server started
 * one: the answer that started it says "writing" until the next check, three seconds later.
 * Started before the step that should write, and kept across pages, so a plan already on screen
 * can't pass for a new one.
 */
function writingStarts(page: Page) {
  return expect(page.getByText("Writing your plan…").first()).toBeVisible({ timeout: 30_000 });
}

test("an athlete switches to the coach plan, sets it up, and switches away and back", async ({
  page,
}) => {
  // Two plan writings and four style switches, each saved and checked on the device.
  test.setTimeout(90_000);
  await choosePlanningStyle(page, "Coach plan", "coachPlan");
  // No A goal yet: Settings says what's missing and where to fix it.
  await expect(page.getByText("The coach plan can't be written yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add one in Season" })).toBeVisible();

  // Runs and rides: the half marathon leads, the rides hold beside it (ADR 0050).
  await addRaceAndWritePlan(page, { runs: 4, rides: 2 });
  await page.goto("/settings/training");
  await settle(page);
  // A plan may be written again while the first copy's streams still move FTP or paces.
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

  // The plan opens on this week, its runs a list with no day. The arrows change the week,
  // stopping at the written ones, and "Back to this week" brings this week back.
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
    // A week ahead may still be written again: its runs can't be marked done yet.
    await expect(markDone).toHaveCount(0);
  }
  await expect(next).toBeDisabled();
  await expect(page).toHaveURL(/[?&]week=/);

  // A session ahead says when it can be marked, and Plan goes back to its week.
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

  // The season beside the week, with a row per written week.
  const season = page.getByRole("region", { name: "Your season" });
  const writtenWeeks = season.getByRole("list", { name: "Written weeks" }).getByRole("button");
  await expect(writtenWeeks).toHaveCount(4);
  await writtenWeeks.nth(2).click();
  await expect(weekHeading).toHaveText(/^Week of /);
  await expect(writtenWeeks.nth(2)).toHaveAttribute("aria-current", "true");
  await writtenWeeks.first().click();
  await expect(weekHeading).toHaveText(/^This week · /);

  // This week's runs are marked done by hand, and open again the same way.
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

  // A ride is planned by time and aimed at a cycling zone.
  await weekSessions(page)
    .filter({ has: page.getByLabel("Ride") })
    .first()
    .getByRole("button", { name: "Open the session" })
    .click();
  await expect(page.getByText("Width is time, height and colour are effort.")).toBeVisible();
  await expect(page.getByText(/endurance/).first()).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();

  // Off and back: the setup stays, and the plan is written again.
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
  // Plan charts each sport's season (ADR 0058) and names the progression with a way to change it.
  const season = page.getByRole("region", { name: "Your season" });
  await expect(season.getByText(/^Progression: running Standard · riding Hold/)).toBeVisible();

  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  const running = page.getByRole("group", { name: "Running" });
  const slider = running.getByRole("slider", { name: "Running progression" });
  const save = page.getByRole("button", { name: "Save progression" });
  await expect(save).toBeDisabled();

  // My own peak, above the recommended one: Settings says by how much.
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

  // Hold: running no longer builds toward the A goal, and Plan says so.
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

  // The way back: Standard and the recommended peak.
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

/** The A race the coach plan needs, then availability; ends on Plan with the plan written. */
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

/** Saves availability in Settings → Training; ends on Plan with the plan written. */
async function saveAvailabilityAndWrite(
  page: Page,
  availability: { runs: number; rides: number; swims?: number },
) {
  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("The coach plan can't be written yet")).toHaveCount(0);
  const written = writingStarts(page);
  await setAvailability(page, availability);
  // The availability may already be saved as asked: then the new goal has the plan written again.
  const save = page.getByRole("button", { name: /^Save (availability|and rewrite plan)$/ });
  if (await save.isEnabled()) await save.click();
  // Saved before leaving, or leaving would cancel the save on its way.
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
  // A triathlon is one A goal per leg on the same day; every leg builds (ADR 0061).
  await pasteGoal(page, leg("Swim", 1500), leg("Ride", 40_000), leg("Run", 10_000));
  await saveAvailabilityAndWrite(page, { runs: 3, rides: 2, swims: 2 });

  const weekHeading = page.getByRole("heading", { name: WEEK_HEADING });
  await expect(weekHeading).toHaveText(/ · [\d,]+ m swimming$/);
  const swims = weekSessions(page).filter({ has: page.getByLabel("Swim") });
  // This week may hold fewer than two, when its budget or its days left allow only one.
  await expect(swims.first()).toBeVisible();
  // Every leg of the A triathlon builds, swimming too (ADR 0061).
  const season = page.getByRole("region", { name: "Your season" });
  await expect(
    season.getByText(/^Progression: running Standard · riding Standard · swimming Standard$/),
  ).toBeVisible();

  // A swim is planned in metres and aimed at swim zones from CSS, read from the mock swims.
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

  // A technique swim names its drills in its steps and says how to swim each (ADR 0063).
  // This week may hold only the long swim; next week holds the second.
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

  // The way out: no swims a week, and the plan is written again without them.
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

  // From the plan, the chat opens ready for a change. The coach proposes one that passed the
  // rules; declining it changes nothing.
  await page.getByRole("button", { name: "Ask the coach to change my plan" }).click();
  await page.getByRole("button", { name: "I can only run twice this week" }).click();
  const card = page.getByRole("group", { name: "Plan change" }).last();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Week of 15 Jun");
  await expect(card.getByRole("listitem")).toHaveCount(1);
  await expect(card.getByRole("listitem")).toContainText("Removed:");
  // Nothing else can be asked until the change is answered.
  const composer = page.getByRole("textbox", { name: "Message the coach" });
  await expect(composer).toBeDisabled();
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toContainText("Declined: your plan stays as it was");
  await expect(page.getByText("No problem: your plan stays as it was.")).toBeVisible();

  // A change over several weeks folds the weeks past the first two.
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

  // Asked again and applied: this week has one run fewer.
  await composer.fill("I can only run twice this week");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toContainText("Applied to your plan");
  await expect(page.getByText("Done: the change is in your plan.")).toBeVisible();

  // A change proposed before the plan changed again is not applied.
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

/** Saves the coach brief in Settings → Training; ends on Plan with the plan written again. */
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

  // Saving a brief rewrites the plan; the mock coach says what it couldn't fit (ADR 0065).
  await saveBriefAndWrite(page, "Fridays: 30 min at most.");
  await expect(notFit).toContainText("The mock coach doesn't read your brief.");
  await settle(page);
  await expect(page).toHaveScreenshot("coach-brief-not-fit.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });

  // The coach offers a brief change with the brief before and after; declining keeps it.
  await page.goto("/coach");
  const composer = page.getByRole("textbox", { name: "Message the coach" });
  await composer.fill("From now on, no track sessions.");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.getByRole("group", { name: "Brief change" }).last();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Fridays: 30 min at most.");
  await expect(card).toContainText("Applying rewrites your coming weeks.");
  await settle(page);
  // The chat's scroll button may float over the card while the reply settles.
  await expect(card).toHaveScreenshot("coach-brief-change.png", {
    mask: [page.getByRole("button", { name: "Scroll to end" })],
  });
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toContainText("Declined: your brief stays as it was");

  // A brief change offered before the brief changed again is not applied.
  await composer.fill("From now on, no track sessions.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
  await withDatabase((client) => client.query("update coach_plans set brief = 'Edited.'"));
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card).toContainText("Your brief changed since the coach offered this");
  await withDatabase((client) =>
    client.query("update coach_plans set brief = 'Fridays: 30 min at most.'"),
  );

  // Applied: the brief holds both lines, and the plan is written again from it.
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

  // The way out: a cleared brief rewrites the plan, and Plan says nothing about it. The rewrite
  // the applied change started finishes first.
  await page.goto("/week");
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await saveBriefAndWrite(page, "");
  await expect(notFit).toHaveCount(0);
});

// The mock coach answers without a key, so this proves the client and server still speak the
// same stream after a TanStack AI upgrade.
test("an athlete asks the coach a question and gets an answer", async ({ page }) => {
  await page.goto("/coach");
  await page.getByRole("button", { name: "How did my last run go?" }).click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible({ timeout: 30_000 });

  // The mock coach reports a cost like OpenRouter does, so the answer counts toward spending.
  await page.goto("/settings/coach");
  await expect(page.getByText(/Coach chat (< \$0\.01|\$(?!0\.00)\d+\.\d\d)/).first()).toBeVisible();
});

type ViewCounts = { inView: number; outOfView: number; stopped?: boolean };

/**
 * Counts the animation frames in which a chat message, once shown, is in and out of the chat's
 * view, until the counts are read. Sampled in the page, so a jump of a frame or two is caught.
 */
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

  // The reply is saved once it's finished.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  // A new chat keeps the first one; it reopens from Chats, also after a reload.
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByText("Ask the coach", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Chats" }).click();
  const sheet = page.getByRole("dialog", { name: "Chats" });
  await sheet.getByRole("link", { name: "Am I fresh enough for a hard session tomorrow?" }).click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible();

  // A follow-up in the reopened chat stays in view while the coach replies: when every question
  // anchored the scroller, the view jumped back to the top mid-reply.
  const followUp = "And how is my form?";
  const viewCounts = await watchInView(page, followUp);
  await page.getByRole("textbox", { name: "Message the coach" }).fill(followUp);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/This is the mock coach/)).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  // Seen at all, so a renamed slot or message can't pass by counting nothing.
  const { inView, outOfView } = await viewCounts();
  expect(inView).toBeGreaterThan(0);
  expect(outOfView).toBe(0);

  // Deleting the open chat starts a new one, and the chat is gone from the list.
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

// Last: with a key saved, the coach would call the provider instead of the mock coach.
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

  // Saved with the account, never shown back.
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
