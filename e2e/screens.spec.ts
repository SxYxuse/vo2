import { test, expect, settle, syncButton, withDatabase } from "./test.ts";

const SCREENS = [
  { name: "calendar", path: "/", heading: "Activity calendar" },
  { name: "fitness", path: "/fitness", heading: null },
  { name: "season", path: "/season", heading: null },
  { name: "bests", path: "/bests", heading: null },
  { name: "heart-rate", path: "/heart-rate", heading: null },
  { name: "power", path: "/power", heading: "Power" },
  { name: "map", path: "/map", heading: null },
  { name: "settings-list", path: "/settings", heading: "Settings" },
  { name: "settings", path: "/settings/profile", heading: null },
  { name: "settings-training", path: "/settings/training", heading: null },
  { name: "settings-paces", path: "/settings/paces", heading: null },
  { name: "settings-coach", path: "/settings/coach", heading: null },
] as const;

for (const screen of SCREENS) {
  test(`${screen.name} screen`, async ({ page }) => {
    await page.goto(screen.path);
    if (screen.heading) {
      await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
    }
    await settle(page);
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
      mask: [syncButton(page), page.locator(".maplibregl-canvas")],
    });
  });
}

test("activity screen", async ({ page }) => {
  await page.goto("/");
  await settle(page);
  await page.locator("[data-event-id]").filter({ hasText: "Lunch run" }).first().click();
  await page.waitForURL(/\/activities\//);
  await expect(page.getByRole("button", { name: "Pace", exact: true })).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0, { timeout: 15_000 });
  await settle(page);
  await expect(page).toHaveScreenshot("activity.png", {
    fullPage: true,
    mask: [syncButton(page), page.locator(".maplibregl-canvas")],
  });
});

test("fitness screen with a time out", async ({ page }) => {
  await withDatabase((client) =>
    client.query(
      "insert into time_outs (id, user_id, kind, start_day, end_day) select 'e2e-time-out', id, 'sick', '2026-06-12', '2026-06-14' from \"user\"",
    ),
  );
  await page.goto("/fitness");
  await expect(page.locator(".recharts-reference-area")).toHaveCount(2);
  await settle(page);
  await expect(page).toHaveScreenshot("fitness-time-out.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

test("fitness screen with no road runs", async ({ page }) => {
  await withDatabase((client) =>
    client.query("update activities set summary_polyline = null where sport_type = 'Run'"),
  );
  await page.goto("/fitness");
  await expect(page.getByText("Run on the road twice to see your predicted time")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("fitness-no-road-runs.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

test("plan screen on a time out", async ({ page }) => {
  await withDatabase(async (client) => {
    await client.query(
      `update calendar_settings set value = jsonb_set(value, '{planningStyle}', '"coachPlan"')`,
    );
    await client.query(
      "insert into time_outs (id, user_id, kind, start_day) select 'e2e-time-out', id, 'sick', '2026-06-15' from \"user\"",
    );
  });
  await page.goto("/week");
  await expect(page.getByText("Sick since Mon 15 Jun")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("plan-time-out.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

test("plan screen with a time out ahead", async ({ page }) => {
  await withDatabase(async (client) => {
    await client.query(
      `update calendar_settings set value = jsonb_set(value, '{planningStyle}', '"coachPlan"')`,
    );
    await client.query(
      "insert into time_outs (id, user_id, kind, start_day, end_day) select 'e2e-time-out', id, 'injured', '2026-06-22', '2026-06-26' from \"user\"",
    );
  });
  await page.goto("/week");
  await expect(page.getByText("Injured from Mon 22 Jun to Fri 26 Jun")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("plan-time-out-ahead.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

test("calendar screen with time outs", async ({ page }) => {
  await withDatabase((client) =>
    client.query(
      `insert into time_outs (id, user_id, kind, start_day, end_day)
       select 'e2e-sick', id, 'sick', date '2026-06-01', date '2026-06-03' from "user"
       union all select 'e2e-injured', id, 'injured', date '2026-06-15', null from "user"`,
    ),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Activity calendar", level: 1 })).toBeVisible();
  await expect(page.locator("[data-slot=time-out-mark]").first()).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot("calendar-time-out.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();
    await expect(page).toHaveScreenshot("signed-out.png", { fullPage: true });
  });

  test("fitness screen", async ({ page }) => {
    await page.goto("/fitness");
    await expect(page.getByRole("heading", { name: "Sign in with Strava" })).toBeVisible();
    await expect(page.getByText("Predicted race time")).toHaveCount(0);
  });
});
