import pg from "pg";

import type { CoachPlan } from "../src/services/coach-plan.types.ts";
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

test("a model picked for a coach feature stays picked on every visit", async ({ page }) => {
  await page.goto("/settings/coach");
  await settle(page);
  const chat = page.getByRole("combobox", { name: "Coach chat" });
  await expect(chat).toHaveValue("openai/gpt-6-luna");

  await chat.selectOption("anthropic/claude-sonnet-5.5");
  await settle(page);
  await page.reload();
  await settle(page);

  await expect(page.getByRole("combobox", { name: "Coach chat" })).toHaveValue(
    "anthropic/claude-sonnet-5.5",
  );
  await expect(page.getByRole("combobox", { name: "Activity analysis" })).toHaveValue(
    "openai/gpt-6-luna",
  );
  // Back to the default, so the other specs see the athlete as the setup left them.
  await page.getByRole("combobox", { name: "Coach chat" }).selectOption("openai/gpt-6-luna");
  await settle(page);
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
                // Never chosen reads as the week planner for an athlete with a plan.
                resolve([
                  data("app-shell")?.planningStyle,
                  settings && (settings.planningStyle ?? "weekPlanner"),
                ]);
              };
            };
          }),
      ),
    )
    .toEqual([style, style]);
}

/** Picks a planning style in Settings → Training and waits until it is saved everywhere. */
async function choosePlanningStyle(
  page: Page,
  label: "Off" | "Week planner" | "Coach plan",
  style: string,
) {
  if (!page.url().endsWith("/settings/training")) await page.goto("/settings/training");
  await settle(page);
  const radio = page.getByRole("radio", { name: new RegExp(`^${label}`) });
  if (!(await radio.isChecked())) {
    await radio.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  }
  await keptOnDevice(page, style);
}

test("an athlete turns planning off and back on, and gets their week planner back", async ({
  page,
}) => {
  // The sidebar is open on desktop; on a phone it opens as a sheet, left open for the next load.
  const thisWeekLinks = async () => {
    if (test.info().project.name === "phone") {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect(page.getByRole("link", { name: "Season" })).toBeVisible();
    }
    return page.getByRole("link", { name: "Plan", exact: true }).count();
  };
  const planningOff = page.getByText("Planning is off", { exact: true });
  try {
    // A retry may start where a failed run left the shared athlete.
    await choosePlanningStyle(page, "Week planner", "weekPlanner");
    await expect(page.getByRole("button", { name: "Rebuild plan" })).toBeVisible();

    await choosePlanningStyle(page, "Off", "off");
    await expect(page.getByRole("button", { name: "Rebuild plan" })).toHaveCount(0);

    await page.goto("/week");
    await expect(planningOff).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("week-planning-off.png", {
      fullPage: true,
      mask: [syncButton(page)],
    });
    expect(await thisWeekLinks()).toBe(0);
    await page.goto("/plan");
    await page.waitForURL("/week");
    await expect(planningOff).toBeVisible();

    await page.getByRole("button", { name: "Choose a planning style" }).click();
    await page.waitForURL("/settings/training");
    await choosePlanningStyle(page, "Week planner", "weekPlanner");
    await expect(page.getByRole("button", { name: "Rebuild plan" })).toBeVisible();

    await page.goto("/week");
    await expect(page.getByRole("button", { name: "Today: open the day" })).toContainText(
      "Lunch run",
    );
    expect(await thisWeekLinks()).toBe(1);
  } finally {
    // The other specs share this athlete and expect the week planner.
    await page.goto("/settings/training");
    await choosePlanningStyle(page, "Week planner", "weekPlanner");
  }
});

/**
 * Keeps the plan when a goal change asks to adapt it, so the other specs see it unchanged. The
 * prompt is decided before the goal's dialog closes, so waiting for that is enough.
 */
