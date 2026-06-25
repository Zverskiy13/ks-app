/* Сервис-воркер «Клиники Столицы».
   Код приложения (html/js/css) — network-first: всегда свежий при интернете,
   кэш только как офлайн-резерв. Иконки — cache-first. API — сеть. */
const CACHE = "ks-app-v5";
const ASSETS = [
  "./index.html", "./styles.css", "./app.js", "./api.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.includes("/api/")) {                 // данные — из сети
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  if (/\.(?:js|css|webmanifest)$|\/$|index\.html$/.test(url.pathname)) {
    // код/оболочка — network-first (свежее при интернете, кэш в офлайне)
    e.respondWith(
      fetch(e.request).then((r) => {
        const cp = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));  // иконки и пр.
});
