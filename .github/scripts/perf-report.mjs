// Renders the PR perf report: this branch's metrics next to the latest main build's.
// A report, not a gate: the budgets fail CI on their own; this shows the drift under them.
//
// Usage: node .github/scripts/perf-report.mjs <current dir> [baseline dir] [baseline sha]

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MARKER = "<!-- perf-report -->";

// Chunks that moved less than this are noise in a review.
const CHUNK_MIN_DELTA = 1_000;

function readMetrics(dir) {
  const merged = { metrics: {}, chunks: {} };
  if (!dir || !existsSync(dir)) return null;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    Object.assign(merged.metrics, data.metrics);
    Object.assign(merged.chunks, data.chunks);
  }
  return Object.keys(merged.metrics).length ? merged : null;
}

function format(value, unit) {
  if (value == null) return "–";
  return unit === "bytes" ? `${(value / 1000).toFixed(1)} kB` : String(value);
}

function change(before, after, unit) {
  if (before == null || after == null) return "new";
  const delta = after - before;
  if (delta === 0) return "–";
  const sign = delta > 0 ? "+" : "−";
  const amount = unit === "bytes" ? `${(Math.abs(delta) / 1000).toFixed(1)} kB` : Math.abs(delta);
  const percent = before ? ` (${sign}${((Math.abs(delta) / before) * 100).toFixed(1)}%)` : "";
  const flag = delta > 0 && (unit !== "bytes" || delta / before > 0.02) ? " 🔺" : "";
  return `${sign}${amount}${percent}${flag}`;
}

function renderReport(current, baseline, baselineSha) {
  const lines = [MARKER, "### Perf report", ""];
  lines.push(
    baseline
      ? `Compared with \`main\` at ${baselineSha ? `\`${baselineSha.slice(0, 7)}\`` : "its latest build"}. Budgets fail CI on their own; this table shows the drift below them.`
      : "No `main` baseline yet, so this shows absolute values only.",
    "",
    "| Metric | main | This PR | Change | Budget |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const [key, metric] of Object.entries(current.metrics)) {
    const before = baseline?.metrics[key]?.value;
    const status = metric.value > metric.budget ? " ❌" : "";
    lines.push(
      `| ${metric.label} | ${format(before, metric.unit)} | ${format(metric.value, metric.unit)}${status} | ${baseline ? change(before, metric.value, metric.unit) : "–"} | ${format(metric.budget, metric.unit)} |`,
    );
  }

  if (baseline) {
    const names = new Set([...Object.keys(current.chunks), ...Object.keys(baseline.chunks)]);
    const moved = [...names]
      .map((name) => ({ name, before: baseline.chunks[name], after: current.chunks[name] }))
      .filter(({ before = 0, after = 0 }) => Math.abs(after - before) >= CHUNK_MIN_DELTA)
      .sort(
        (a, b) =>
          Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0)),
      );
    lines.push("");
    if (!moved.length) {
      lines.push(`No JS chunk changed by ${CHUNK_MIN_DELTA / 1000} kB or more (gzip).`);
    } else {
      lines.push(
        "<details><summary>JS chunks that changed (gzip)</summary>",
        "",
        "| Chunk | main | This PR | Change |",
        "| --- | ---: | ---: | ---: |",
        ...moved.map(
          ({ name, before, after }) =>
            `| \`${name}\` | ${format(before, "bytes")} | ${format(after, "bytes")} | ${after == null ? "removed" : change(before, after, "bytes")} |`,
        ),
        "",
        "</details>",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const [currentDir, baselineDir, baselineSha] = process.argv.slice(2);
const current = readMetrics(currentDir);
if (!current) throw new Error(`No metrics in ${currentDir}`);
process.stdout.write(renderReport(current, readMetrics(baselineDir), baselineSha));
