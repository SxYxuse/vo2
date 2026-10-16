import { parseEnv } from "./env-schema.ts";

export { envSchema, parseEnv, type Env } from "./env-schema.ts";

export const env = parseEnv();