async function keepCurrentPlan(page: Page, dialogHeading: string) {
  await expect(page.getByRole("heading", { name: dialogHeading })).toHaveCount(0);
  const keep = page.getByRole("button", { name: "Keep current plan" });
  if (await keep.isVisible()) await keep.click();
  await expect(keep).toHaveCount(0);
}

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
            objective: "perform",
            priority: "C",
          },
        ],
      }),
    );
    await page.getByRole("button", { name: "Add goals" }).click();
    await keepCurrentPlan(page, "Paste a season");
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
      await keepCurrentPlan(page, "Edit goal");
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
  await lthr.fill(bpm);
  await lthr.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/** Pastes one goal into Season, keeping the week planner's plan as it is. */
async function pasteGoal(page: Page, goal: Record<string, unknown>) {
  await page.goto("/season");
  await settle(page);
  await page.getByRole("button", { name: "More season actions" }).click();
  await page.getByRole("menuitem", { name: "Paste season" }).click();
  await page
    .getByRole("textbox", { name: "Copied season" })
    .fill(JSON.stringify({ vo2Season: 1, goals: [goal] }));
  await page.getByRole("button", { name: "Add goals" }).click();
  await keepCurrentPlan(page, "Paste a season");
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
  await keepCurrentPlan(page, "Edit goal");
  await expect(goal).toHaveCount(0);
}

/** Four runs on Tuesday, Thursday, Saturday, and Sunday, the long run on Sunday. */
const AVAILABILITY = ["Tuesday", "Thursday", "Saturday", "Sunday"];

/** Sets the same availability whatever is saved, so the written plan doesn't depend on run order. */
async function setAvailability(page: Page) {
  await page.getByRole("button", { name: "4 runs a week" }).click();
  for (const day of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]) {
    const toggle = page.getByRole("button", { name: day, exact: true });
    const wanted = AVAILABILITY.includes(day);
    if ((await toggle.getAttribute("aria-pressed")) !== String(wanted)) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", String(wanted));
  }
  // Availability has no time per day (ADR 0041): the coach plan's rules size the runs.
  await expect(page.getByText("Time you have")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Sunday" })).toHaveCount(0);
  await page.getByRole("button", { name: "Long run on Sunday" }).click();
}

/**
 * Moves the written plan's first run to today, as if it had been written on an earlier day: a plan
 * written today starts tomorrow once the athlete ran today, and the server's clock is fixed, so
 * this is the one way to a session whose day has come. Leaves a run already on today as it is, and
 * clears the athlete's links, so each project starts from the automatic match.
 */
async function moveFirstRunToToday() {
  const today = E2E_NOW.slice(0, 10);
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ user_id: string; plan: CoachPlan }>(
      "select user_id, plan from coach_plans where plan is not null",
    );
    for (const { user_id: userId, plan } of rows) {
      const sessions = plan.weeks.flatMap((week) => week.sessions);
      const first = sessions.find((session) => session.date > today);
      if (first && !sessions.some((session) => session.date === today)) first.date = today;
      await client.query("update coach_plans set plan = $1, links = null where user_id = $2", [
        plan,
        userId,
      ]);
    }
  });
}

