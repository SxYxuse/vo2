import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/configs/env.ts";
import { errorFields, logger } from "@/lib/logger.server.ts";
import * as schema from "./schema.ts";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

pool.on("error", (error) => {
  logger.error("db.pool", errorFields(error));
});

export const db = drizzle(pool, { schema });
