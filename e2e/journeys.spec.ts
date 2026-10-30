import { test, expect, settle, type Page } from "./test.ts";

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
