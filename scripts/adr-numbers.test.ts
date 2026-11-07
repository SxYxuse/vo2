import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

/*
 * Agents working in parallel each take the next free ADR number, and both land (0012 and 0020
 * were each used twice). A clash fails here instead of after merge. Pick the number with
 * `bun scripts/next-adr.ts`; rename one that main took first with `bun scripts/renumber-adr.ts`.
 */

const ROOT = join(import.meta.dirname, "..");
const ADR_DIR = join(ROOT, "docs/adr");

const files = readdirSync(ADR_DIR).filter((name) => name.endsWith(".md"));
const numbers = new Set(files.map((name) => name.slice(0, 4)));

describe("ADR numbers", () => {
  it("name every ADR NNNN-title.md", () => {
    expect(files.filter((name) => !/^\d{4}-[a-z0-9-]+\.md$/.test(name))).toEqual([]);
  });

  it("are unique", () => {
    const byNumber = new Map<string, string[]>();
    for (const name of files)
      byNumber.set(name.slice(0, 4), [...(byNumber.get(name.slice(0, 4)) ?? []), name]);
    const clashes = [...byNumber.values()].filter((names) => names.length > 1);
    expect(clashes).toEqual([]);
  });
});

/** "ADR 0037", "ADRs 0037 and 0040", "ADR-0037, 0038", or a link "[0037](…)". */
const CITATION = /\bADRs?[ -]?\d{4}(?:(?:,|,? and|,? or) \d{4})*|\[\d{4}\]\(/g;

describe("ADR citations", () => {
  it("name an ADR that exists", () => {
    // A renumbered ADR left comments citing its old number (PR #200 cited 0062 for 0063).
    const tracked = execFileSync("git", ["ls-files", "src", "e2e", "scripts", "docs", "*.md"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const stale: string[] = [];
    for (const path of tracked.split("\n").filter((p) => /\.(tsx?|css|md)$/.test(p)))
      for (const [citation] of readFileSync(join(ROOT, path), "utf8").matchAll(CITATION))
        for (const [cited] of citation.matchAll(/\d{4}/g))
          if (!numbers.has(cited)) stale.push(`${path}: ${citation}`);
    expect(stale).toEqual([]);
  });

  it("are answered: an ADR that supersedes another is named in that one's Superseded by", () => {
    // Readers land on the old ADR first; without the back-link they act on a dead decision.
    const sentences = new Map(
      files.map((name) => [
        name.slice(0, 4),
        readFileSync(join(ADR_DIR, name), "utf8").split(/(?<=\.)\s+|\n+/),
      ]),
    );
    const missing = new Set<string>();
    for (const [adr, own] of sentences)
      for (const sentence of own.filter((s) => /\bsupersedes\b/i.test(s))) {
        // "Supersedes [0050] … and extends [0054]": only the clause before "extends" counts.
        const clause = sentence.split(/\bextends\b/)[0];
        for (const [old] of clause.matchAll(/\b\d{4}\b/g)) {
          const answered = sentences
            .get(old)
            ?.some((s) => /superseded/i.test(s) && new RegExp(`\\b${adr}\\b`).test(s));
          if (old !== adr && answered === false) missing.add(`${old} needs "Superseded by ${adr}"`);
        }
      }
    expect([...missing]).toEqual([]);
  });
});
