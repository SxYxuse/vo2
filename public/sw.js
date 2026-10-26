// Opens the installed app with no signal (ADR 0031): pages are network first and fall back to
// the copy saved on the last load, and the hashed build files are kept once fetched. Athlete data
// itself lives in the query cache saved to IndexedDB, not here.
//
// Bump VERSION when these caching rules change; activating a new version drops the old caches.
const VERSION = 1;
const PAGES = `vo2-pages-v${VERSION}`;
const ASSETS = `vo2-assets-v${VERSION}`;

// Past this, a slow connection (a train between stations) opens the saved page instead.
const NETWORK_TIMEOUT_MS = 4000;
// Build file names change on every deploy; keep the newest few deploys' worth.
const MAX_ASSETS = 400;
// Pages to open instead when the one asked for was never saved. "/" is the start URL.
const FALLBACK_PAGES = ["/", "/week"];

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("vo2-") && key !== PAGES && key !== ASSETS) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Sign-in callbacks and server functions must always reach the server.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn/")) return;
  if (request.mode === "navigate") event.respondWith(page(event, url));
  else if (url.pathname.startsWith("/assets/")) event.respondWith(asset(event));
});

/** A page the server rendered for the signed-in athlete, worth opening again offline. */
function savable(response) {
  return (
    response.ok &&
    !response.redirected &&
    (response.headers.get("content-type") ?? "").includes("text/html")
  );
}

async function page(event, url) {
  const cache = await caches.open(PAGES);
  const key = url.origin + url.pathname + url.search;
  const network = fetch(event.request).then((response) => {
    if (savable(response)) event.waitUntil(cache.put(key, response.clone()));
    return response;
  });
  const quick = await Promise.race([
    network.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS)),
  ]);
  if (quick) return quick;

  const saved = await cache.match(key);
  if (saved) return saved;
  const late = await network.catch(() => null);
  if (late) return late;
  for (const path of FALLBACK_PAGES) {
    if (path !== url.pathname && (await cache.match(url.origin + path))) {
      return Response.redirect(path, 302);
    }
  }
  return offlinePage();
}

async function asset(event) {
  const cache = await caches.open(ASSETS);
  const saved = await cache.match(event.request);
  if (saved) return saved;
  const response = await fetch(event.request);
  if (response.ok) {
    event.waitUntil(cache.put(event.request, response.clone()).then(() => trim(cache)));
  }
  return response;
}

/** Drops the oldest build files; the cache lists them in the order they were saved. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

/** Never opened with a connection on this device, so there is nothing saved to show. */
function offlinePage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#171717">
<title>VO2</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
    box-sizing: border-box; background: #171717; color: #fafafa; text-align: center;
    font: 15px/1.5 system-ui, -apple-system, sans-serif; }
  p { color: #a3a3a3; max-width: 22rem; margin: 8px auto 24px; }
  button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 8px;
    background: #fafafa; color: #171717; font: inherit; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1 style="font-size: 20px; margin: 0">You're offline</h1>
  <p>Open VO2 once with a connection and your week will be here next time you're offline.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
