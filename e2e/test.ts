import { test as base, expect, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import { E2E_NOW, E2E_URL, e2eDatabaseUrl } from "./env.ts";
import { waitForHydration } from "./onboard.ts";

export const test = base.extend<{ freshAthlete: void }>({
  freshAthlete: [
    // Playwright reads a fixture's dependencies from this pattern, and this one needs none.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      if (testInfo.project.dependencies.includes("setup")) await resetAthlete();
      await use();
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    await page.clock.install({ time: new Date(E2E_NOW) });
    await page.route(
      (url) => url.origin !== E2E_URL,
      (route) => route.abort(),
    );
    await use(page);
  },
});

export { expect, type Locator, type Page };

const SNAPSHOT_SCHEMA = "e2e_athlete";

const NOT_RESET = ["user", "session", "account", "verification", "activity_streams"];

const UPDATED_IN_PLACE = "activities";

export async function withDatabase<T>(use: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

export async function snapshotAthlete() {
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> all($1)",
      [NOT_RESET],
    );
    await client.query(`drop schema if exists ${SNAPSHOT_SCHEMA} cascade`);
    await client.query(`create schema ${SNAPSHOT_SCHEMA}`);
    for (const { tablename } of rows) {
      await client.query(
        `create table ${SNAPSHOT_SCHEMA}."${tablename}" as table public."${tablename}"`,
      );
    }
  });
}

export async function resetAthlete() {
  await withDatabase(async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = $1",
      [SNAPSHOT_SCHEMA],
    );
    if (rows.length === 0) throw new Error("No athlete snapshot: run the setup project first.");
    const { rows: columns } = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = $1 and table_name = $2 and column_name <> 'id'",
      [SNAPSHOT_SCHEMA, UPDATED_IN_PLACE],
    );
    const list = columns.map(({ column_name }) => `"${column_name}"`).join(", ");
    const snapshotted = columns.map(({ column_name }) => `s."${column_name}"`).join(", ");
    await client.query("begin");
    await client.query(
      `update public.${UPDATED_IN_PLACE} a set (${list}) = row(${snapshotted}) from ${SNAPSHOT_SCHEMA}.${UPDATED_IN_PLACE} s where s.id = a.id`,
    );
    for (const { tablename } of rows) {
      if (tablename === UPDATED_IN_PLACE) continue;
      await client.query(`delete from public."${tablename}"`);
      await client.query(
        `insert into public."${tablename}" select * from ${SNAPSHOT_SCHEMA}."${tablename}"`,
      );
    }
    await client.query("commit");
  });
}

export async function settle(page: Page) {
  await waitForHydration(page);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
}

export function syncButton(page: Page) {
  return page.getByRole("button", { name: /Sync from Strava/ });
}

type OfflineViews = Record<string, Record<string, unknown> | undefined>;

export async function waitForOfflineCopy(page: Page, predicate: (views: OfflineViews) => boolean) {
  await expect
    .poll(async () =>
      predicate(
        await page.evaluate(
          () =>
            new Promise<OfflineViews>((resolve) => {
              const open = indexedDB.open("keyval-store");
              open.onerror = () => resolve({});
              open.onsuccess = () => {
                const read = open.result
                  .transaction("keyval")
                  .objectStore("keyval")
                  .get("vo2-offline-copy");
                read.onerror = () => resolve({});
                read.onsuccess = () => {
                  type Saved = { queryKey: unknown[]; state: { data?: Record<string, unknown> } };
                  const queries: Saved[] = read.result?.clientState?.queries ?? [];
                  const views: OfflineViews = {};
                  for (const query of queries)
                    views[String(query.queryKey[0])] ??= query.state.data;
                  resolve(views);
                };
              };
            }),
        ),
      ),
    )
    .toBe(true);
}

export async function openFresh(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => indexedDB.deleteDatabase("keyval-store"));
  await page.reload();
  await settle(page);
}

/**
 * Runs `action` and waits until the save it sends (a server function whose request names
 * `saves`) has finished. networkidle has already passed once the page loaded, so settle() would
 * let a navigation, or the end of the test, cancel the save on its way.
 */
export async function waitForSave(page: Page, saves: string, action: () => Promise<unknown>) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/_serverFn/") &&
      (response.request().postData() ?? "").includes(saves),
  );
  await action();
  expect((await saved).ok()).toBe(true);
}
