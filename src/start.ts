import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

function isNoisyPath(pathname: string) {
  if (
    pathname.startsWith("/@") ||
    pathname.startsWith("/node_modules") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/.well-known/")
  ) {
    return true;
  }
  const last = pathname.split("/").pop() ?? "";
  return last.includes(".") && !pathname.startsWith("/api/");
}

const requestLogger = createMiddleware().server(async ({ next, request, pathname }) => {
  const { runWithLogContext } = await import("#/lib/log-context.server.ts");
  const { errorFields, logger } = await import("#/lib/logger.server.ts");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  return runWithLogContext({ requestId, method: request.method, path: pathname }, async () => {
    if (isNoisyPath(pathname)) return next();

    const started = Date.now();
    logger.info("request.start");
    try {
      const result = await next();
      const response = result instanceof Response ? result : result.response;
      logger.info("request.end", {
        status: response.status,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      logger.error("request.failed", {
        ...errorFields(error),
        durationMs: Date.now() - started,
      });
      throw error;
    }
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, requestLogger],
}));