/** Drops the written plan and links, keeping availability, so the next project writes its own. */
async function dropWrittenPlan() {
  await withDatabase((client) => client.query("update coach_plans set plan = null, links = null"));
}

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
  await expect(page.getByRole("heading", { name: / · \d+ km$/ })).toBeVisible();
}

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
    // No A running goal yet: Settings says what's missing and where to fix it.
    await expect(page.getByText("The coach plan can't be written yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add one in Season" })).toBeVisible();
    await page.goto("/week");
    await expect(page.getByRole("link", { name: "Add one in Season" })).toBeVisible();

    // With the coach plan, goals have no objective: new ones are saved as perform.
    await addRaceAndWritePlan(page);
    await settle(page);
    await expect(page).toHaveScreenshot("week-coach-plan.png", {
      fullPage: true,
      mask: [syncButton(page)],
    });

    // The strip opens on today. The arrows change the week, stopping at the written ones, and
    // "Back to this week" brings today back.
    const strip = page.getByRole("group", { name: "Days of the week" });
    const todayChip = strip.getByRole("button", { name: /, today:/ });
    const weekHeading = page.getByRole("heading", { name: / · \d+ km$/ });
    const previous = page.getByRole("button", { name: "Previous week" });
    const next = page.getByRole("button", { name: "Next week" });
    const back = page.getByRole("button", { name: "Back to this week" });
    await expect(todayChip).toHaveAttribute("aria-pressed", "true");
    await expect(weekHeading).toHaveText(/^This week · /);
    await expect(previous).toBeDisabled();
    await expect(back).toHaveCount(0);
    for (let step = 1; step <= 3; step++) {
      const shown = await weekHeading.textContent();
      await next.click();
      await expect(weekHeading).not.toHaveText(shown ?? "");
      await expect(weekHeading).toHaveText(/^Week of /);
      await expect(todayChip).toHaveCount(0);
    }
    await expect(next).toBeDisabled();
    await expect(page).toHaveURL(/[?&]day=/);
    await previous.click();
    await expect(next).toBeEnabled();
    await back.click();
    await expect(todayChip).toHaveAttribute("aria-pressed", "true");
    await expect(weekHeading).toHaveText(/^This week · /);
    await expect(back).toHaveCount(0);

    // A run still ahead can't have a run linked: its day may be written again as another kind.
    await strip.getByRole("button", { name: / km$/ }).first().click();
    await page.getByRole("button", { name: "Open the full session" }).click();
    await expect(page.getByText(/^A run can be linked from /)).toBeVisible();
    // Back to the day it was opened from.
    await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();
    await expect(strip.getByRole("button", { pressed: true })).toHaveAccessibleName(/ km$/);

    // A run planned today: today's Lunch run matches it, is unlinked, then linked by hand.
    await moveFirstRunToToday();
    await page.goto("/week");
    const today = strip.getByRole("button", { name: /, today: .*, done$/ });
    await expect(today).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Open the full session" }).click();
    await expect(page.getByText(/^Matched: /)).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("coach-session.png", {
      fullPage: true,
      mask: [syncButton(page)],
    });
    await page.getByRole("button", { name: "Not this run" }).click();
    await expect(page.getByText("Done", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Link Lunch run/ }).click();
    await expect(page.getByText("Linked by you.")).toBeVisible();
    await expect(page.getByText("Done", { exact: true })).toBeVisible();
    await page.getByRole("main").getByRole("button", { name: "Plan", exact: true }).click();
    await expect(today).toHaveAttribute("aria-pressed", "true");

    // Away to the week planner and back: the setup stays, and the plan is written again.
    await choosePlanningStyle(page, "Week planner", "weekPlanner");
    await page.goto("/week");
    await expect(page.getByRole("button", { name: "Today: open the day" })).toBeVisible();
    const rewritten = writingStarts(page);
    await choosePlanningStyle(page, "Coach plan", "coachPlan");
    await expect(page.getByRole("button", { name: "Save and rewrite plan" })).toBeDisabled();
    await page.goto("/week");
    await expectPlanWritten(page, rewritten);
  } finally {
    await leaveCoachPlan(page);
  }
});

/** The A race the coach plan needs, then availability; ends on Plan with the plan written. */
async function addRaceAndWritePlan(page: Page) {
  const raceDay = new Date(Date.parse(E2E_NOW) + 70 * 86_400_000).toISOString().slice(0, 10);
  // With the coach plan, goals have no objective: new ones are saved as perform.
  await pasteGoal(page, {
    name: "Autumn half",
    sportType: "Run",
    date: raceDay,
    distanceM: 21_097.5,
    elevationGainM: null,
    objective: "finish",
    priority: "A",
  });
  await expect(page.getByText(/· Finish/)).toHaveCount(0);

  await page.goto("/settings/training");
  await settle(page);
  await expect(page.getByText("The coach plan can't be written yet")).toHaveCount(0);
  const written = writingStarts(page);
  await setAvailability(page);
  // The phone run leaves this availability saved (each style keeps its setup): then the new
  // goal alone has the plan written again, when it is next loaded.
  const save = page.getByRole("button", { name: "Save availability" });
  if (await save.isVisible()) await save.click();
  // Saved before leaving, or leaving would cancel the save on its way.
  await expect(page.getByRole("button", { name: "Save and rewrite plan" })).toBeVisible();

  await page.goto("/week");
  await expectPlanWritten(page, written);
}

