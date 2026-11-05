import pg from "pg";

import { E2E_NOW, e2eDatabaseUrl } from "./env.ts";
import { test, expect, settle, syncButton, type Page } from "./test.ts";

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

/**
 * Picks a model and waits for its save: networkidle has already passed once the page loaded, so
 * settle() would let a reload, or the end of the test, cancel the save on its way.
 */
async function pickModel(page: Page, feature: string, model: string) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/_serverFn/") &&
      (response.request().postData() ?? "").includes(model),
  );
  await page.getByRole("combobox", { name: feature }).selectOption(model);
  expect((await saved).ok()).toBe(true);
}

test("a model picked for a coach feature stays picked on every visit", async ({ page }) => {
  await page.goto("/settings/coach");
  await settle(page);
  const chat = page.getByRole("combobox", { name: "Coach chat" });
  await expect(chat).toHaveValue("openai/gpt-6-luna");

  await pickModel(page, "Coach chat", "anthropic/claude-sonnet-5.5");
  await page.reload();
  await settle(page);

  await expect(page.getByRole("combobox", { name: "Coach chat" })).toHaveValue(
    "anthropic/claude-sonnet-5.5",
  );
  await expect(page.getByRole("combobox", { name: "Plan writing" })).toHaveValue(
    "openai/gpt-6-luna",
  );
  // Back to the default, so the other specs see the athlete as the setup left them.
  await pickModel(page, "Coach chat", "openai/gpt-6-luna");
});

/**
 * A reload restores the views saved on the device (offline-copy.ts), written at most once a
 * second; waits until the saved app shell and settings carry `style`.
 */
async function keptOnDevice(page: Page, style: string) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<unknown[]>((resolve) => {
            const open = indexedDB.open("keyval-store");
            open.onerror = () => resolve([]);
            open.onsuccess = () => {
              const read = open.result
                .transaction("keyval")
                .objectStore("keyval")
                .get("vo2-offline-copy");
              read.onerror = () => resolve([]);
              read.onsuccess = () => {
                type Saved = { queryKey: unknown[]; state: { data?: Record<string, unknown> } };
                const queries: Saved[] = read.result?.clientState?.queries ?? [];
                const data = (key: string) =>
                  queries.find((q) => q.queryKey[0] === key)?.state.data;
                const settings = data("settings-snapshot")?.settings as
                  | { planningStyle?: string }
                  | undefined;
                resolve([data("app-shell")?.planningStyle, settings?.planningStyle]);
              };
            };
          }),
      ),
    )
    .toEqual([style, style]);
}

/** Picks a planning style in Settings → Training and waits until it is saved everywhere. */
async function choosePlanningStyle(page: Page, label: "Off" | "Coach plan", style: string) {
  if (!page.url().endsWith("/settings/training")) await page.goto("/settings/training");
  await settle(page);
  const radio = page.getByRole("radio", { name: new RegExp(`^${label}`) });
  if (!(await radio.isChecked())) {
    await radio.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  }
  await keptOnDevice(page, style);
}

test("an athlete with planning off sees no plan, and turns the coach plan on from Plan", async ({
  page,
}) => {
  // The sidebar is open on desktop; on a phone it opens as a sheet, left open for the next load.
  const planLinks = async () => {
    if (test.info().project.name === "phone") {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect(page.getByRole("link", { name: "Season" })).toBeVisible();
    }
    return page.getByRole("link", { name: "Plan", exact: true }).count();
  };
  const planningOff = page.getByText("Planning is off", { exact: true });
  try {
    // A retry may start where a failed run left the shared athlete.
    await choosePlanningStyle(page, "Off", "off");

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
  } finally {
    // The other specs share this athlete and expect planning off.
    await choosePlanningStyle(page, "Off", "off");
  }
});

