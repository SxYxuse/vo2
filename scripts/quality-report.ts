/*
 * Writes the quality report CI posts on each pull request (ci.yml, job `report`) from the reports
 * the other jobs upload. A missing report means its job failed before writing it.
 *
 *   bun scripts/quality-report.ts <reports dir> [<main's reports dir>]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LIGHTHOUSE_CATEGORIES = [
  ["accessibility", "Accessibility"],
  ["best-practices", "Best practices"],
  ["seo", "SEO"],
  ["performance", "Performance"],
  ["agentic-browsing", "Agentic browsing"],
] as const;

/** One run on the same page varies by up to about this many points, so a smaller change is noise. */
const NOISE_POINTS = 5;

type LighthousePage = { path: string; scores: Record<string, number> };

/** A Lighthouse CI assertion, such as `["error", { "minScore": 0.9 }]`. */
type Assertion = [level: "error" | "warn" | "off", options?: { minScore?: number }];

export type QualityInput = {
  sha: string;
  jobs: { ci: string; lighthouse: string; e2e: string };
  /** Each page's category scores from 0 to 1, from its median Lighthouse run. */
  lighthouse: LighthousePage[] | null;
  /** The same from the latest successful run on main, to compare against. */
  baseline: { sha: string; pages: LighthousePage[] } | null;
  lighthouseAssertions: Record<string, Assertion>;
  lighthouseReportUrl: string | null;
  duplication: { percentage: number; clones: number } | null;
  duplicationLimit: number;
};

const JOB_ICONS: Record<string, string> = { success: "✅", failure: "❌", cancelled: "⏹️" };

function jobLine(name: string, result: string) {
  return `${JOB_ICONS[result] ?? "⏭️"} \`${name}\` ${result}`;
}

function comparison(value: number, before: number | undefined) {
  if (before === undefined) return "";
  const main = Math.round(before * 100);
  const change = value - main;
  if (Math.abs(change) < NOISE_POINTS) return ` (main ${main}, ≈)`;
  return ` (main ${main}, ${change > 0 ? "+" : ""}${change})`;
}

function scoreCell(
  score: number | undefined,
  before: number | undefined,
  [level, options]: Assertion,
) {
  if (score === undefined) return "not run";
  const value = Math.round(score * 100);
  const compared = comparison(value, before);
  if (level === "off" || !options?.minScore) return `${value}${compared}`;
  const icon = value >= Math.round(options.minScore * 100) ? "✅" : level === "error" ? "❌" : "⚠️";
  return `${value} ${icon}${compared}`;
}

function ruleCell([level, options]: Assertion) {
  if (level === "off" || !options?.minScore) return "none";
  const min = Math.round(options.minScore * 100);
  return level === "error" ? `≥ ${min}` : `≥ ${min} (warn)`;
}

function lighthouseSection(input: QualityInput) {
  if (!input.lighthouse?.length)
    return "**Lighthouse:** no report; the `lighthouse` job failed before it ran.";
  const pages = input.lighthouse;
  const rows = LIGHTHOUSE_CATEGORIES.map(([key, label]) => {
    const assertion = input.lighthouseAssertions[`categories:${key}`] ?? ["off"];
    const cells = pages.map((page) => {
      const before = input.baseline?.pages.find(({ path }) => path === page.path);
      return scoreCell(page.scores[key], before?.scores[key], assertion);
    });
    return `| ${label} | ${cells.join(" | ")} | ${ruleCell(assertion)} |`;
  });
  const legend = input.baseline
    ? `\n\nIn brackets: \`main\` at ${input.baseline.sha.slice(0, 7)}. A change under ${NOISE_POINTS} points is within Lighthouse's run-to-run noise (≈).`
    : "";
  const link = input.lighthouseReportUrl
    ? `\n\n[Full Lighthouse reports](${input.lighthouseReportUrl}) (zip of the HTML reports)`
    : "";
  return (
    [
      `| Lighthouse (mobile) | ${pages.map((page) => `\`${page.path}\``).join(" | ")} | Required |`,
      `|---|${pages.map(() => "---|").join("")}---|`,
      ...rows,
    ].join("\n") +
    legend +
    link
  );
}

function duplicationSection(input: QualityInput) {
  if (!input.duplication)
    return "**Duplication:** no report; the `ci` job failed before jscpd ran.";
  const { percentage, clones } = input.duplication;
  const icon = percentage <= input.duplicationLimit ? "✅" : "❌";
  return `**Duplication:** ${percentage.toFixed(2)}% ${icon} (limit ${input.duplicationLimit}%), ${clones} clones`;
}

export function formatQualityReport(input: QualityInput) {
  return [
    `### Quality report for ${input.sha.slice(0, 7)}`,
    [
      jobLine("ci", input.jobs.ci),
      jobLine("lighthouse", input.jobs.lighthouse),
      jobLine("e2e", input.jobs.e2e),
    ].join(" · "),
    lighthouseSection(input),
    duplicationSection(input),
  ].join("\n\n");
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

