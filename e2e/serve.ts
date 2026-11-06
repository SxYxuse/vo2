import { execFileSync, spawn } from "node:child_process";

import pg from "pg";

import { E2E_DATABASE, E2E_NOW, E2E_PORT, E2E_URL, e2eDatabaseUrl } from "./env.ts";

// Playwright's web server: a fresh database, then the production build against mock Strava.

const admin = new pg.Client({ connectionString: e2eDatabaseUrl("postgres") });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${E2E_DATABASE}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${E2E_DATABASE}"`);
await admin.end();

const env = {
  ...process.env,
  DATABASE_URL: e2eDatabaseUrl(),
  PORT: String(E2E_PORT),
  BETTER_AUTH_URL: E2E_URL,
  APP_ENV: "development",
  STRAVA_MOCK: "1",
  // Always the app's mock BRouter, even when .env names a real one: real roads change weekly.
  BROUTER_URL: "",
  E2E_NOW,
  TZ: "UTC",
};

execFileSync("bun", ["run", "db:migrate"], { stdio: "inherit", env });
spawn("bun", ["--preload", "./e2e/fixed-clock.ts", ".output/server/index.mjs"], {
  stdio: "inherit",
  env,
});
