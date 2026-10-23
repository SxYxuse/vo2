import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import {
  SHARED_DATABASE,
  assertSafeIdentifier,
  databaseUrl,
  pickPort,
  planEnv,
  readEnvValue,
  setEnvValues,
  worktreeDatabaseName,
} from "./worktree-env.ts";

// Run by T3's worktree hook (t3.json) and by `vp run db:setup`. Gives a feature worktree its own
// database on the shared vo2-postgres server and its own dev-server port. Safe to run twice.

const CONTAINER = "vo2-postgres";
const isolate = process.argv.includes("--isolate");

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readOptional(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** Listed paths, resolved like `--show-toplevel` so path hashes match across scripts. */
export function worktreePaths() {
  return git("worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .map((path) => (existsSync(path) ? realpathSync(path) : path));
}

export function psql(sql: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      CONTAINER,
      "psql",
      "-U",
      "vo2",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

function isHealthy() {
  try {
    const status = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Health.Status}}", CONTAINER],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return status.trim() === "healthy";
  } catch {
    return false;
  }
}

function startServer() {
  // Skips compose when another checkout already started the server.
  if (isHealthy()) return;
  execFileSync("docker", ["compose", "up", "-d", "--wait"], { stdio: "inherit" });
}

function createDatabase(name: string) {
  const database = assertSafeIdentifier(name);
  if (database === SHARED_DATABASE) throw new Error(`Refusing to target ${SHARED_DATABASE}`);
  if (psql(`SELECT 1 FROM pg_database WHERE datname = '${database}'`) === "1") {
    console.log(`Database ${database} already exists`);
    return;
  }
  psql(`CREATE DATABASE "${database}"`);
  console.log(`Created database ${database}`);
}

function isListening(port: number) {
  const probe = (host: string) =>
    new Promise<boolean>((done) => {
      const socket = connect({ port, host, timeout: 300 });
      const finish = (open: boolean) => {
        socket.destroy();
        done(open);
      };
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((open) => open.some(Boolean));
}

function portsOfOtherWorktrees(self: string) {
  const ports = new Set<number>();
  for (const path of worktreePaths()) {
    if (path === self) continue;
    const port = Number(readEnvValue(readOptional(join(path, ".env")) ?? "", "PORT"));
    if (Number.isInteger(port) && port > 0) ports.add(port);
  }
  return ports;
}

async function main() {
  const root = realpathSync(git("rev-parse", "--show-toplevel"));
  const envPath = join(root, ".env");
  const examplePath = join(root, ".env.example");
  const gitDir = git("rev-parse", "--path-format=absolute", "--git-dir");
  const isMain = gitDir === git("rev-parse", "--path-format=absolute", "--git-common-dir");

  if (isMain) {
    if (!existsSync(envPath)) {
      copyFileSync(examplePath, envPath);
      console.log("Main checkout: copied .env.example to .env");
    } else {
      console.log("Main checkout: keeps database vo2 and its .env");
    }
    return;
  }

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const database = worktreeDatabaseName(branch === "HEAD" ? "" : branch, root);
  const existing = readOptional(envPath);
  const plan = planEnv(existing, database, isolate);

  if (plan.kind === "keep") {
    const shared = plan.database === SHARED_DATABASE;
    console.log(
      `.env left unchanged: this checkout still uses database ${plan.database ?? "(unknown)"}` +
        `${shared ? `, shared with the main checkout` : ""}.\n` +
        `Run \`bun scripts/worktree-setup.ts --isolate\` to switch it to ${database}.`,
    );
    return;
  }

  startServer();
  createDatabase(database);

  let base = existing;
  if (base === undefined) {
    const mainRoot = process.env.T3CODE_PROJECT_ROOT || worktreePaths()[0];
    base = readOptional(join(mainRoot, ".env")) ?? readFileSync(examplePath, "utf8");
  }
  const current = Number(readEnvValue(existing ?? "", "PORT"));
  const port = await pickPort(current, portsOfOtherWorktrees(root), isListening);
  writeFileSync(
    envPath,
    setEnvValues(base, {
      DATABASE_URL: databaseUrl(database),
      PORT: String(port),
      BETTER_AUTH_URL: `http://localhost:${port}`,
    }),
  );
  console.log(`Wrote .env: database ${database}, port ${port}`);

  // `bun run` puts node_modules/.bin on PATH, which a bare spawn from the T3 hook may not have.
  // DATABASE_URL is passed explicitly because dotenv never overrides an inherited value.
  execFileSync("bun", ["run", "db:migrate"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl(database) },
  });
  console.log("Migrated. The database is empty until Connect Strava and Sync from Strava.");
}

if (import.meta.main) await main();
