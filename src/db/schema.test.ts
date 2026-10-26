import { describe, expect, it } from "vite-plus/test";
import { getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "./schema.ts";

/** Tables that are not per athlete: the athlete itself, and Better Auth's sign-in challenges. */
const NOT_PER_ATHLETE = new Set(["user", "verification"]);

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
);

function foreignKeys(table: PgTable) {
  return getTableConfig(table).foreignKeys.map((key) => {
    const reference = key.reference();
    return { onDelete: key.onDelete, target: getTableName(reference.foreignTable) };
  });
}

/** True when deleting a `user` row reaches `table` through cascading foreign keys. */
function cascadesFromUser(name: string, seen = new Set<string>()): boolean {
  if (name === "user") return true;
  if (seen.has(name)) return false;
  seen.add(name);
  const table = tables.find((candidate) => getTableName(candidate) === name);
  if (!table) return false;
  return foreignKeys(table).some(
    (key) => key.onDelete === "cascade" && cascadesFromUser(key.target, seen),
  );
}

describe("athlete deletion reaches every table", () => {
  it("finds the schema's tables", () => {
    expect(tables.length).toBeGreaterThan(5);
  });

  it.each(tables.map((table) => getTableName(table)).filter((name) => !NOT_PER_ATHLETE.has(name)))(
    "%s is deleted with the athlete",
    (name) => {
      expect(cascadesFromUser(name)).toBe(true);
    },
  );

  it.each(tables.map((table) => [getTableName(table), table] as const))(
    "every foreign key on %s cascades",
    (_name, table) => {
      for (const key of foreignKeys(table)) expect(key.onDelete).toBe("cascade");
    },
  );
});
