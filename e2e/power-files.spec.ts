import pg from "pg";

import { e2eDatabaseUrl } from "./env.ts";
import { rideFitFile } from "./power-file.ts";
import { test, expect, settle, syncButton, type Page } from "./test.ts";

/** The FIT file of mock Strava's threshold ride, so the import matches a synced ride. */
async function thresholdRideFile() {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const { rows } = await client.query<{ start_date: Date }>(
      "select start_date from activities where name = 'Threshold ride' limit 1",
    );
    return rideFitFile(rows[0]!.start_date);
  } finally {
    await client.end();
  }
}

async function openPowerFromSidebar(page: Page) {
  await page.goto("/");
  await settle(page);
  if (test.info().project.name === "phone") {
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  }
  await page.getByRole("link", { name: "Power", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Power", level: 1 })).toBeVisible();
}

function importFile(page: Page, name: string, buffer: Buffer) {
  return page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}

test("an athlete imports a ride's FIT file, reads its pedaling, asks the coach, opens the ride, and deletes it", async ({
  page,
}) => {
  // The mock coach answers at a model's pace.
  test.setTimeout(90_000);
  const fit = await thresholdRideFile();
  await openPowerFromSidebar(page);
  await expect(page.getByText("No power files yet")).toBeVisible();

  await importFile(page, "threshold.fit", fit);
  await page.waitForURL(/\/power\/[^/]+$/);
  const analysisUrl = page.url();
  // Named after the synced ride it matched by start time.
  await expect(page.getByRole("heading", { name: "Threshold ride", level: 1 })).toBeVisible();
  await expect(page.getByText("L 52 / R 48").first()).toBeVisible();

  await page.getByRole("button", { name: /^Pedaling dynamics/ }).click();
  await expect(page.getByText("Right 48.1 %")).toBeVisible();
  await expect(
    page.getByRole("img", { name: /^Left power phase from 356° to 195°/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Seated and standing/ }).click();
  await expect(page.getByText("2 times out of the saddle, 1:10 in all.")).toBeVisible();
  await settle(page);
  // Opening the sections scrolled the page; the sidebar of a full-page shot sits at the scroll.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("power-file.png", {
    fullPage: true,
    mask: [syncButton(page)],
  });

  // A section asks the coach about itself: the question waits in the message box with the file
  // brought in, and the answer links back to the analysis.
  const question = "What do my pedaling dynamics say, and what should I change?";
  await page.getByRole("link", { name: question }).click();
  await expect(page.getByRole("textbox", { name: "Message the coach" })).toHaveValue(question);
  await expect(page.getByRole("button", { name: "Remove Threshold ride" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText(/Your legs split the work L 52 \/ R 48, well within the usual range/),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Threshold ride" }).last().click();
  await expect(page).toHaveURL(analysisUrl);
  await expect(page.getByRole("link", { name: "Ask the coach about this ride" })).toBeVisible();

  // Both ways between the analysis and the synced ride.
  await page.getByRole("link", { name: "Open ride" }).click();
  await expect(page.getByRole("heading", { name: "Threshold ride", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Power analysis" }).click();
  await expect(page).toHaveURL(analysisUrl);

  // The same file again opens the first import instead of adding a copy.
  await page.getByRole("link", { name: "Power", exact: true }).first().click();
  await expect(page.getByRole("link", { name: /Threshold ride/ })).toHaveCount(1);
  await importFile(page, "threshold-again.fit", fit);
  await expect(page).toHaveURL(analysisUrl);

  await page.getByRole("button", { name: "Delete power file" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL("/power");
  await expect(page.getByText("No power files yet")).toBeVisible();

  // Anything but a FIT file is turned away, and nothing is saved.
  await importFile(page, "notes.txt", Buffer.from("not a ride"));
  await expect(page.getByText("Could not import notes.txt")).toBeVisible();
  await expect(page.getByText(/This is not a FIT file/)).toBeVisible();
  await expect(page.getByText("No power files yet")).toBeVisible();

  await page.goto(analysisUrl);
  await expect(page.getByText("Power file not found")).toBeVisible();
});
