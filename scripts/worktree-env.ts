import { createHash } from "node:crypto";

// Pure helpers for worktree-setup.ts and worktree-prune.ts, kept apart so they test without Docker.

export const SHARED_DATABASE = "vo2";
export const DATABASE_PREFIX = "vo2_wt_";
export const PORT_RANGE = { first: 3100, last: 3999 } as const;
/**
 * The main checkout's dev-server port (`.env.example`). Not 3000, which Dokploy and most other
 * Node projects on the same machine want. Outside PORT_RANGE, as are its e2e ports at +1000 and
 * +2000 (e2e/env.ts), so they never meet a worktree's.
 */
export const DEFAULT_DEV_PORT = 3090;
/** Not 5432, which other projects' Postgres on the same machine also wants. */
export const DEFAULT_PG_PORT = 55432;
/** Before #208 every checkout's DATABASE_URL named this port. */
const LEGACY_PG_PORT = "5432";

/** Postgres truncates identifiers past 63 bytes, which would make two worktrees collide. */
const MAX_IDENTIFIER = 63;
const HASH_LENGTH = 6;

export function pathHash(worktreePath: string) {
  return createHash("sha256").update(worktreePath).digest("hex").slice(0, HASH_LENGTH);
}

/** `fix/app-slowness` at some path becomes `vo2_wt_fix_app_slowness_a1b2c3`. */
export function worktreeDatabaseName(branch: string, worktreePath: string) {
  const room = MAX_IDENTIFIER - DATABASE_PREFIX.length - 1 - HASH_LENGTH;
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, room)
    .replace(/^_|_$/g, "");
  return `${DATABASE_PREFIX}${slug || "head"}_${pathHash(worktreePath)}`;
}

/** Only identifiers that pass this are ever interpolated into SQL. */
export function assertSafeIdentifier(name: string) {
  if (!/^[a-z0-9_]+$/.test(name) || name.length > MAX_IDENTIFIER) {
    throw new Error(`Refusing unsafe database name ${JSON.stringify(name)}`);
  }
  return name;
}

/** The host port vo2-postgres publishes. Like Docker Compose, the shell wins over `.env`. */
export function pgPort(envText = "") {
  const raw = process.env.VO2_PG_PORT || readEnvValue(envText, "VO2_PG_PORT");
  const port = Number(raw);
  if (!raw) return DEFAULT_PG_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`VO2_PG_PORT=${raw} is not a port number`);
  }
  return port;
}

export function databaseUrl(database: string, port: number) {
  return `postgresql://vo2:vo2@localhost:${port}/${database}`;
}

/** Moves a local DATABASE_URL still on 5432 to `port`; any other URL is left alone. */
export function migrateLegacyPgPort(envText: string, port: number) {
  const value = readEnvValue(envText, "DATABASE_URL");
  if (!value) return envText;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local || (url.port || LEGACY_PG_PORT) !== LEGACY_PG_PORT || port === 5432) return envText;
    url.port = String(port);
    return setEnvValues(envText, { DATABASE_URL: url.toString() });
  } catch {
    return envText;
  }
}

export function databaseFromUrl(url: string | undefined) {
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || undefined;
  } catch {
    return undefined;
  }
}

/** Before the vo2 rename the server's user and database were `vo`; that role no longer exists. */
export function usesRenamedVoDatabase(envText: string) {
  const url = readEnvValue(envText, "DATABASE_URL");
  if (!url) return false;
  try {
    const { username } = new URL(url);
    return username === "vo" || databaseFromUrl(url) === "vo";
  } catch {
    return false;
  }
}

export function readEnvValue(text: string, key: string) {
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === key) return match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

/** Rewrites `key=value` lines in place, appending missing keys, and keeps everything else. */
export function setEnvValues(text: string, values: Record<string, string>) {
  const pending = new Map(Object.entries(values));
  const lines = text.split("\n").map((line) => {
    const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (key === undefined || !pending.has(key)) return line;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

export type EnvPlan =
  /** No `.env` yet, or it already uses this worktree's database: write the three keys. */
  | { kind: "write" }
  /** `.env` uses another database, such as the shared `vo2`: leave it unless `--isolate`. */
  | { kind: "keep"; database: string | undefined };

export function planEnv(existing: string | undefined, database: string, isolate: boolean): EnvPlan {
  if (existing === undefined || isolate) return { kind: "write" };
  const current = databaseFromUrl(readEnvValue(existing, "DATABASE_URL"));
  return current === database ? { kind: "write" } : { kind: "keep", database: current };
}

export function inPortRange(port: number) {
  return Number.isInteger(port) && port >= PORT_RANGE.first && port <= PORT_RANGE.last;
}

/** Keeps a port this worktree already owns, so a second run does not move the dev server. */
export async function pickPort(
  current: number | undefined,
  taken: ReadonlySet<number>,
  isListening: (port: number) => Promise<boolean>,
) {
  if (current !== undefined && inPortRange(current) && !taken.has(current)) return current;
  for (let port = PORT_RANGE.first; port <= PORT_RANGE.last; port += 1) {
    if (!taken.has(port) && !(await isListening(port))) return port;
  }
  throw new Error(`No free port in ${PORT_RANGE.first}-${PORT_RANGE.last}`);
}
