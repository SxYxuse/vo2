import { parseEnv } from "./env-schema.ts";

export { env$, parseEnv, type Env } from "./env-schema.ts";

export const env = parseEnv();
