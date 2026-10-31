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
async function choosePlanningStyle(page: Page, label: "Off" | "Week planner", style: string) {
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
