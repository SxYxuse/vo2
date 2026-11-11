/*
 * Gets this checkout's running dev server (`vp run dev:mock`) to a signed-in mock athlete in one
 * command: replaces any mock athlete, signs in through mock Strava, copies the training, and
 * finishes onboarding with planning off. Writes a Playwright storageState and prints a URL that
 * signs any browser in as the same athlete.
 *
 *   vp run dev:seed [--history <years>] [--fresh-streams]
 *                   [--never-synced | --mid-onboarding | --coach-plan]
 *
 *   --history <years>  Mock Strava serves this many years of training instead of eight weeks.
 *   --fresh-streams    Celebrations on, and the last week's streams not copied yet, so the next
 *                      Sync from Strava copies them again and finds top 10 efforts.
 *   --never-synced     Stops signed in on onboarding, before anything is copied.
 *   --mid-onboarding   Stops on onboarding once the training is copied, before the setup steps.
 *   --coach-plan       Onboards with the coach plan, written by the mock coach, toward a half
 *                      marathon in ten weeks. It also records the plan-writer request that
 *                      `vp run coach:replay` sends to a real model (needs `vp run dev:mock`).
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { chromium } from "@playwright/test";
import { config } from "dotenv";
import pg from "pg";

import { connectStrava, copyTraining, onboardNewAthlete } from "../e2e/onboard.ts";

config({ path: [".env"], quiet: true });

const { values } = parseArgs({
  options: {
    history: { type: "string" },
    "fresh-streams": { type: "boolean", default: false },
    "never-synced": { type: "boolean", default: false },
    "mid-onboarding": { type: "boolean", default: false },
    "coach-plan": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`dev:seed: ${message}`);
  process.exit(1);
}

if (process.env.STRAVA_MOCK !== "1") fail("mock Strava only: set STRAVA_MOCK=1 in .env.");
if (
  [values["never-synced"], values["mid-onboarding"], values["coach-plan"]].filter(Boolean).length >
  1
) {
  fail("--never-synced, --mid-onboarding, and --coach-plan are different states: pick one.");
}
const onboarded = !values["never-synced"] && !values["mid-onboarding"];
if (values["fresh-streams"] && !onboarded) fail("--fresh-streams needs an onboarded athlete.");
const years = values.history == null ? null : Number(values.history);
if (years != null && !(years * 52 >= 1 && years <= 10))
  fail("--history takes a number of years, from one week (0.02) to 10.");

const BASE = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3090").origin;
const STATE_PATH = resolve(".dev-seed/athlete.json");
/** The athlete mock Strava always signs in (mock-server.ts). */
const MOCK_ATHLETE_ID = "1";
/** CELEBRATE_WITHIN_DAYS in src/services/top-efforts.ts: older activities are never celebrated. */
const CELEBRATE_WITHIN_DAYS = 7;

/** Also proves the running server is this checkout's, with mock Strava on. */
async function setMockHistory(weeks: number) {
  const response = await fetch(`${BASE}/api/mock-strava/dev/history?weeks=${weeks}`, {
    method: "POST",
  }).catch(() => null);
  if (!response) fail(`nothing answers on ${BASE}: start it with \`vp run dev:mock\`.`);
  if (!response.ok)
    fail(`${BASE} is not serving mock Strava: restart it with \`vp run dev:mock\`.`);
}

async function withDatabase<T>(use: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

const MOCK_USER = `(select user_id from account where provider_id = 'strava' and account_id = $1)`;

/** Clears the last week's streams and turns celebrations on, as an athlete would see them. */
async function freshenStreams(client: pg.Client) {
  await client.query(
    `update calendar_settings set value = jsonb_set(value, '{topEffortsSince}', to_jsonb($2::text))
     where user_id = ${MOCK_USER}`,
    [MOCK_ATHLETE_ID, new Date().toISOString()],
  );
  const { rowCount } = await client.query(
    `with recent as (
       update activities set streams_synced_at = null
       where user_id = ${MOCK_USER} and start_date >= now() - make_interval(days => $2)
       returning id
     )
     delete from activity_streams where activity_id in (select id from recent)`,
    [MOCK_ATHLETE_ID, CELEBRATE_WITHIN_DAYS],
  );
  return rowCount ?? 0;
}

await setMockHistory(years == null ? 8 : Math.round(years * 52));
// A new athlete every run: deleting the user cascades to everything they own.
await withDatabase((client) =>
  client.query(`delete from "user" where id in ${MOCK_USER}`, [MOCK_ATHLETE_ID]),
);

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
let state: string;
try {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  if (values["never-synced"]) {
    await connectStrava(page);
    state = "signed in on onboarding, nothing copied";
  } else if (values["mid-onboarding"]) {
    await connectStrava(page);
    await copyTraining(page, 60_000 * (1 + (years ?? 0) * 3));
    state = "signed in on onboarding, training copied, setup steps left";
  } else {
    const coachPlan = values["coach-plan"];
    await onboardNewAthlete(page, { coachPlan, syncTimeout: 60_000 * (1 + (years ?? 0) * 3) });
    state = coachPlan
      ? "onboarded with the coach plan written; plan-writer request recorded"
      : "onboarded with planning off";
  }
  mkdirSync(resolve(".dev-seed"), { recursive: true });
  await context.storageState({ path: STATE_PATH });
} finally {
  await browser.close();
}

if (values["fresh-streams"]) {
  const cleared = await withDatabase(freshenStreams);
  state += `, ${cleared} streams from the last ${CELEBRATE_WITHIN_DAYS} days left to copy`;
}

console.log(`Mock athlete ${state}; ${years == null ? "eight weeks" : `${years} years`} of training.
storageState: ${STATE_PATH}
Sign-in URL:  ${BASE}/api/mock-strava/dev/sign-in (signs any browser in as this athlete)`);
