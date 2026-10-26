import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  process.env.STRAVA_MOCK = "1";
  process.env.APP_ENV = "development";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.DATABASE_URL ??= "postgresql://vo2:vo2@localhost:5432/vo2";
  process.env.BETTER_AUTH_SECRET ??= "test-secret";
});

import { MOCK_STRAVA_PATH, MOCK_UNHANDLED_HEADER, handleMockStravaRequest } from "./mock-server.ts";

/*
 * Every Strava path the app calls must be implemented by the mock, or agents and local runs hit
 * a dead end the first time the new code runs (AGENTS.md, "Mock Strava"). The paths are read
 * from the source, so a new call is covered without editing a list.
 */

const SRC = join(import.meta.dirname, "../..");
const MOCK_URL = `http://localhost:3000${MOCK_STRAVA_PATH}`;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    const code = /\.tsx?$/.test(name) && !/\.(test|types|gen)\.tsx?$/.test(name);
    return code && !name.startsWith("mock-") ? [path] : [];
  });
}

/** `${env.STRAVA_BASE_URL}/oauth/token` and `this.request("/athlete/zones")` (under /api/v3). */
const CALL_PATTERNS = [
  { pattern: /STRAVA_BASE_URL\}(\/[^`?"']*)/g, prefix: "" },
  { pattern: /this\.request(?:<[^>(]*>)?\(\s*[`"'](\/[^`?"']*)/g, prefix: "/api/v3" },
];

function stravaCalls() {
  const calls = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const { pattern, prefix } of CALL_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        // The client's own request helper, whose callers are matched by the second pattern.
        if (match[1].endsWith("${path}")) continue;
        calls.set(prefix + match[1], relative(SRC, file));
      }
    }
  }
  return calls;
}

async function freshToken() {
  const response = await handleMockStravaRequest(
    new Request(`${MOCK_URL}/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code: "mock" }),
    }),
  );
  return ((await response.json()) as { access_token: string }).access_token;
}

async function anActivityId() {
  const response = await handleMockStravaRequest(
    new Request(`${MOCK_URL}/api/v3/athlete/activities?per_page=1`, {
      headers: { Authorization: `Bearer ${await freshToken()}` },
    }),
  );
  return String(((await response.json()) as { id: number }[])[0]?.id);
}

/** Handled by the mock for either method; deauthorizing revokes tokens, so each try signs in. */
async function handled(path: string) {
  for (const method of ["GET", "POST"]) {
    const response = await handleMockStravaRequest(
      new Request(`${MOCK_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${await freshToken()}` },
        body: method === "POST" ? new URLSearchParams() : undefined,
      }),
    );
    if (!response.headers.has(MOCK_UNHANDLED_HEADER)) return true;
  }
  return false;
}

describe("mock Strava covers every call", () => {
  const calls = stravaCalls();

  it("finds the app's Strava calls", () => {
    expect([...calls.keys()]).toEqual(
      expect.arrayContaining(["/oauth/token", "/api/v3/athlete", "/api/v3/athlete/activities"]),
    );
  });

  it.each([...calls])("%s (called from %s) is implemented", async (path) => {
    const id = await anActivityId();
    expect(await handled(path.replaceAll(/\$\{[^}]*\}/g, id))).toBe(true);
  });
});