test("an athlete sets a race result, sees a predicted race time, and clears it", async ({
  page,
}) => {
  const raceDay = new Date(Date.parse(E2E_NOW) + 35 * 86_400_000).toISOString().slice(0, 10);
  try {
    await page.goto("/settings/paces");
    await settle(page);
    await expect(page.getByText(/^Estimated from /)).toBeVisible();
    await page.getByRole("radio", { name: /^A race result/ }).click();
    await page.getByRole("textbox", { name: "Time" }).fill("42:30");
    await page.getByRole("button", { name: "Set race result" }).click();
    await expect(page.getByText(/^From your race result: 10 km in 42:30/)).toBeVisible();

    await page.goto("/season");
    await settle(page);
    await page.getByRole("button", { name: "More season actions" }).click();
    await page.getByRole("menuitem", { name: "Paste season" }).click();
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
  } finally {
    // The other specs share this athlete and expect no goals and no race result.
    await page.goto("/season");
    await settle(page);
    const goal = page.getByRole("button", { name: /Run · 10\.0 km/ });
    if (await goal.isVisible()) {
      await goal.click();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("button", { name: "Delete for good" }).click();
      await expect(goal).toHaveCount(0);
    }
    await openPacesFresh(page);
    await page.getByRole("radio", { name: /^A race result/ }).click();
    const clear = page.getByRole("button", { name: "Clear race result" });
    await expect(clear.or(page.getByRole("button", { name: "Set race result" }))).toBeVisible();
    if (await clear.isVisible()) await clear.click();
    // Clearing the result the paces came from goes back to Automatic.
    await expect(page.getByRole("radio", { name: /^Automatic/ })).toBeChecked();
  }
});

test("an athlete adds a steady supporting race, is kept out of the main goal's taper, and removes it", async ({
  page,
}) => {
  try {
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
  } finally {
    // The other specs share this athlete and expect no goals.
    await deleteGoalIfThere(page, /Run · 5\.00 km/);
    await deleteGoalIfThere(page, /Run · 10\.0 km/);
  }
});

/**
 * Opens Settings → Paces as the server has them. The device's copy is written at most once a
 * second, so a page opened right after a change can restore paces from before it; drop it.
 */
async function openPacesFresh(page: Page) {
  await page.goto("/settings/paces");
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();
  await settle(page);
}

test("an athlete picks a best effort for their paces, and goes back to Automatic", async ({
  page,
}) => {
  try {
    await openPacesFresh(page);
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
    await openPacesFresh(page);
    await expect(page.getByRole("radio", { name: /^One of your best efforts/ })).toBeChecked();
    await expect(page.getByText(/^From your best effort: 5 km in/)).toBeVisible();
  } finally {
    await openPacesFresh(page);
    const automatic = page.getByRole("radio", { name: /^Automatic/ });
    if (!(await automatic.isChecked())) await automatic.click();
    await expect(page.getByText(/^Estimated from /)).toBeVisible();
  }
});

test("an athlete switches where the easy pace comes from, and sees why zone 2 is not used", async ({
  page,
}) => {
  const easyHint = page.getByText(/^From your zone 2 heart rate\./);
  try {
    await openPacesFresh(page);
    await expect(page.getByRole("radio", { name: /^Heart rate \(zone 2\)/ })).toBeChecked();
    await expect(easyHint).toBeVisible();
    await page.getByRole("radio", { name: /^Fitness estimate \(VDOT\)/ }).click();
    await expect(easyHint).toHaveCount(0);
    await page.getByRole("radio", { name: /^Heart rate \(zone 2\)/ }).click();
    await expect(easyHint).toBeVisible();

    // A running LTHR this low puts zone 2 below every run, so there is no zone 2 to read.
    await setRunningLthr(page, "110");
    await openPacesFresh(page);
    await expect(page.getByText(/^Not enough zone 2 running yet/)).toBeVisible();
    await expect(easyHint).toHaveCount(0);
    await expect(page).toHaveScreenshot("settings-paces-easy-fallback.png", {
      fullPage: true,
      mask: [syncButton(page)],
    });
  } finally {
    // The other specs share this athlete and expect the estimated LTHR and zone 2 easy pace.
    await setRunningLthr(page, "");
    await openPacesFresh(page);
    const heart = page.getByRole("radio", { name: /^Heart rate \(zone 2\)/ });
    if (!(await heart.isChecked())) await heart.click();
    await expect(easyHint).toBeVisible();
  }
});

