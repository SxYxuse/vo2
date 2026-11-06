/*
 * Writes the quality report CI posts on each pull request (ci.yml, job `report`) from the reports
 * the other jobs upload, and the Lighthouse summary of lighthouse.yml. A missing report means its
 * job failed before writing it.
 *
 *   bun scripts/quality-report.ts pr <reports dir>
 *   bun scripts/quality-report.ts lighthouse <lighthouse-report dir> [<previous run's dir>]
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

type LighthouseInput = {
  sha: string;
  result: string;
  /** Each page's category scores from 0 to 1, from its median Lighthouse run. */
  pages: LighthousePage[] | null;
  /** The same from the previous successful run on main, to compare against. */
  baseline: { sha: string; pages: LighthousePage[] } | null;
  assertions: Record<string, Assertion>;
  reportUrl: string | null;
};

type PullRequestInput = {
  sha: string;
  jobs: { ci: string; e2e: string };
  duplication: { percentage: number; clones: number } | null;
  duplicationLimit: number;
};

const JOB_ICONS: Record<string, string> = { success: "✅", failure: "❌", cancelled: "⏹️" };

function jobLine(name: string, result: string) {
  return `${JOB_ICONS[result] ?? "⏭️"} \`${name}\` ${result}`;
}

function comparison(value: number, before: number | undefined) {
  if (before === undefined) return "";
  const previous = Math.round(before * 100);
  const change = value - previous;
  if (Math.abs(change) < NOISE_POINTS) return ` (prev ${previous}, ≈)`;
  return ` (prev ${previous}, ${change > 0 ? "+" : ""}${change})`;
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

function lighthouseSection(input: LighthouseInput) {
  if (!input.pages?.length) return "**Lighthouse:** no report; the job failed before it ran.";
  const pages = input.pages;
  const rows = LIGHTHOUSE_CATEGORIES.map(([key, label]) => {
    const assertion = input.assertions[`categories:${key}`] ?? ["off"];
    const cells = pages.map((page) => {
      const before = input.baseline?.pages.find(({ path }) => path === page.path);
      return scoreCell(page.scores[key], before?.scores[key], assertion);
    });
    return `| ${label} | ${cells.join(" | ")} | ${ruleCell(assertion)} |`;
  });
  const legend = input.baseline
    ? `\n\nIn brackets: the previous run, \`main\` at ${input.baseline.sha.slice(0, 7)}. A change under ${NOISE_POINTS} points is within Lighthouse's run-to-run noise (≈).`
    : "";
  const link = input.reportUrl
    ? `\n\n[Full Lighthouse reports](${input.reportUrl}) (zip of the HTML reports)`
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

function duplicationSection(input: PullRequestInput) {
  if (!input.duplication)
    return "**Duplication:** no report; the `ci` job failed before jscpd ran.";
  const { percentage, clones } = input.duplication;
  const icon = percentage <= input.duplicationLimit ? "✅" : "❌";
  return `**Duplication:** ${percentage.toFixed(2)}% ${icon} (limit ${input.duplicationLimit}%), ${clones} clones`;
}

function formatPullRequestReport(input: PullRequestInput) {
  return [
    `### Quality report for ${input.sha.slice(0, 7)}`,
    [jobLine("ci", input.jobs.ci), jobLine("e2e", input.jobs.e2e)].join(" · "),
    duplicationSection(input),
    "Lighthouse runs on main once a day and before each release (lighthouse.yml).",
  ].join("\n\n");
}

function formatLighthouseReport(input: LighthouseInput) {
  return [
    `### Lighthouse for ${input.sha.slice(0, 7)}`,
    jobLine("lighthouse", input.result),
    lighthouseSection(input),
  ].join("\n\n");
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

type ManifestRun = { url: string; isRepresentativeRun: boolean; summary: Record<string, number> };

/**
 * One column per page, in the order scripts/lighthouse.ts ran them. Agentic Browsing comes from
 * a separate Lighthouse 13 run of the sign-in page (lighthouse.yml), when it ran.
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

/** The previous run's scores, when lighthouse.yml found one to download. */
function lighthouseBaseline(baselineDir: string | undefined, sha: string | undefined) {
  if (!baselineDir || !sha) return null;
  const pages = readLighthousePages(baselineDir);
  return pages?.length ? { sha, pages } : null;
}

const root = join(fileURLToPath(import.meta.url), "../..");
const env = process.env;

function pullRequestReport(reportsDir: string) {
  const jscpd = readJson<{ statistics: { total: { percentage: number; clones: number } } }>(
    // The artifact holds this one file, so upload-artifact drops its folder.
    join(reportsDir, "quality/jscpd-report.json"),
  );
  const jscpdConfig = readJson<{ threshold: number }>(join(root, ".jscpd.json"));
  return formatPullRequestReport({
    sha: env.SHA ?? "",
    jobs: { ci: env.CI_RESULT ?? "unknown", e2e: env.E2E_RESULT ?? "unknown" },
    duplication: jscpd?.statistics.total ?? null,
    duplicationLimit: jscpdConfig?.threshold ?? 0,
  });
}

function lighthouseReport(lighthouseDir: string, baselineDir?: string) {
  const lighthouserc = readJson<{ ci: { assert: { assertions: Record<string, Assertion> } } }>(
    join(root, "lighthouserc.json"),
  );
  return formatLighthouseReport({
    sha: env.SHA ?? "",
    result: env.LIGHTHOUSE_RESULT ?? "unknown",
    pages: readLighthousePages(lighthouseDir),
    baseline: lighthouseBaseline(baselineDir, env.BASELINE_SHA),
    assertions: lighthouserc?.ci.assert.assertions ?? {},
    reportUrl: env.LIGHTHOUSE_REPORT_URL || null,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, dir, baselineDir] = process.argv.slice(2);
  const report =
    mode === "lighthouse"
      ? lighthouseReport(dir ?? "lighthouse-report", baselineDir)
      : pullRequestReport(dir ?? "reports");
  process.stdout.write(report + "\n");
}
