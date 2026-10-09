// Kasa Defteri — günlük hatırlatma gönderici (GitHub Actions'ta çalışır).
// Her kullanıcının meta belgesindeki (users/{uid}) yaklaşan ödemeleri (push.items) okur,
// bildirim günü gelenleri kayıtlı cihazlara (fcm) Firebase Cloud Messaging ile gönderir.
// Gerekli gizli anahtar: FIREBASE_SERVICE_ACCOUNT (Firebase → Proje ayarları → Hizmet hesapları → Yeni özel anahtar, JSON'un tamamı)
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (!sa.project_id) { console.error("FIREBASE_SERVICE_ACCOUNT gizli anahtarı eksik."); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore(), fcm = admin.messaging();

const trDay = (ms = Date.now()) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10); // Türkiye saati (UTC+3)
const today = trDay(), weekAgo = trDay(Date.now() - 7 * 864e5), keepFrom = trDay(Date.now() - 4 * 864e5);
const slot = process.env.SLOT || "sabah"; // aynı gün iki kez çalışırsa (sabah/akşam) akşam yalnızca bugün/gecikmiş olanlar

let users = 0, sent = 0, failed = 0;
for (const doc of (await db.collection("users").get()).docs) {
  const m = doc.data(), toks = Object.entries(m.fcm || {});
  if (!toks.length) continue; users++;
  const done = { ...(m.pushSent || {}) };
  const items = ((m.push && m.push.items) || []).filter(r => r.f <= today && r.d >= weekAgo && !done[`${r.k}@${today}@${slot}`] && (slot === "sabah" || r.d <= today));
  const bad = new Set();
  for (const r of items) {
    const late = r.d < today, title = r.t, body = (late ? "Gecikti! " : r.d === today ? "Bugün son gün. " : "") + (r.b || "");
    for (const [dev, token] of toks) {
      if (bad.has(dev)) continue;
      try {
        await fcm.send({ token, data: { title, body, url: r.u || "./", tag: r.k }, webpush: { headers: { Urgency: "high", TTL: "43200" } } });
        sent++;
      } catch (e) {
        failed++; const c = e.errorInfo?.code || e.code || "";
        console.warn(doc.id.slice(0, 6), dev, c);
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(c)) bad.add(dev);
      }
    }
    done[`${r.k}@${today}@${slot}`] = 1;
  }
  const keep = Object.fromEntries(Object.entries(done).filter(([k]) => (k.split("@")[1] || "") >= keepFrom));
  const upd = { pushSent: keep, pushRun: new Date().toISOString() };
  if (bad.size) upd.fcm = Object.fromEntries(toks.filter(([d]) => !bad.has(d)));
  if (items.length || bad.size) await doc.ref.set(upd, { merge: true });
}
console.log(`kullanıcı ${users} · gönderilen ${sent} · hatalı ${failed}`);
process.exit(0);
