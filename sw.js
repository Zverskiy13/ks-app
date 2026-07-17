/* Сервис-воркер «Клиники Столицы».
   Код приложения (html/js/css) — network-first: всегда свежий при интернете,
   кэш только как офлайн-резерв. Иконки — cache-first. API — сеть. */
const CACHE = "ks-app-v60";
const ASSETS = [
  "./index.html", "./styles.css", "./app.js", "./api.js", "./offline.js", "./manifest.webmanifest",
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

self.addEventListener("push", (e) => {
  let d = { title: "Клиники Столицы", body: "", url: "/" };
  try { d = Object.assign(d, e.data.json()); } catch (_) { if (e.data) d.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "/" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((cl) => {
    for (const c of cl) { if ("focus" in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
