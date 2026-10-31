import { E2E_NOW } from "./env.ts";
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
    return page.getByRole("link", { name: "This week", exact: true }).count();
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
    await expect(page.getByText(/^Estimated from road runs/)).toBeVisible();
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
    // The device's copy is written at most once a second, so a page opened right after setting
    // the result can restore paces from before it. Drop it to read the server's.
    await page.goto("/settings/paces");
    await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
    await page.reload();
    await settle(page);
    const clear = page.getByRole("button", { name: "Clear race result" });
    await expect(clear.or(page.getByRole("button", { name: "Set race result" }))).toBeVisible();
    if (await clear.isVisible()) await clear.click();
    await expect(page.getByRole("button", { name: "Set race result" })).toBeVisible();
  }
});

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

/** Waits for the plan to be written: an earlier plan stays on screen while the next is written. */
async function expectPlanWritten(page: Page) {
  await expect(page.getByText("Writing your plan…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/km planned of a \d+ km budget/).first()).toBeVisible();
}

test("an athlete switches to the coach plan, sets it up, and switches away and back", async ({
  page,
}) => {
  // Two plan writings and four style switches, each saved and checked on the device.
  test.setTimeout(90_000);
  const raceDay = new Date(Date.parse(E2E_NOW) + 70 * 86_400_000).toISOString().slice(0, 10);
  try {
    await choosePlanningStyle(page, "Coach plan", "coachPlan");
    // No A running goal yet: Settings says what's missing and where to fix it.
    await expect(page.getByText("The coach plan can't be written yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add one in Season" })).toBeVisible();
    await page.goto("/week");
    await expect(page.getByRole("link", { name: "Add one in Season" })).toBeVisible();

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
    // The phone run leaves its availability saved (each style keeps its setup), so toggle a day:
    // a change either way, saved by "Save availability" or "Save and rewrite plan".
    await page.getByRole("button", { name: "Saturday", exact: true }).click();
    await page.getByRole("button", { name: /^Save (availability|and rewrite plan)$/ }).click();
    await expect(page.getByText("Writing your plan…")).toBeVisible();

    await page.goto("/week");
    await expectPlanWritten(page);
    await settle(page);
    await expect(page).toHaveScreenshot("week-coach-plan.png", {
      fullPage: true,
      mask: [syncButton(page)],
    });

    // Away to the week planner and back: the setup stays, and the plan is written again.
    await choosePlanningStyle(page, "Week planner", "weekPlanner");
    await page.goto("/week");
    await expect(page.getByRole("button", { name: "Today: open the day" })).toBeVisible();
    await choosePlanningStyle(page, "Coach plan", "coachPlan");
    await expect(page.getByRole("button", { name: "Save and rewrite plan" })).toBeDisabled();
    await page.goto("/week");
    await expectPlanWritten(page);
  } finally {
    // The other specs share this athlete and expect the week planner and no goals.
    await choosePlanningStyle(page, "Week planner", "weekPlanner");
    await deleteGoalIfThere(page, /Run · 21\.1 km/);
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
