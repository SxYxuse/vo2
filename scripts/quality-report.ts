/*
 * Writes the quality report CI posts on each pull request (ci.yml, job `report`) from the reports
 * the other jobs upload. A missing report means its job failed before writing it.
 *
 *   bun scripts/quality-report.ts <reports dir>
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { COVERAGE_FLOORS } from "./coverage-floors.ts";

const LIGHTHOUSE_CATEGORIES = [
  ["accessibility", "Accessibility"],
  ["best-practices", "Best practices"],
  ["seo", "SEO"],
  ["performance", "Performance"],
] as const;

const COVERAGE_METRICS = ["statements", "branches", "functions", "lines"] as const;

type CoverageMetric = (typeof COVERAGE_METRICS)[number];

/** A Lighthouse CI assertion, such as `["error", { "minScore": 0.9 }]`. */
type Assertion = [level: "error" | "warn" | "off", options?: { minScore?: number }];

export type QualityInput = {
  sha: string;
  jobs: { ci: string; lighthouse: string };
  /** Category scores from 0 to 1, from the median Lighthouse run. */
  lighthouse: Record<string, number> | null;
  lighthouseAssertions: Record<string, Assertion>;
  lighthouseReportUrl: string | null;
  coverage: Record<CoverageMetric, number> | null;
  coverageFloors: Record<CoverageMetric, number>;
  duplication: { percentage: number; clones: number } | null;
  duplicationLimit: number;
};

const JOB_ICONS: Record<string, string> = { success: "✅", failure: "❌", cancelled: "⏹️" };

function jobLine(name: string, result: string) {
  return `${JOB_ICONS[result] ?? "⏭️"} \`${name}\` ${result}`;
}

function lighthouseSection(input: QualityInput) {
  if (!input.lighthouse)
    return "**Lighthouse:** no report; the `lighthouse` job failed before it ran.";
  const scores = input.lighthouse;
  const rows = LIGHTHOUSE_CATEGORIES.map(([key, label]) => {
    const score = Math.round((scores[key] ?? 0) * 100);
    const [level, options] = input.lighthouseAssertions[`categories:${key}`] ?? ["off"];
    const min = Math.round((options?.minScore ?? 0) * 100);
    if (level === "off" || !options?.minScore) return `| ${label} | ${score} | none |`;
    const icon = score >= min ? "✅" : level === "error" ? "❌" : "⚠️";
    const rule = level === "error" ? `≥ ${min}` : `≥ ${min} (warn)`;
    return `| ${label} | ${score} ${icon} | ${rule} |`;
  });
  const link = input.lighthouseReportUrl
    ? `\n\n[Full Lighthouse reports](${input.lighthouseReportUrl}) (zip of the HTML reports)`
    : "";
  return (
    ["| Lighthouse (signed-out page, mobile) | Score | Required |", "|---|---|---|", ...rows].join(
      "\n",
    ) + link
  );
}

function coverageSection(input: QualityInput) {
  if (!input.coverage) return "**Coverage:** no report; the `ci` job failed before the tests ran.";
  const coverage = input.coverage;
  const rows = COVERAGE_METRICS.map((metric) => {
    const pct = coverage[metric];
    const floor = input.coverageFloors[metric];
    const label = metric[0].toUpperCase() + metric.slice(1);
    return `| ${label} | ${pct.toFixed(2)}% ${pct >= floor ? "✅" : "❌"} | ${floor}% |`;
  });
  return ["| Coverage | This PR | Floor |", "|---|---|---|", ...rows].join("\n");
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
    `${jobLine("ci", input.jobs.ci)} · ${jobLine("lighthouse", input.jobs.lighthouse)}`,
    lighthouseSection(input),
    coverageSection(input),
    duplicationSection(input),
  ].join("\n\n");
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

function main(reportsDir: string) {
  const root = join(fileURLToPath(import.meta.url), "../..");
  const manifest = readJson<{ isRepresentativeRun: boolean; summary: Record<string, number> }[]>(
    join(reportsDir, "lighthouse/manifest.json"),
  );
  const coverage = readJson<{ total: Record<CoverageMetric, { pct: number }> }>(
    join(reportsDir, "quality/coverage/coverage-summary.json"),
  );
  const jscpd = readJson<{ statistics: { total: { percentage: number; clones: number } } }>(
    join(reportsDir, "quality/jscpd-report/jscpd-report.json"),
  );
  const lighthouserc = readJson<{ ci: { assert: { assertions: Record<string, Assertion> } } }>(
    join(root, "lighthouserc.json"),
  );
  const jscpdConfig = readJson<{ threshold: number }>(join(root, ".jscpd.json"));

  const env = process.env;
  process.stdout.write(
    formatQualityReport({
      sha: env.SHA ?? "",
      jobs: { ci: env.CI_RESULT ?? "unknown", lighthouse: env.LIGHTHOUSE_RESULT ?? "unknown" },
      lighthouse: manifest?.find((run) => run.isRepresentativeRun)?.summary ?? null,
      lighthouseAssertions: lighthouserc?.ci.assert.assertions ?? {},
      lighthouseReportUrl: env.LIGHTHOUSE_REPORT_URL || null,
      coverage: coverage
        ? (Object.fromEntries(
            COVERAGE_METRICS.map((metric) => [metric, coverage.total[metric].pct]),
          ) as Record<CoverageMetric, number>)
        : null,
      coverageFloors: COVERAGE_FLOORS,
      duplication: jscpd?.statistics.total ?? null,
      duplicationLimit: jscpdConfig?.threshold ?? 0,
    }) + "\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ?? "reports");
}
