import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

import { config } from "dotenv";

import { DATABASE_PREFIX, assertSafeIdentifier, pathHash } from "../scripts/worktree-env.ts";

config({ path: [".env"], quiet: true });

const root = realpathSync(
  execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
);

/**
 * Wiped on every run. Named like a worktree database, so `vp run db:prune` drops it with its
 * worktree, and never the checkout's own database, which keeps whatever the developer synced.
 */
export const E2E_DATABASE = assertSafeIdentifier(`${DATABASE_PREFIX}e2e_${pathHash(root)}`);

export function e2eDatabaseUrl(database = E2E_DATABASE) {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://vo2:vo2@localhost:55432/vo2");
  url.pathname = `/${database}`;
  return url.toString();
}

/** Its own port, so the suite runs beside this checkout's dev server. */
export const E2E_PORT = (Number(process.env.PORT) || 3000) + 1000;
export const E2E_URL = `http://localhost:${E2E_PORT}`;

/** Where the Docker browser listens (playwright.config.ts). */
export const E2E_BROWSER_PORT = E2E_PORT + 1000;

/**
 * The time the server and the browser both start from. Mock Strava builds its eight weeks of
 * activities back from "now", so a moving clock would change every screenshot every day.
 */
export const E2E_NOW = "2026-06-17T09:00:00.000Z";
