/*
 * `vp run e2e` and `vp run e2e:update`: Playwright, one suite at a time on this machine.
 *
 *   vp run e2e [playwright args]                   e.g. -g "plan view" --project=phone
 *   vp run e2e:update [playwright args]            rewrites screenshots that changed past the tolerance
 *   vp run e2e:update -g "<test>" [playwright args] rewrites every screenshot of the matching tests
 *
 * Before starting, it removes what a killed run of this checkout left behind on the suite's ports.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

import { E2E_BROWSER_PORT, E2E_PORT } from "../e2e/env.ts";
import { run, runHeavy } from "./heavy.ts";

const root = realpathSync(
  execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
);

const args = process.argv.slice(2);
const locked = args[0] === "--locked";
if (locked) args.shift();
// `vp run e2e -- -g x` passes the `--` on, and Playwright then ignores every argument after it.
// Only the first one goes, once, so a grep value of `--` survives.
const separator = locked ? -1 : args.indexOf("--");
if (separator !== -1) args.splice(separator, 1);

if (args[0] === "--update") {
  args.shift();
  // Playwright's own update skips a diff under maxDiffPixelRatio, which is how a one-line text
  // change stays stale. With a filter, rewrite every matching screenshot; without one, `all` would
  // rewrite every image with rendering noise.
  const filtered = args.some((arg) => /^(-g|--grep)(=|$)/.test(arg) || /\.spec\.ts/.test(arg));
  if (!args.some((arg) => arg.startsWith("--update-snapshots") || arg === "-u")) {
    args.push(`--update-snapshots=${filtered ? "all" : "changed"}`);
  }
}

/** The pids listening on a port, or none when lsof is missing or the port is free. */
function listeners(port: number) {
  const result = spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.split("\n").filter(Boolean).map(Number) : [];
}

function cwdOf(pid: number) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  return result.stdout
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

/** A process that exits between lsof and the kill is already what we wanted. */
function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {}
}

async function freePort(port: number) {
  for (const pid of listeners(port)) {
    const cwd = cwdOf(pid);
    if (cwd !== root && !cwd?.startsWith(`${root}/`)) {
      console.error(
        `Port ${port} is held by pid ${pid}, which runs in ${cwd ?? "an unknown directory"}, ` +
          `not this checkout. Stop it, or change PORT in .env.`,
      );
      process.exit(1);
    }
    console.log(`Stopping pid ${pid}, left on port ${port} by an earlier run.`);
    signal(pid, "SIGTERM");
  }
  const deadline = Date.now() + 5_000;
  while (listeners(port).length > 0) {
    if (Date.now() > deadline) {
      for (const pid of listeners(port)) signal(pid, "SIGKILL");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function cleanUp() {
  // The browser container's port belongs to Docker's proxy, so the container goes first.
  spawnSync("docker", ["rm", "-f", `vo2-e2e-browser-${E2E_BROWSER_PORT}`], { stdio: "ignore" });
  await freePort(E2E_PORT);
  await freePort(E2E_BROWSER_PORT);
}

if (locked) {
  await cleanUp();
  // Playwright stops its web servers (the build, the app, the browser container) only on SIGINT;
  // a SIGTERM would leave them running after the lock is released.
  process.exit(await run(join(root, "node_modules/.bin/playwright"), ["test", ...args], "SIGINT"));
}
// Runs itself again inside the lock, so it never cleans up after a suite that is still running.
process.exit(await runHeavy(["bun", import.meta.filename, "--locked", ...args]));
