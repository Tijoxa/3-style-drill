/* Minimal PWA service worker: makes the app installable + offline-capable.
   Stale-while-revalidate for same-origin GET requests. */
const CACHE = "bld3style-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin requests; let cross-origin (e.g. blddb.net) pass through.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      // For navigations, prefer network then fall back to cached app shell.
      if (req.mode === "navigate") {
        return network.then((r) => r || cached || cache.match("./index.html"));
      }
      return cached || network;
    })()
  );
});
