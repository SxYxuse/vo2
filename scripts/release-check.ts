import { readFile } from "node:fs/promises";

export function isVersionOnlyBump(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  if (before.version === after.version) return false;
  const withoutVersion = (pkg: Record<string, unknown>) => {
    const { version: _version, ...others } = pkg;
    return JSON.stringify(others);
  };
  return withoutVersion(before) === withoutVersion(after);
}

// CLI: `bun scripts/release-check.ts <before.json> <after.json>` exits 1 unless
// the only change is the version.
if (import.meta.main) {
  const [beforePath, afterPath] = process.argv.slice(2);
  const before = JSON.parse(await readFile(beforePath, "utf8"));
  const after = JSON.parse(await readFile(afterPath, "utf8"));
  if (!isVersionOnlyBump(before, after)) {
    console.error("release: package.json changed beyond the version field");
    process.exit(1);
  }
}