/**
 * The other specs share this athlete and expect the week planner and no goals, and the other
 * project's run writes its own plan.
 */
async function leaveCoachPlan(page: Page) {
  await choosePlanningStyle(page, "Week planner", "weekPlanner");
  await dropWrittenPlan();
  await deleteGoalIfThere(page, /Run · 21\.1 km/);
}

test("an athlete changes the coach plan from the chat and from a note on a day", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Mock Strava's athlete ran today, so the plan can change from tomorrow, Thursday 18 June.
  const thursday = page
    .getByRole("group", { name: "Days of the week" })
    .getByRole("button", { name: /^Thursday 18 June/ });
  try {
    await choosePlanningStyle(page, "Coach plan", "coachPlan");
    await addRaceAndWritePlan(page);
    await expect(thursday).not.toHaveAccessibleName(/rest day$/);

    // From the plan, the chat opens ready for a change. The coach proposes one that passed the
    // rules; declining it changes nothing.
    await page.getByRole("button", { name: "Ask the coach to change my plan" }).click();
    await page.getByRole("button", { name: "I can't run on Thursday this week" }).click();
    const card = page.getByRole("group", { name: "Plan change" }).last();
    await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Thu 18 Jun");
    // Nothing else can be asked until the change is answered.
    const composer = page.getByRole("textbox", { name: "Message the coach" });
    await expect(composer).toBeDisabled();
    await card.getByRole("button", { name: "Decline" }).click();
    await expect(card).toContainText("Declined: your plan stays as it was");
    await expect(page.getByText("No problem: your plan stays as it was.")).toBeVisible();

    // Asked again and applied: Thursday is a rest day on the plan.
    await composer.fill("I can't run on Thursday this week");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Apply" }).click();
    await expect(card).toContainText("Applied to your plan");
    await expect(page.getByText("Done: the change is in your plan.")).toBeVisible();

    // A change proposed before the plan changed again is not applied.
    await composer.fill("I can't run on Sunday this week");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(card.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
    await withDatabase((client) =>
      client.query("update coach_plans set plan = jsonb_set(plan, '{model}', '\"edited\"')"),
    );
    await card.getByRole("button", { name: "Apply" }).click();
    await expect(card).toContainText(/^.*Your plan changed since the coach proposed this/);

    await page.goto("/week");
    await expect(thursday).toHaveAccessibleName(/rest day$/);

    // A note on a day goes the same way, without the chat.
    const saturday = page
      .getByRole("group", { name: "Days of the week" })
      .getByRole("button", { name: /^Saturday 20 June/ });
    await saturday.click();
    await page.getByRole("button", { name: "Indoor only" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Apply" })).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await expect(dialog).toHaveScreenshot("plan-change-note.png");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toContainText("Applied to your plan");
    // The athlete can answer the coach without opening the chat.
    await expect(dialog.getByRole("textbox", { name: "Reply to the coach" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: /\(treadmill\)/ })).toBeVisible();
  } finally {
    await leaveCoachPlan(page);
  }
});

// The mock coach answers without a key, so these prove the client and server still speak the
// same stream after a TanStack AI upgrade. "Long run" keeps the screenshot activity unanalyzed.
test("an athlete analyzes an activity and the analysis stays with it", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  // One week on a phone, a month on desktop: the last long run is in the one before either way.
  await page.getByRole("button", { name: /^Previous / }).click();
  await page.locator("[data-event-id]").filter({ hasText: "Long run" }).first().click();
  await expect(page.getByRole("heading", { name: "Long run", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /^Analyze/ }).click();
  await expect(page.getByText(/^By Mock coach, saved/)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText(/^By Mock coach, saved/)).toBeVisible();
});

test("an athlete asks the coach a question and gets an answer", async ({ page }) => {
  await page.goto("/coach");
  await page.getByRole("button", { name: "How did my last run go?" }).click();
  await expect(page.getByText(/This is the mock coach/)).toBeVisible({ timeout: 30_000 });
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
