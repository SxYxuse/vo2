import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { serverEnv } from "#/configs/env.ts";
import * as schema from "./schema.ts";

const pool = new Pool({
  connectionString: serverEnv.databaseUrl(),
});

export const db = drizzle(pool, { schema });
