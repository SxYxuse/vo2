/*
 * Registers public/sw.js, which opens the installed app offline (ADR 0031). Dev skips it: a
 * worker serving saved pages and files would fight Vite's hot reload.
 */

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

/** The saved pages carry the athlete's rendered data; build files are not personal and stay. */
export async function removeSavedPages() {
  if (typeof caches === "undefined") return;
  try {
    for (const key of await caches.keys()) {
      if (key.startsWith("vo2-pages-")) await caches.delete(key);
    }
  } catch {
    // Storage blocked (a private window): nothing was saved.
  }
}
