/*
 * Renumbers this branch's ADR, for when main took its number first.
 *
 *   bun scripts/renumber-adr.ts <old> <new>
 *
 * Renames the ADR this branch adds and rewrites the old number only on lines this branch added or
 * changed since it left origin/main. After a rebase, main has its own ADR with the old number, and
 * a repo-wide replace once rewrote main's citations of it too.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";

const [from, to] = process.argv.slice(2);
if (!/^\d{4}$/.test(from ?? "") || !/^\d{4}$/.test(to ?? "")) {
  console.error("Usage: bun scripts/renumber-adr.ts <old> <new>, both four-digit ADR numbers.");
  process.exit(1);
}

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const root = git("rev-parse", "--show-toplevel").trim();
process.chdir(root);
const base = git("merge-base", "origin/main", "HEAD").trim();
const onMain = new Set(git("ls-tree", "--name-only", "origin/main", "docs/adr/").split("\n"));

const ours = readdirSync("docs/adr")
  .map((name) => `docs/adr/${name}`)
  .filter((path) => path.startsWith(`docs/adr/${from}-`) && !onMain.has(path));
if (ours.length !== 1) {
  console.error(`Expected one ADR ${from} that origin/main does not have; found ${ours.length}.`);
  process.exit(1);
}
if (readdirSync("docs/adr").some((name) => name.startsWith(`${to}-`))) {
  console.error(`ADR ${to} already exists; pick a free number with bun scripts/next-adr.ts.`);
  process.exit(1);
}
const renamed = ours[0].replace(`docs/adr/${from}-`, `docs/adr/${to}-`);
renameSync(ours[0], renamed);

/** Line numbers (1-based) each changed file holds that origin/main's copy does not; null = all. */
const added = new Map<string, Set<number> | null>();
for (const path of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean))
  added.set(path, null);
let current = "";
for (const line of git("diff", "--unified=0", "--no-renames", base).split("\n")) {
  if (line.startsWith("+++ ")) {
    current = line === "+++ /dev/null" ? "" : line.slice("+++ b/".length);
    if (current && !added.has(current)) added.set(current, new Set());
    continue;
  }
  const hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
  const lines = current ? added.get(current) : undefined;
  if (!hunk || !lines) continue;
  const start = Number(hunk[1]);
  for (let n = start; n < start + Number(hunk[2] ?? 1); n++) lines.add(n);
}

const number = new RegExp(`\\b${from}\\b`, "g");
const changed: string[] = [];
for (const [path, lines] of added) {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  const rewritten = text
    .split("\n")
    .map((line, i) => (lines === null || lines.has(i + 1) ? line.replace(number, to) : line))
    .join("\n");
  if (rewritten === text) continue;
  writeFileSync(path, rewritten);
  changed.push(path);
}

console.log(`Renamed ${ours[0]} to ${renamed}.`);
console.log(
  changed.length
    ? `Rewrote ${from} to ${to} on this branch's lines in:\n  ${changed.join("\n  ")}`
    : `No other line this branch added cites ${from}.`,
);
console.log("Review with git diff, then stage the rename with git add -A docs/adr.");
