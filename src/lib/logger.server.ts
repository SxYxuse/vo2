import winston from "winston";
import LokiTransport from "winston-loki";

import { env } from "@/configs/env.ts";
import { tryGetLogContext } from "@/lib/log-context.server.ts";

const appLabel = "vo";
const appEnv = env.APP_ENV;
const lokiHost = env.LOKI_HOST;
const isDev = appEnv === "development";

/**
 * Add context to the log message
 */
const addContext = winston.format((info) => {
  const c = tryGetLogContext();

  return {
    ...info,
    requestId: c?.requestId,
    method: c?.method,
    path: c?.path,
    userId: c?.userId,
    labels: {
      requestId: c?.requestId,
      method: c?.method,
      path: c?.path,
      userId: c?.userId,
      ...(info.labels && typeof info.labels === "object" ? info.labels : {}),
    },
  };
});

/**
 * Remove labels from the log message for console output
 */
const removeLabels = winston.format((info) => {
  delete info.labels;
  return info;
});

export const logger = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.json(),
    addContext(),
  ),
  transports: [
    ...(isDev || !lokiHost
      ? [
          new winston.transports.Console({
            level: isDev ? "debug" : "info",
            format: winston.format.combine(
              winston.format.colorize(),
              removeLabels(),
              winston.format.simple(),
            ),
          }),
        ]
      : []),
    ...(lokiHost && appEnv !== "test"
      ? [
          new LokiTransport({
            host: lokiHost,
            json: true,
            replaceTimestamp: true,
            onConnectionError(error) {
              console.error("loki.connection_error", error);
            },
            labels: {
              app: appLabel,
              environment: appEnv,
            },
          }),
        ]
      : []),
  ],
});

logger.info("server.start", {
  environment: appEnv,
  loki: Boolean(lokiHost),
});

export function errorFields(error: unknown) {
  if (error instanceof Error) {
    return { err: error.message, name: error.name, stack: error.stack };
  }
  return { err: String(error) };
}
