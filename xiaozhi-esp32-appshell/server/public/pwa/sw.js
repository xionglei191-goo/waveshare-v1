/* Family Hub management PWA service worker.
 * Strategy:
 *  - Precache the app shell so the console opens offline.
 *  - Navigations + static PWA assets: network-first, fall back to cache.
 *  - /api/* requests: network-only (never cache; responses may be auth-scoped
 *    or sensitive, and a management console must show fresh data).
 */
const CACHE = "family-hub-shell-v1";
const APP_SHELL = [
  "/companion",
  "/pwa/manifest.webmanifest",
  "/pwa/icons/icon-192.png",
  "/pwa/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  // Never cache API traffic; always hit the network.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // App shell + static assets: network-first with cache fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }
        if (request.mode === "navigate") {
          const shell = await caches.match("/companion");
          if (shell) {
            return shell;
          }
        }
        return new Response("离线且无缓存内容", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      })
  );
});
