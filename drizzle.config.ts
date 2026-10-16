import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { parseEnv } from "./src/configs/env-schema.ts";

config({ path: [".env"] });

const env = parseEnv();

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