/** Sets the running LTHR in Settings → Heart rate, or clears it back to the estimate with "". */
async function setRunningLthr(page: Page, bpm: string) {
  await page.goto("/settings/heart-rate");
  await settle(page);
  const lthr = page.locator("#settings-running-lthr");
  // An unchanged value saves nothing, so there is no "Saved" to wait for.
  if ((await lthr.inputValue()) === bpm) return;
  await lthr.fill(bpm);
  await lthr.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Pastes one goal into Season. */
async function pasteGoal(page: Page, goal: Record<string, unknown>) {
  await page.goto("/season");
  await settle(page);
  await page.getByRole("button", { name: "More season actions" }).click();
  await page.getByRole("menuitem", { name: "Paste season" }).click();
  await page
    .getByRole("textbox", { name: "Copied season" })
    .fill(JSON.stringify({ vo2Season: 1, goals: [goal] }));
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
 * Runs and rides a week. Availability is only how many (ADR 0048, ADR 0050): no days, no long run
 * day, and no time per day (ADR 0041).
 */
async function setAvailability(page: Page, { runs, rides }: { runs: number; rides: number }) {
  await page.getByRole("button", { name: `${runs} runs a week` }).click();
  await page.getByRole("button", { name: `${rides} rides a week` }).click();
  await expect(page.getByText("Days you can run")).toHaveCount(0);
  await expect(page.getByText("Long run day")).toHaveCount(0);
  await expect(page.getByText("Time you have")).toHaveCount(0);
}

/** Drops the written plan, keeping availability, so the next project writes its own. */
async function dropWrittenPlan() {
  await withDatabase((client) => client.query("update coach_plans set plan = null"));
}

/** The shown week's sessions: one unordered list, no day (ADR 0048). */
const weekSessions = (page: Page) =>
  page.getByRole("region", { name: "The week's sessions" }).getByRole("listitem");

async function withDatabase(use: (client: pg.Client) => Promise<unknown>) {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    await use(client);
  } finally {
    await client.end();
  }
}

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
  try {
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
    await expect(first.getByRole("button", { name: "Done" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
  } finally {
    await leaveCoachPlan(page);
  }
});

test("an athlete sets their own running peak, holds running, and goes back to the recommended progression", async ({
  page,
}) => {
  test.setTimeout(120_000);
  try {
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
  } finally {
    await withDatabase((client) => client.query("update coach_plans set progression = null"));
    await leaveCoachPlan(page);
  }
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

  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("The coach plan can't be written yet")).toHaveCount(0);
  const written = writingStarts(page);
  await setAvailability(page, availability);
  // An earlier journey or project may leave an availability saved (off keeps the setup): then
  // the new goal, or the new availability, has the plan written again.
  const save = page.getByRole("button", { name: /^Save (availability|and rewrite plan)$/ });
  if (await save.isEnabled()) await save.click();
  // Saved before leaving, or leaving would cancel the save on its way.
  await expect(page.getByRole("button", { name: "Save and rewrite plan" })).toBeDisabled();

  await page.goto("/week");
  await expectPlanWritten(page, written);
}

/**
 * The other specs share this athlete and expect planning off and no goals, and the other
 * project's run writes its own plan.
 */
async function leaveCoachPlan(page: Page) {
  await choosePlanningStyle(page, "Off", "off");
  await dropWrittenPlan();
  await deleteGoalIfThere(page, /Run · 21\.1 km/);
}

test("an athlete changes the coach plan from the chat and from a note on a week", async ({
  page,
}) => {
  test.setTimeout(120_000);
  try {
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
  } finally {
    await leaveCoachPlan(page);
  }
});

// The mock coach answers without a key, so this proves the client and server still speak the
// same stream after a TanStack AI upgrade.
test("an athlete asks the coach a question and gets an answer", async ({ page }) => {
  await page.goto("/coach");
  await page.getByRole("button", { name: "How did my last run go?" }).click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible({ timeout: 30_000 });
});

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

// Last: with a key saved, the coach would call OpenRouter instead of the mock coach.
test("an athlete saves an OpenRouter key, sees it kept, and removes it", async ({ page }) => {
  await page.goto("/settings/coach");
  await settle(page);
  const key = page.getByRole("textbox", { name: "Key" });
  await key.fill("sk-or-e2e-not-a-real-key");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(/^Saved /)).toBeVisible();

  // Saved with the account, never shown back.
  await page.reload();
  await expect(page.getByText(/^Saved /)).toBeVisible();
  await expect(page.getByText("sk-or-e2e-not-a-real-key")).toHaveCount(0);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("textbox", { name: "Key" })).toBeVisible();
});
