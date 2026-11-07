/*
 * Prints the next free ADR number. Parallel branches kept taking the same one, so this looks past
 * this checkout: at origin/main and at the ADRs that open pull requests add.
 *
 *   bun scripts/next-adr.ts
 *
 * Pick the number just before opening the pull request. If main takes it first anyway, rename
 * yours with `bun scripts/renumber-adr.ts <old> <new>`.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ADR = /^docs\/adr\/(\d{4})-/;

function run(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

const taken = new Set(
  readdirSync(join(import.meta.dirname, "../docs/adr")).map((name) => `docs/adr/${name}`),
);

try {
  run("git", ["fetch", "--quiet", "origin", "main"]);
} catch {
  console.warn("Could not fetch origin/main; using the last fetched copy.");
}
for (const path of run("git", ["ls-tree", "--name-only", "origin/main", "docs/adr/"]).split("\n"))
  taken.add(path);

try {
  const pulls: { files: { path: string }[] }[] = JSON.parse(
    run("gh", ["pr", "list", "--state", "open", "--limit", "200", "--json", "files"]),
  );
  for (const pull of pulls) for (const file of pull.files) taken.add(file.path);
} catch {
  console.warn("Could not list open pull requests with gh; their ADRs are not counted.");
}

const numbers = [...taken].map((path) => Number(ADR.exec(path)?.[1] ?? 0));
console.log(String(Math.max(0, ...numbers) + 1).padStart(4, "0"));
