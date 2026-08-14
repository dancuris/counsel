// Minimal pass-through service worker.
//
// Its only job is to make the app installable (browsers require a fetch
// handler). It deliberately does NOT cache: every page here is behind auth and
// renders live data from the database, so a cache would risk serving one
// person's stale pipeline, or an authenticated page after logout.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
