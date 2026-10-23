import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DATABASE_PREFIX,
  SHARED_DATABASE,
  assertSafeIdentifier,
  databaseFromUrl,
  pathHash,
  readEnvValue,
} from "./worktree-env.ts";
import { psql, worktreePaths } from "./worktree-setup.ts";

// `vp run db:prune [--dry-run]`: drops vo2_wt_* databases whose worktree no longer exists. A
// database belongs to the worktree whose path hash ends its name, so renaming a branch keeps it.

const dryRun = process.argv.includes("--dry-run");

const paths = worktreePaths();
const liveHashes = new Set(paths.map(pathHash));
const envPath = join(process.cwd(), ".env");
const current = databaseFromUrl(
  existsSync(envPath) ? readEnvValue(readFileSync(envPath, "utf8"), "DATABASE_URL") : undefined,
);
const protectedNames = new Set([SHARED_DATABASE, "postgres", current]);

const stale = psql(`SELECT datname FROM pg_database WHERE datname LIKE '${DATABASE_PREFIX}%'`)
  .split("\n")
  .filter((name) => name.startsWith(DATABASE_PREFIX))
  .filter((name) => !protectedNames.has(name) && !liveHashes.has(name.split("_").at(-1) ?? ""));

if (stale.length === 0) console.log("No stale worktree databases");
for (const name of stale) {
  if (dryRun) {
    console.log(`Would drop ${name}`);
    continue;
  }
  // No WITH (FORCE): a session means something still uses it, so skip it and keep going.
  try {
    psql(`DROP DATABASE "${assertSafeIdentifier(name)}"`);
    console.log(`Dropped ${name}`);
  } catch {
    console.warn(`Skipped ${name}: still in use. Stop whatever is connected and run again.`);
  }
}
