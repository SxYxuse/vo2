/*
 * Claude Code PreToolUse hook (.claude/settings.json): blocks the shell commands AGENTS.md says
 * break other checkouts or the release flow. Exit code 2 blocks the call and shows the reason to
 * the agent, which can then do it the right way.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type GuardContext = {
  /** True in a linked worktree, false in the main checkout. */
  worktree: boolean;
  /** The database `.env` points this checkout at. */
  databaseName: string | null;
  /** The checked-out branch, or null when detached or unknown. */
  branch: string | null;
};

const MAIN_BRANCHES = new Set(["main", "master"]);
const RUNNERS = new Set(["vp", "vpr", "bun", "bunx", "npm", "npx", "pnpm", "yarn"]);

/** Splits on shell separators. Not quote-aware: good enough for the commands agents write. */
function segments(command: string) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().split(/\s+/).filter(Boolean))
    .map((words) => {
      // Skip `FOO=bar` assignments and `sudo`, so the first word is the program.
      let start = 0;
      while (
        start < words.length &&
        (/^[A-Z_][A-Z0-9_]*=/.test(words[start]) || words[start] === "sudo")
      ) {
        start += 1;
      }
      return { words: words.slice(start), env: words.slice(0, start) };
    })
    .filter((segment) => segment.words.length > 0);
}

export function databaseNameFrom(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

/** Why `command` must not run here, or null when it may. */
export function blockReason(command: string, context: GuardContext): string | null {
  for (const { words, env } of segments(command)) {
    const [program, ...args] = words;
    const line = words.join(" ");
    // Only a package runner runs a script; the same words in a commit message or echo are fine.
    const runs = (script: string) => RUNNERS.has(program) && args.includes(script);
    const drizzle = (subcommand: string) => {
      if (program === "drizzle-kit") return args[0] === subcommand;
      const at = args.indexOf("drizzle-kit");
      return RUNNERS.has(program) && at >= 0 && args[at + 1] === subcommand;
    };

    if (runs("db:down") || (program === "docker" && /\bcompose\b.*\b(down|stop)\b/.test(line))) {
      return "This stops the shared Postgres for every checkout on this machine. Leave it running.";
    }

    if (
      program === "pkill" ||
      program === "killall" ||
      (program === "fuser" && args.includes("-k")) ||
      (program === "kill" && /\$\((pgrep|pidof|lsof)\b/.test(line)) ||
      (program === "xargs" && args[0] === "kill")
    ) {
      return "Other worktrees run their own dev servers. Stop only the server you started, by the PID you captured when starting it.";
    }

    if (drizzle("push") || runs("db:push")) {
      return "Schema changes go through a migration: `vp run db:generate`, then `vp run db:migrate`.";
    }

    if (runs("db:migrate") || drizzle("migrate")) {
      const inline = env.find((word) => word.startsWith("DATABASE_URL="));
      const target = inline
        ? databaseNameFrom(inline.slice("DATABASE_URL=".length))
        : context.databaseName;
      if (context.worktree && target === "vo2") {
        return "A feature worktree must not migrate the main checkout's database `vo2`. Run `bun scripts/worktree-setup.ts --isolate` to give this worktree its own.";
      }
    }

    if (
      program === "gh" &&
      args[0] === "pr" &&
      args[1] === "create" &&
      args.some((arg) => /^(--label|-l)(=|$)/.test(arg))
    ) {
      return "Create the PR without labels, then add `preview` in its own `gh pr edit <n> --add-label preview` step (.agents/skills/preview-deploy/SKILL.md).";
    }

    if (program === "git" && args[0] === "push") {
      const refs = args.slice(1).filter((arg) => !arg.startsWith("-"));
      const targets = refs.slice(1).map((ref) => ref.replace(/^\+/, "").split(":").pop() ?? "");
      const toMain =
        targets.some((ref) => MAIN_BRANCHES.has(ref.replace(/^refs\/heads\//, ""))) ||
        (targets.length === 0 && context.branch != null && MAIN_BRANCHES.has(context.branch));
      if (toMain) {
        return "Don't push to main. Branch first, push the branch, and open a PR.";
      }
    }

    if (program === "git" && args[0] === "stash") {
      const sub = args[1];
      const tagged = sub === "push" && args.some((arg) => arg === "-m" || arg === "--message");
      if (
        sub === undefined ||
        sub === "pop" ||
        sub === "save" ||
        sub.startsWith("-") ||
        (sub === "push" && !tagged)
      ) {
        return "The stash is shared with every worktree and other sessions. Use a WIP commit, or `git stash push -u -m <unique-tag>` and `git stash apply <sha>`, never pop.";
      }
    }
  }
  return null;
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function contextFor(cwd: string): GuardContext {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const gitDir = git(cwd, "rev-parse", "--absolute-git-dir");
  const commonDir = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
  let databaseUrl: string | undefined;
  try {
    databaseUrl = readFileSync(join(root ?? cwd, ".env"), "utf8")
      .match(/^DATABASE_URL=(.*)$/m)?.[1]
      ?.trim();
  } catch {
    databaseUrl = undefined;
  }
  return {
    worktree: gitDir != null && commonDir != null && gitDir !== commonDir,
    databaseName: databaseNameFrom(databaseUrl),
    branch: branch && branch !== "HEAD" ? branch : null,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, "utf8")) as {
    cwd?: string;
    tool_input?: { command?: string };
  };
  const command = input.tool_input?.command ?? "";
  const reason = blockReason(command, contextFor(input.cwd ?? process.cwd()));
  if (reason) {
    process.stderr.write(`Blocked by scripts/agent-guard.ts: ${reason}\n`);
    process.exit(2);
  }
}
