// Kasa Defteri service worker — uygulama kabuğunu önbelleğe alır, internetsiz açılmayı sağlar.
// Uygulamayı güncellediğinde VERSION değerini artır (ör. v2), telefonlar yeni sürümü alsın.
const VERSION = "kd-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Firebase/Google API trafiğine dokunma (kimlik doğrulama, Firestore, Drive)
  if (/googleapis\.com$|firebaseapp\.com$|firebaseio\.com$|accounts\.google\.com$/.test(url.hostname) && url.hostname !== "fonts.googleapis.com") return;
  // Kendi dosyalarımız: önce ağ, olmazsa önbellek (güncellemeler hemen gelir, internetsiz de açılır)
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
    return;
  }
  // Firebase SDK ve yazı tipleri: önbellekten ver, arka planda tazele
  if (url.hostname === "www.gstatic.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
