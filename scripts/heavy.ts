/*
 * Runs a heavy command (a production build, the end-to-end suite, Lighthouse) one at a time on
 * this machine. Every worktree shares the host, and two suites at once have run it out of memory
 * and timed out each other's tests.
 *
 *   bun scripts/heavy.ts <command> [args…]
 *
 * The lock is a kernel `flock`, so a killed run releases it. Without `flock` (macOS), the command
 * runs unlocked.
 */

import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";

// A fixed path, not os.tmpdir(): agents whose TMPDIR differs must still wait for each other.
const LOCK = "/tmp/vo2-heavy.lock";
const BUSY = 75;

function hasFlock() {
  return spawnSync("flock", ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * Runs a command and passes on a SIGTERM (a timeout, a killed agent). A terminal's SIGINT reaches
 * the child itself, so it is not passed on: a second one would force-quit Playwright.
 *
 * `interruptOnly`, for Playwright: it stops its web servers (the build, the app, the browser
 * container) only on SIGINT, and a SIGTERM would leave them running after the lock is released.
 * The child gets its own process group, so `timeout`'s group-wide SIGTERM never reaches it, and
 * every stop signal is passed on as SIGINT. Playwright ignores a repeat within a second.
 */
export function run(command: string, args: string[], { interruptOnly = false } = {}) {
  const child = spawn(command, args, { stdio: "inherit", detached: interruptOnly });
  const onInterrupt = () => interruptOnly && child.kill("SIGINT");
  const onTerminate = () => child.kill(interruptOnly ? "SIGINT" : "SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  return new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}

/** Runs the command once no other heavy command on this machine is running. */
export async function runHeavy([command, ...args]: string[]): Promise<number> {
  if (!command) throw new Error("usage: bun scripts/heavy.ts <command> [args…]");
  if (!hasFlock()) return run(command, args);

  // --no-fork: flock becomes the command, so the signals above reach it directly.
  const locked = (wait: boolean) =>
    run("flock", [
      ...(wait ? [] : ["--nonblock", `--conflict-exit-code=${BUSY}`]),
      "--no-fork",
      LOCK,
      command,
      ...args,
    ]);
  const code = await locked(false);
  if (code !== BUSY) return code;
  console.log(`Another worktree is running a build, e2e or Lighthouse; waiting for ${LOCK}…`);
  return locked(true);
}

if (import.meta.main) process.exit(await runHeavy(process.argv.slice(2)));
