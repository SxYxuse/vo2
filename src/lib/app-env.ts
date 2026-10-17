import { createServerFn } from "@tanstack/react-start";

export const loadAppEnv = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("@/configs/env.ts");
  return { appEnv: env.APP_ENV };
});
