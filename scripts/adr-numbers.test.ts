import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

/*
 * Agents working in parallel each take the next free ADR number, and both land (0012 and 0020
 * were each used twice). A clash fails here instead of after merge; take the next free number.
 */

const ADR_DIR = join(import.meta.dirname, "../docs/adr");

describe("ADR numbers", () => {
  const files = readdirSync(ADR_DIR).filter((name) => name.endsWith(".md"));

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
