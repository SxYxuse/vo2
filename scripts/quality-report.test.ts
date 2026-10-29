import { describe, expect, it } from "vite-plus/test";

import { formatQualityReport, type QualityInput } from "./quality-report.ts";

const input: QualityInput = {
  sha: "676d70a1234567",
  jobs: { ci: "success", lighthouse: "success" },
  lighthouse: { accessibility: 1, "best-practices": 0.85, seo: 0.9, performance: 0.55 },
  lighthouseAssertions: {
    "categories:accessibility": ["error", { minScore: 0.9 }],
    "categories:best-practices": ["error", { minScore: 0.9 }],
    "categories:seo": ["warn", { minScore: 0.9 }],
    "categories:performance": ["warn", { minScore: 0.8 }],
  },
  lighthouseReportUrl: "https://example.test/artifact",
  coverage: { statements: 54.82, branches: 50.5, functions: 53.79, lines: 56.25 },
  coverageFloors: { statements: 54, branches: 51, functions: 53, lines: 56 },
  duplication: { percentage: 0.7191, clones: 27 },
  duplicationLimit: 1,
};

describe("formatQualityReport", () => {
  it("marks failures, warnings and passes against each limit", () => {
    const report = formatQualityReport(input);
    expect(report).toContain("### Quality report for 676d70a");
    expect(report).toContain("| Accessibility | 100 ✅ | ≥ 90 |");
    expect(report).toContain("| Best practices | 85 ❌ | ≥ 90 |");
    expect(report).toContain("| SEO | 90 ✅ | ≥ 90 (warn) |");
    expect(report).toContain("| Performance | 55 ⚠️ | ≥ 80 (warn) |");
    expect(report).toContain("| Branches | 50.50% ❌ | 51% |");
    expect(report).toContain("| Lines | 56.25% ✅ | 56% |");
    expect(report).toContain("**Duplication:** 0.72% ✅ (limit 1%), 27 clones");
    expect(report).toContain("[Full Lighthouse reports](https://example.test/artifact)");
  });

  it("says which job failed when its report is missing", () => {
    const report = formatQualityReport({
      ...input,
      jobs: { ci: "failure", lighthouse: "failure" },
      lighthouse: null,
      lighthouseReportUrl: null,
      coverage: null,
      duplication: null,
    });
    expect(report).toContain("❌ `ci` failure · ❌ `lighthouse` failure");
    expect(report).toContain("the `lighthouse` job failed before it ran");
    expect(report).toContain("the `ci` job failed before the tests ran");
    expect(report).toContain("the `ci` job failed before jscpd ran");
    expect(report).not.toContain("Full Lighthouse reports");
  });
});