type ManifestRun = { url: string; isRepresentativeRun: boolean; summary: Record<string, number> };

/**
 * One column per page, in the order scripts/lighthouse.ts ran them. Agentic Browsing comes from
 * a separate Lighthouse 13 run of the sign-in page (ci.yml), when it ran.
 */
function lighthousePages(manifest: ManifestRun[] | null, agentic?: number | null) {
  if (!manifest) return null;
  return manifest
    .filter((run) => run.isRepresentativeRun)
    .map((run) => {
      const path = new URL(run.url).pathname;
      const withAgentic = path === "/sign-in" && agentic != null;
      return {
        // An activity id says nothing in a table header.
        path: path.replace(/^\/activities\/[^/]+$/, "/activities/…"),
        scores: withAgentic ? { ...run.summary, "agentic-browsing": agentic } : run.summary,
      };
    });
}

function readLighthousePages(lighthouseDir: string) {
  const agentic = readJson<{ categories: Record<string, { score: number | null }> }>(
    join(lighthouseDir, "agentic-browsing.json"),
  );
  return lighthousePages(
    readJson<ManifestRun[]>(join(lighthouseDir, "manifest.json")),
    agentic?.categories["agentic-browsing"]?.score,
  );
}

/** Main's scores, when ci.yml found a run on main to download them from. */
function lighthouseBaseline(baselineDir: string | undefined, sha: string | undefined) {
  if (!baselineDir || !sha) return null;
  const pages = readLighthousePages(baselineDir);
  return pages?.length ? { sha, pages } : null;
}

function main(reportsDir: string, baselineDir?: string) {
  const root = join(fileURLToPath(import.meta.url), "../..");
  const jscpd = readJson<{ statistics: { total: { percentage: number; clones: number } } }>(
    // The artifact holds this one file, so upload-artifact drops its folder.
    join(reportsDir, "quality/jscpd-report.json"),
  );
  const lighthouserc = readJson<{ ci: { assert: { assertions: Record<string, Assertion> } } }>(
    join(root, "lighthouserc.json"),
  );
  const jscpdConfig = readJson<{ threshold: number }>(join(root, ".jscpd.json"));

  const env = process.env;
  process.stdout.write(
    formatQualityReport({
      sha: env.SHA ?? "",
      jobs: {
        ci: env.CI_RESULT ?? "unknown",
        lighthouse: env.LIGHTHOUSE_RESULT ?? "unknown",
        e2e: env.E2E_RESULT ?? "unknown",
      },
      lighthouse: readLighthousePages(join(reportsDir, "lighthouse")),
      baseline: lighthouseBaseline(baselineDir, env.BASELINE_SHA),
      lighthouseAssertions: lighthouserc?.ci.assert.assertions ?? {},
      lighthouseReportUrl: env.LIGHTHOUSE_REPORT_URL || null,
      duplication: jscpd?.statistics.total ?? null,
      duplicationLimit: jscpdConfig?.threshold ?? 0,
    }) + "\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ?? "reports", process.argv[3]);
}
