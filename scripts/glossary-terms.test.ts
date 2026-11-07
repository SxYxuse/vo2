import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";

/*
 * UI text kept using words GLOSSARY.md lists under _Avoid_ ("safety limit" for the cap). This
 * fails when a string or JSX text in src/**\/*.tsx uses one. Only phrases of two or more words
 * are checked: single words ("block", "client", "Calendar") are ordinary English and CSS classes.
 * Phrases with a qualifier in parentheses, rules such as "CTL used alone", phrases that are
 * glossary terms themselves, and "A race" (an article in most sentences) are skipped, because
 * they are only wrong in some sentences.
 */

const ROOT = join(import.meta.dirname, "..");
const glossary = readFileSync(join(ROOT, "GLOSSARY.md"), "utf8");

/**
 * Uses from before this guard, by phrase and file. Remove a line once its text follows the
 * glossary; never add one for new text.
 */
const KNOWN: Record<string, string[]> = {
  "all-time best": ["src/components/training-paces.tsx"],
  "gps track": ["src/routes/_app.map.tsx"],
  "power zone": ["src/components/power-file-detail.tsx"],
  "stress score": ["src/components/activity-ride-analysis.tsx"],
};

const glossaryTerms = new Set(
  [...glossary.matchAll(/^\*\*(.+?)\*\*:/gm)].map(([, term]) => term.toLowerCase()),
);

const avoided = [
  ...new Set(
    [...glossary.matchAll(/^_Avoid_: (.*)$/gm)]
      .flatMap(([, list]) => list.split(","))
      .map((phrase) => phrase.trim().toLowerCase()),
  ),
].filter(
  (phrase) =>
    /[ -]/.test(phrase) &&
    !phrase.includes("(") &&
    !/used alone|as a second term/.test(phrase) &&
    !phrase.startsWith("a ") &&
    phrase.split(" ").length <= 4 &&
    !glossaryTerms.has(phrase),
);

/** Every string literal and JSX text in one file, without import paths. */
function uiText(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isJsxText(node) || ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node))
      texts.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

function matches(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

describe("glossary terms in UI text", () => {
  it("finds phrases to check", () => {
    expect(avoided).toContain("safety limit");
  });

  it("avoid the glossary's _Avoid_ phrases", () => {
    const files = globSync("src/**/*.tsx", { cwd: ROOT });
    const found: string[] = [];
    for (const file of files) {
      const text = uiText(file).join("\n");
      for (const phrase of avoided) {
        if (KNOWN[phrase]?.includes(file)) continue;
        if (matches(text, phrase)) found.push(`${file}: "${phrase}"`);
      }
    }
    expect(found, "Use the glossary term instead (GLOSSARY.md)").toEqual([]);
  });

  it("list only known uses that are still there", () => {
    const fixed = Object.entries(KNOWN).flatMap(([phrase, files]) =>
      files
        .filter((file) => !matches(uiText(file).join("\n"), phrase))
        .map((file) => `${file}: "${phrase}"`),
    );
    expect(fixed, "Remove these from KNOWN").toEqual([]);
  });
});
