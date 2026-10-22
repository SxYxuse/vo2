// Measures the client bundle after `vp build`, fails when a budget is exceeded, and writes
// the sizes to `<metrics dir>/bundle.json` for the PR perf report.
//
// Usage: node .github/scripts/bundle-size.mjs [metrics dir]

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const ASSETS = ".output/public/assets";

// Gzipped bytes, about 10% above the sizes when the budget was set. Raise one on purpose, in
// the PR that needs it, and say why.
const BUDGETS = {
  initialJs: 400_000,
  totalJs: 1_050_000,
  css: 55_000,
};

const metricsDir = process.argv[2];
const files = readdirSync(ASSETS);
const gzipped = new Map(
  files
    .filter((file) => file.endsWith(".js") || file.endsWith(".css"))
    .map((file) => [file, gzipSync(readFileSync(join(ASSETS, file))).length]),
);

// The JS a cold start downloads before the first route renders: the entry and everything it
// imports statically. Dynamic `import()` chunks load per route and are left out.
const entries = files.filter((file) => /^index-[\w-]+\.js$/.test(file));
if (entries.length !== 1) throw new Error(`Expected one client entry, found ${entries.join(", ")}`);
const initial = new Set();
const queue = [...entries];
while (queue.length) {
  const file = queue.pop();
  if (initial.has(file)) continue;
  initial.add(file);
  const source = readFileSync(join(ASSETS, file), "utf8");
  for (const [, imported] of source.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) {
    queue.push(imported);
  }
}

const sum = (names) => names.reduce((total, name) => total + (gzipped.get(name) ?? 0), 0);
const js = [...gzipped.keys()].filter((file) => file.endsWith(".js"));
const css = [...gzipped.keys()].filter((file) => file.endsWith(".css"));

const metrics = {
  "bundle.initialJs": {
    label: "Initial JS (gzip)",
    unit: "bytes",
    value: sum([...initial]),
    budget: BUDGETS.initialJs,
  },
  "bundle.totalJs": {
    label: "All JS (gzip)",
    unit: "bytes",
    value: sum(js),
    budget: BUDGETS.totalJs,
  },
  "bundle.css": { label: "CSS (gzip)", unit: "bytes", value: sum(css), budget: BUDGETS.css },
};

// Chunk names without the content hash, so the report can compare them across builds.
const chunks = {};
for (const file of js) {
  const name = file.replace(/-[\w-]{8}\.js$/, ".js");
  chunks[name] = (chunks[name] ?? 0) + gzipped.get(file);
}

let failed = false;
for (const metric of Object.values(metrics)) {
  const over = metric.value > metric.budget;
  failed ||= over;
  console.log(
    `${over ? "✗" : "✓"} ${metric.label}: ${(metric.value / 1000).toFixed(1)} kB (budget ${(metric.budget / 1000).toFixed(1)} kB)`,
  );
}

if (metricsDir) {
  mkdirSync(metricsDir, { recursive: true });
  writeFileSync(join(metricsDir, "bundle.json"), JSON.stringify({ metrics, chunks }, null, 2));
}
if (failed) process.exit(1);
