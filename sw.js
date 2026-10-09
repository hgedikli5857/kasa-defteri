// Kasa Defteri service worker — uygulama kabuğunu önbelleğe alır, internetsiz açılmayı sağlar.
// Uygulamayı güncellediğinde VERSION değerini artır (ör. v2), telefonlar yeni sürümü alsın.
const VERSION = "kd-v27";
const SHELL = ["./", "index.html", "styles.css", "app.js", "importer.js", "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "kd-data").map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
  if (url.hostname === "www.gstatic.com" || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// Hatırlatmalar: uygulama kapalıyken (yüklü uygulamada, Chrome) günde birkaç kez kontrol edip bildirim gösterir.
const p2 = n => String(n).padStart(2, "0");
const isoDay = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
async function checkReminders() {
  const c = await caches.open("kd-data"), base = self.registration.scope;
  const r = await c.match(base + "kd-reminders.json"); if (!r) return;
  const { items = [] } = await r.json(), today = isoDay(new Date());
  const sr = await c.match(base + "kd-notified.json"), sent = sr ? await sr.json() : {};
  for (const it of items) {
    if (it.from > today) continue;
    const k = it.key + "@" + today; if (sent[k]) continue; sent[k] = 1;
    const late = it.due < today;
    await self.registration.showNotification(it.title, { body: late ? "Gecikti! " + (it.body || "") : it.body, tag: it.key, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: it.url || "./" } });
  }
  await c.put(base + "kd-notified.json", new Response(JSON.stringify(sent), { headers: { "content-type": "application/json" } }));
}
self.addEventListener("periodicsync", e => { if (e.tag === "kd-reminders") e.waitUntil(checkReminders()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => { for (const w of ws) { if ("focus" in w) { w.navigate(url).catch(() => { }); return w.focus(); } } return clients.openWindow(url); }));
});
