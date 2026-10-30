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

type BunTimeoutRequest = Request & {
  runtime?: {
    bun?: {
      server?: {
        timeout?: (request: Request, seconds: number) => void;
      };
    };
  };
};

function extendBunIdleTimeout(request: Request, seconds: number) {
  (request as BunTimeoutRequest).runtime?.bun?.server?.timeout?.(request, seconds);
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  );
}

const requestLogger = createMiddleware().server(async ({ next, request, pathname }) => {
  const { runWithLogContext } = await import("@/lib/log-context.server.ts");
  const { errorFields, logger } = await import("@/lib/logger.server.ts");
  const { withoutWebhookSecret } = await import("@/services/strava-webhook.ts");
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const path = withoutWebhookSecret(pathname);

  return runWithLogContext({ requestId, method: request.method, path }, async () => {
    if (isNoisyPath(pathname)) return next();

    if (pathname.startsWith("/_serverFn")) {
      // Bun.serve defaults to a 10s idleTimeout, which kills long Strava copies.
      extendBunIdleTimeout(request, 120);
    }

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
      if (isAbortError(error)) {
        logger.warn("request.aborted", {
          ...errorFields(error),
          durationMs: Date.now() - started,
        });
        throw error;
      }
      logger.error("request.failed", {
        ...errorFields(error),
        durationMs: Date.now() - started,
      });
      throw error;
    }
  });
});

/**
 * Gzips rendered pages, which carry the athlete's data and run to 100 KB. Nitro compresses only
 * the build files. Server functions stay as they are: a sync streams its progress through them.
 */
const compressPages = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const response = result instanceof Response ? result : result.response;
  if (
    !response.body ||
    response.headers.has("content-encoding") ||
    !(response.headers.get("content-type") ?? "").startsWith("text/html") ||
    !(request.headers.get("accept-encoding") ?? "").includes("gzip")
  ) {
    return result;
  }
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  const compressed = new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return result instanceof Response ? compressed : { ...result, response: compressed };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, compressPages, requestLogger],
}));
