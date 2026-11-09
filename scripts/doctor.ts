import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import {
  DATABASE_PREFIX,
  SHARED_DATABASE,
  assertSafeIdentifier,
  databaseFromUrl,
  pathHash,
  pgPort,
  readEnvValue,
} from "./worktree-env.ts";
import { CONTAINER, composeProject, publishedPorts } from "./worktree-setup.ts";

// `vp run doctor`: checks what setup and sign-in need and prints the fix for each failure. It
// only reads, and needs nothing from node_modules, so it runs before `bun install` too.

type Check = { name: string; run: () => Promise<string | undefined> | string | undefined };

const root = realpathSync(
  execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
);
const isMain =
  execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-dir"], {
    encoding: "utf8",
  }) ===
  execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  });
const envPath = join(root, ".env");
const envText = existsSync(envPath) ? readFileSync(envPath, "utf8") : undefined;
const databaseUrl = readEnvValue(envText ?? "", "DATABASE_URL");
const database = databaseFromUrl(databaseUrl);
const expectedPort = pgPort(envText);

function answers(port: number, host = "localhost") {
  return new Promise<boolean>((done) => {
    const socket = connect({ port, host, timeout: 1000 });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function psql(db: string, sql: string) {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "vo2", "-d", assertSafeIdentifier(db), "-Atc", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

const checks: Check[] = [
  {
    name: "node_modules installed",
    run: () =>
      existsSync(join(root, "node_modules/.bin/drizzle-kit"))
        ? undefined
        : "node_modules is missing or incomplete. Fix: `bun install --frozen-lockfile`.",
  },
  {
    name: ".env names this checkout's database",
    run: () => {
      if (envText === undefined) return ".env is missing. Fix: `vp run db:setup`.";
      if (!databaseUrl) return ".env has no DATABASE_URL. Fix: `vp run db:setup`.";
      const url = new URL(databaseUrl);
      if (url.port !== String(expectedPort)) {
        return (
          `DATABASE_URL uses port ${url.port || 5432}, but VO2 Postgres is on port ${expectedPort}. ` +
          "Fix: `vp run db:setup` (it moves a 5432 URL), or set the port in DATABASE_URL by hand."
        );
      }
      if (isMain) {
        return database === SHARED_DATABASE
          ? undefined
          : `The main checkout uses database ${database}, not ${SHARED_DATABASE}. Fix: set DATABASE_URL to ${SHARED_DATABASE}.`;
      }
      // A worktree's database ends in its path hash (worktreeDatabaseName), so .env copied from
      // another checkout fails here.
      const own = database?.startsWith(DATABASE_PREFIX) && database.endsWith(`_${pathHash(root)}`);
      return own
        ? undefined
        : `This worktree uses database ${database}, which belongs to another checkout. ` +
            "Fix: `bun scripts/worktree-setup.ts --isolate`.";
    },
  },
  {
    name: `Postgres answers on port ${expectedPort} from compose project vo2`,
    run: async () => {
      const project = composeProject();
      if (project === undefined) {
        return `Container ${CONTAINER} does not exist or Docker is not running. Fix: \`vp run db:up\`.`;
      }
      if (project !== "vo2") {
        return `${CONTAINER} belongs to compose project ${project || "(none)"}, not vo2. Fix: remove it, then \`vp run db:up\`.`;
      }
      if (!publishedPorts().has(expectedPort)) {
        const ports = [...publishedPorts()].join(", ") || "no port";
        return (
          `${CONTAINER} publishes ${ports}, not ${expectedPort}. Fix: \`vp run db:up\` recreates it on ` +
          `${expectedPort} and keeps its data; other checkouts then run \`vp run db:setup\`.`
        );
      }
      return (await answers(expectedPort))
        ? undefined
        : `Nothing answers on localhost:${expectedPort}. Fix: \`vp run db:up\`, then \`docker logs ${CONTAINER}\`.`;
    },
  },
  {
    name: "migrations are current",
    run: () => {
      if (!database) return "Skipped: no database in .env.";
      const journal = JSON.parse(
        readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"),
      ) as {
        entries: { when: number; tag: string }[];
      };
      const latest = journal.entries.at(-1);
      let applied: number;
      try {
        if (psql("postgres", `SELECT 1 FROM pg_database WHERE datname = '${database}'`) !== "1") {
          return `Database ${database} does not exist. Fix: \`vp run db:setup\`.`;
        }
        // drizzle-kit applies every migration newer than the latest created_at it recorded.
        applied = Number(
          psql(database, "SELECT coalesce(max(created_at), 0) FROM drizzle.__drizzle_migrations") ||
            0,
        );
      } catch (error) {
        const reason = (error as { stderr?: string }).stderr?.trim() || String(error);
        if (reason.includes("__drizzle_migrations")) applied = 0;
        else return `Could not read migrations from ${database}: ${reason}`;
      }
      return latest && applied < latest.when
        ? `Database ${database} is behind ${latest.tag}. Fix: \`vp run db:migrate\`.`
        : undefined;
    },
  },
  {
    name: "dev-server PORT is free",
    run: async () => {
      const port = Number(readEnvValue(envText ?? "", "PORT"));
      if (!Number.isInteger(port) || port <= 0)
        return "PORT is not set in .env. Fix: `vp run db:setup`.";
      const taken = (await answers(port, "127.0.0.1")) || (await answers(port, "::1"));
      return taken
        ? `Port ${port} is taken. Fix: stop the process \`ss -ltnp | grep :${port}\` shows (by its PID), ` +
            "or `vp run db:setup` in a worktree to pick another port."
        : undefined;
    },
  },
];

let failed = 0;
for (const check of checks) {
  const problem = await check.run();
  if (problem) failed += 1;
  console.log(`${problem ? "✗" : "✓"} ${check.name}${problem ? `\n    ${problem}` : ""}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
