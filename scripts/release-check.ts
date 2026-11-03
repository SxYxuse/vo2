import { readFile } from "node:fs/promises";

// The release workflow bumps the version and nothing else. This guards the
// commit it is about to push: any other change in package.json means the
// bump picked up work that was never reviewed on its own.

export function isVersionOnlyBump(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  if (before.version === after.version) return false;
  const rest = (pkg: Record<string, unknown>) => {
    const { version: _version, ...others } = pkg;
    return JSON.stringify(others);
  };
  return rest(before) === rest(after);
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
