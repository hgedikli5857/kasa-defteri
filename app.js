// Kasa Defteri — PWA sürümü
// Veri: Firebase Firestore (anlık senkron + çevrimdışı), giriş: Google (Firebase Auth), yedek: Google Drive (drive.file)
import { firebaseConfig } from "./firebase-config.js";
import * as IMP from "./importer.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER = "Kasa Defteri Yedek";
const DRIVE_FILE = "kasa-defteri-veri.json";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const p2 = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const pd = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = pd(s), day = d.getDate(); const t = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); t.setDate(Math.min(day, last)); return iso(t); };
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
let TODAY = iso(new Date());
const nf = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const cf = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const money = n => nf.format(n || 0);
const money0 = n => nf0.format(n || 0);
const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + nf.format(Math.abs(n || 0));
const dfmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
const mfmt = new Intl.DateTimeFormat("tr-TR", { month: "short" });
const mfmtL = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });
const tfmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dshort = s => dfmt.format(pd(s));
const parseAmt = v => { let s = String(v || "").replace(/[^\d.,-]/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); const n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const uid8 = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 16);
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, del(k) { try { localStorage.removeItem(k); } catch (e) { } } };

const CATS = {
  gelir: ["Satış", "Hizmet geliri", "Danışmanlık", "Komisyon", "Faiz geliri", "Diğer gelir"],
  gider: ["Kira", "Personel", "Faturalar", "Lojistik", "Pazarlama", "Vergi / SGK", "Yazılım", "Ofis", "Ulaşım", "Market / Gıda", "Banka masrafı", "Diğer gider"]
};
const COLS = ["accounts", "contacts", "txns", "plans"];
const configured = firebaseConfig && firebaseConfig.apiKey && !/^BURAYA/.test(firebaseConfig.apiKey);

/* ---------- sample data (relative to today) ---------- */
function buildSample() {
  const A = [{ id: "a1", name: "Bankomat", group: "Ziraat", kind: "banka", opening: 42500 }, { id: "a4", name: "Yatırım hesabı", group: "Ziraat", kind: "yatırım", opening: 75000 },
    { id: "a2", name: "Ticari vadesiz", group: "Garanti BBVA", kind: "banka", opening: 18200 }, { id: "a5", name: "Bonus Kart", group: "Garanti BBVA", kind: "kredi kartı", opening: -6200 },
    { id: "a3", name: "Nakit Kasa", group: "Nakit", kind: "nakit", opening: 3750 }];
  const C = [{ id: "c1", name: "Ayşe Yılmaz", kind: "müşteri", phone: "0532 000 00 01" }, { id: "c2", name: "Demir Lojistik", kind: "tedarikçi", phone: "" }, { id: "c3", name: "Kaya Gayrimenkul", kind: "tedarikçi", phone: "" }, { id: "c4", name: "Mert Kaplan", kind: "müşteri", phone: "" }, { id: "c5", name: "Elif Danışmanlık", kind: "müşteri", phone: "" }];
  const T = []; let k = 0; const now = pd(TODAY);
  const rnd = i => { const x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); };
  for (let m = 5; m >= 0; m--) {
    const base = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const day = d => iso(new Date(base.getFullYear(), base.getMonth(), d));
    const push = o => { if (o.date <= TODAY) T.push({ id: "t" + (++k), ...o }); };
    push({ type: "gelir", amount: Math.round(26000 + rnd(m) * 14000), date: day(8), category: "Satış", accountId: "a1", contactId: "c1", note: "Aylık satış tahsilatı" });
    push({ type: "gelir", amount: Math.round(9000 + rnd(m + 3) * 6000), date: day(17), category: "Danışmanlık", accountId: "a2", contactId: "c5", note: "" });
    push({ type: "gelir", amount: Math.round(4000 + rnd(m + 7) * 5000), date: day(24), category: "Hizmet geliri", accountId: "a3", contactId: "c4", note: "" });
    push({ type: "gider", amount: 15000, date: day(5), category: "Kira", accountId: "a1", contactId: "c3", note: "Ofis kirası" });
    push({ type: "gider", amount: 18000, date: day(28), category: "Personel", accountId: "a1", contactId: "", note: "Maaş ödemesi" });
    push({ type: "gider", amount: Math.round(3200 + rnd(m + 11) * 2200), date: day(12), category: "Lojistik", accountId: "a2", contactId: "c2", note: "" });
    push({ type: "gider", amount: Math.round(1600 + rnd(m + 13) * 900), date: day(15), category: "Faturalar", accountId: "a2", contactId: "", note: "Elektrik, internet" });
    push({ type: "gider", amount: Math.round(1500 + rnd(m + 17) * 2500), date: day(20), category: "Pazarlama", accountId: "a3", contactId: "", note: "Sosyal medya reklamı" });
  }
  T.push({ id: "t" + (++k), type: "transfer", amount: 5000, date: addDays(TODAY, -6), category: "Transfer", accountId: "a1", toAccountId: "a3", contactId: "", note: "Kasaya nakit" });
  const P = [
    { id: "p1", dir: "tahsilat", amount: 3400, due: addDays(TODAY, -4), contactId: "c1", category: "Satış", note: "Fatura #2041", repeat: "yok", status: "bekliyor" },
    { id: "p2", dir: "ödeme", amount: 1850, due: addDays(TODAY, 3), contactId: "", category: "Faturalar", note: "Elektrik", repeat: "aylık", status: "bekliyor" },
    { id: "p3", dir: "tahsilat", amount: 12500, due: addDays(TODAY, 5), contactId: "c1", category: "Satış", note: "Fatura #2057", repeat: "yok", status: "bekliyor" },
    { id: "p4", dir: "ödeme", amount: 4200, due: addDays(TODAY, 9), contactId: "c2", category: "Lojistik", note: "Kargo faturası", repeat: "yok", status: "bekliyor" },
    { id: "p5", dir: "tahsilat", amount: 8750, due: addDays(TODAY, 12), contactId: "c4", category: "Hizmet geliri", note: "", repeat: "yok", status: "bekliyor" },
    { id: "p6", dir: "ödeme", amount: 15000, due: addMonths(iso(new Date(now.getFullYear(), now.getMonth(), 5)), 1), contactId: "c3", category: "Kira", note: "Ofis kirası", repeat: "aylık", status: "bekliyor" },
    { id: "p7", dir: "ödeme", amount: 6800, due: addDays(TODAY, 20), contactId: "", category: "Vergi / SGK", note: "KDV + SGK", repeat: "yok", status: "bekliyor" },
    { id: "p8", dir: "ödeme", amount: 18000, due: addDays(TODAY, 26), contactId: "", category: "Personel", note: "Maaş", repeat: "aylık", status: "bekliyor" },
    { id: "p9", dir: "tahsilat", amount: 22000, due: addDays(TODAY, 28), contactId: "c5", category: "Danışmanlık", note: "Proje 2. hakediş", repeat: "yok", status: "bekliyor" }
  ];
  return { accounts: A, contacts: C, txns: T, plans: P };
}

/* ---------- state ---------- */
const emptyState = () => ({ accounts: [], contacts: [], txns: [], plans: [] });
let S = emptyState();
let mode = "loading"; // loading | demo | signedout | live | empty
let fb = null, db = null, auth = null, user = null, meta = {};
const unsubs = [];
const ui = { tab: new URLSearchParams(location.search).get("tab") || ls.get("kd-tab") || "ozet", q: "", ftype: "", facc: "", planView: "bekliyor", period: "bu-ay" };

const acc = id => S.accounts.find(a => a.id === id);
const con = id => S.contacts.find(c => c.id === id);
function balanceOf(a) {
  let b = +a.opening || 0;
  for (const t of S.txns) {
    if (t.type === "gelir" && t.accountId === a.id) b += t.amount;
    else if (t.type === "gider" && t.accountId === a.id) b -= t.amount;
    else if (t.type === "transfer") { if (t.accountId === a.id) b -= t.amount; if (t.toAccountId === a.id) b += t.amount; }
  }
  return b;
}
const totalCash = () => sum(S.accounts, balanceOf);
const accName = a => { const g = groupOf(a); return a.name.toLocaleUpperCase("tr").includes(g.toLocaleUpperCase("tr")) || g === "Nakit" || g === "Diğer hesaplar" ? a.name : `${g} ${a.name}`; };
/* --- hesap grupları (banka bazında) --- */
const KINDS = [["banka", "Vadesiz / bankomat"], ["vadeli", "Vadeli mevduat"], ["yatırım", "Yatırım hesabı"], ["kredi kartı", "Kredi kartı"], ["kredi", "Kredi / KMH"], ["birikim", "Birikim / altın / döviz"], ["nakit", "Nakit kasa"]];
const kindLabel = k => (KINDS.find(x => x[0] === k) || [k, k || "Hesap"])[1];
const KNOWN_BANKS = ["Ziraat", "Halkbank", "VakıfBank", "Vakıfbank", "Garanti BBVA", "Garanti", "İş Bankası", "Türkiye İş Bankası", "Yapı Kredi", "Akbank", "QNB", "Finansbank", "Denizbank", "DenizBank", "Enpara", "TEB", "ING", "HSBC", "Şekerbank", "Fibabanka", "Odeabank", "Kuveyt Türk", "Albaraka", "Türkiye Finans", "Ziraat Katılım", "Vakıf Katılım", "Emlak Katılım", "Papara", "Midas", "ininal", "Param", "Burgan", "Alternatif Bank", "Anadolubank", "ICBC", "Colendi", "Hayat Finans"];
const CANON = { "Garanti": "Garanti BBVA", "Türkiye İş Bankası": "İş Bankası", "Vakıfbank": "VakıfBank", "DenizBank": "Denizbank", "Finansbank": "QNB" };
function inferGroup(name) {
  const n = " " + IMP.up(name || "").replace(/[^\p{L}\p{N}]+/gu, " ") + " ";
  const hit = KNOWN_BANKS.filter(b => n.includes(" " + IMP.up(b) + " ")).sort((x, y) => y.length - x.length)[0];
  return hit ? (CANON[hit] || hit) : "";
}
const groupOf = a => (a.group && a.group.trim()) || inferGroup(a.name) || (a.kind === "nakit" ? "Nakit" : "Diğer hesaplar");
function accountGroups() {
  const m = new Map();
  for (const a of S.accounts) { const g = groupOf(a); if (!m.has(g)) m.set(g, []); m.get(g).push(a); }
  const order = ["banka", "vadeli", "yatırım", "birikim", "kredi kartı", "kredi", "nakit"];
  const out = [...m.entries()].map(([name, list]) => {
    list.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || x.name.localeCompare(y.name, "tr"));
    const bals = list.map(balanceOf);
    return { name, list, total: sum(bals, x => x), assets: sum(bals, x => x > 0 ? x : 0), debts: sum(bals, x => x < 0 ? -x : 0) };
  });
  return out.sort((x, y) => (x.name === "Nakit" || x.name === "Diğer hesaplar") - (y.name === "Nakit" || y.name === "Diğer hesaplar") || y.assets + y.debts - (x.assets + x.debts));
}
const groupNames = () => [...new Set(S.accounts.map(groupOf).concat(KNOWN_BANKS.map(b => CANON[b] || b)))];
const pending = () => S.plans.filter(p => p.status !== "tamam");
const recv = () => sum(pending().filter(p => p.dir === "tahsilat"), p => p.amount);
const pay = () => sum(pending().filter(p => p.dir === "ödeme"), p => p.amount);
function projection(days) {
  const pts = []; let bal = totalCash();
  const pl = pending().slice().sort((a, b) => a.due < b.due ? -1 : 1); let i = 0;
  for (let d = 0; d <= days; d++) {
    const day = addDays(TODAY, d);
    while (i < pl.length && pl[i].due <= day) { bal += pl[i].dir === "tahsilat" ? pl[i].amount : -pl[i].amount; i++; }
    pts.push({ day, bal });
  }
  return pts;
}

/* ---------- storage layer ---------- */
const live = () => mode === "live" || mode === "empty";
const colRef = c => fb.fs.collection(db, "users", user.uid, c);
const docRef = (c, id) => fb.fs.doc(db, "users", user.uid, c, id);
const metaRef = () => fb.fs.doc(db, "users", user.uid);
const clean = o => JSON.parse(JSON.stringify(o));
function saveDemo() { if (mode === "demo") ls.set("kd-demo", JSON.stringify(S)); }

// Firestore yazmaları çevrimdışıyken de anında yerel görünür; sunucu onayı arka planda gelir, o yüzden beklenmez.
function put(col, obj) {
  const { id, ...data } = obj;
  if (live()) {
    fb.fs.setDoc(docRef(col, id), clean(data)).catch(e => toast(failMsg(e)));
    Drive.dirty();
  } else {
    const arr = S[col], i = arr.findIndex(x => x.id === id); if (i >= 0) arr[i] = obj; else arr.push(obj);
    saveDemo(); render();
  }
}
function remove(col, id) {
  if (live()) { fb.fs.deleteDoc(docRef(col, id)).catch(e => toast(failMsg(e))); Drive.dirty(); }
  else { S[col] = S[col].filter(x => x.id !== id); saveDemo(); render(); }
}
async function batchWrite(ops) { // ops: [{type:'set'|'delete', col, id, data}]
  for (let i = 0; i < ops.length; i += 400) {
    const b = fb.fs.writeBatch(db);
    for (const o of ops.slice(i, i + 400)) {
      if (o.type === "set") b.set(o.ref || docRef(o.col, o.id), clean(o.data), o.merge ? { merge: true } : undefined);
      else b.delete(o.ref || docRef(o.col, o.id));
    }
    const p = b.commit();
    if (navigator.onLine) await p; else p.catch(e => toast(failMsg(e)));
  }
}
function failMsg(e) {
  const c = e && e.code;
  if (c === "permission-denied") return "Bu işlem için yetkin yok. Firestore kurallarını kontrol et.";
  if (c === "resource-exhausted") return "Günlük ücretsiz kullanım sınırı doldu. Yarın tekrar dene.";
  if (c === "unavailable") return "Sunucuya ulaşılamıyor. Kayıt internet gelince gönderilecek.";
  return "Kaydedilemedi: " + ((e && e.message) || "bilinmeyen hata");
}
async function safe(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(failMsg(e)); return false; } }

/* ---------- Firebase boot ---------- */
async function loadFirebase() {
  const [app, au, fs] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
  return { app, au, fs };
}
async function boot() {
  if (!configured) {
    mode = "demo";
    try { const d = JSON.parse(ls.get("kd-demo") || "null"); S = d && d.accounts ? d : buildSample(); } catch (e) { S = buildSample(); }
    showApp(); return;
  }
  try { fb = await loadFirebase(); }
  catch (e) { renderLogin("Bağlantı kurulamadı. İnternetini kontrol edip sayfayı yenile."); return; }
  const app = fb.app.initializeApp(firebaseConfig);
  try {
    db = fb.fs.initializeFirestore(app, { localCache: fb.fs.persistentLocalCache({ tabManager: fb.fs.persistentMultipleTabManager() }) });
  } catch (e) { db = fb.fs.getFirestore(app); }
  auth = fb.au.getAuth(app);
  auth.languageCode = "tr";
  fb.au.onAuthStateChanged(auth, u => {
    unsubs.splice(0).forEach(f => f());
    user = u;
    if (!u) { mode = "signedout"; S = emptyState(); renderLogin(); return; }
    mode = "loading"; S = emptyState(); showApp(); subscribe();
    Drive.init();
  });
}
function subscribe() {
  const got = new Set(), L = {};
  COLS.forEach(col => {
    unsubs.push(fb.fs.onSnapshot(colRef(col), snap => {
      const rows = snap.docs.map(x => ({ id: x.id, ...x.data() }));
      if (got.size < COLS.length) { L[col] = rows; got.add(col); if (got.size === COLS.length) { S = { ...L }; decide(); } }
      else { S[col] = rows; decide(); }
    }, e => toast(failMsg(e))));
  });
  unsubs.push(fb.fs.onSnapshot(metaRef(), s => { meta = s.exists() ? s.data() : {}; Drive.fromMeta(meta); render(); }, () => { }));
}
function decide() { mode = COLS.every(c => S[c].length === 0) ? "empty" : "live"; render(); }

const provider = () => { const p = new fb.au.GoogleAuthProvider(); p.addScope(DRIVE_SCOPE); p.setCustomParameters({ prompt: "select_account" }); return p; };
async function signIn() {
  try {
    const res = await fb.au.signInWithPopup(auth, provider());
    Drive.takeToken(fb.au.GoogleAuthProvider.credentialFromResult(res));
  } catch (e) {
    const c = e && e.code;
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
    if (c === "auth/popup-blocked") { toast("Açılır pencere engellendi. Tarayıcı ayarlarından bu siteye izin ver."); return; }
    if (c === "auth/unauthorized-domain") { renderLogin("Bu adres Firebase'de yetkili değil. Firebase → Authentication → Ayarlar → Yetkili alan adları listesine bu siteyi ekle."); return; }
    if (c === "auth/operation-not-allowed") { renderLogin("Google ile giriş Firebase'de açık değil. Authentication → Oturum açma yöntemi → Google'ı etkinleştir."); return; }
    toast("Giriş yapılamadı: " + ((e && e.message) || c || "bilinmeyen hata"));
  }
}
async function signOutNow() {
  Drive.forget();
  await fb.au.signOut(auth);
  closeSheet();
}

/* ---------- seed / wipe / import ---------- */
async function seedSample() {
  const smp = buildSample(), ops = [{ type: "set", ref: metaRef(), data: { sample: true, created: TODAY }, merge: true }];
  for (const col of COLS) for (const o of smp[col]) { const { id, ...d } = o; ops.push({ type: "set", col, id, data: d }); }
  const ok = await safe(() => batchWrite(ops), "Örnek veriler yüklendi");
  if (ok) Drive.dirty();
  return ok;
}
async function wipeAll() {
  if (mode === "demo") { S = emptyState(); saveDemo(); render(); toast("Tüm kayıtlar silindi"); return true; }
  const ops = [];
  for (const col of COLS) for (const o of S[col]) ops.push({ type: "delete", col, id: o.id });
  ops.push({ type: "set", ref: metaRef(), data: { sample: false }, merge: true });
  const ok = await safe(() => batchWrite(ops), "Tüm kayıtlar silindi");
  if (ok) Drive.dirty();
  return ok;
}
function validData(d) { return d && typeof d === "object" && COLS.every(c => !d[c] || Array.isArray(d[c])) && COLS.some(c => Array.isArray(d[c])); }
async function importData(d, label) {
  if (!validData(d)) { toast("Dosya Kasa Defteri verisi içermiyor."); return false; }
  if (mode === "demo") { S = emptyState(); for (const c of COLS) S[c] = (d[c] || []).filter(x => x && x.id).map(x => ({ ...x, id: String(x.id) })); saveDemo(); render(); toast(label + " yüklendi"); return true; }
  const ops = [];
  for (const col of COLS) {
    const keep = new Set((d[col] || []).map(x => x && String(x.id)));
    for (const o of S[col]) if (!keep.has(o.id)) ops.push({ type: "delete", col, id: o.id });
    for (const o of (d[col] || [])) { if (!o || !o.id) continue; const { id, ...rest } = o; ops.push({ type: "set", col, id: String(id), data: rest }); }
  }
  ops.push({ type: "set", ref: metaRef(), data: { sample: false, imported: new Date().toISOString() }, merge: true });
  const ok = await safe(() => batchWrite(ops), label + " yüklendi");
  if (ok) Drive.dirty();
  return ok;
}
function snapshotData() {
  return { app: "kasa-defteri", version: 1, savedAt: new Date().toISOString(), accounts: S.accounts.map(x => ({ ...x })), contacts: S.contacts.map(x => ({ ...x })), txns: S.txns.map(x => ({ ...x })), plans: S.plans.map(x => ({ ...x })) };
}

/* ---------- Google Drive backup (Drive REST, drive.file) ---------- */
const Drive = {
  token: null, exp: 0, state: "off", msg: "", fileId: null, folderId: null, lastBackup: null, timer: null, busy: false, again: false,
  init() {
    try { const t = JSON.parse(ls.get("kd-drive-token") || "null"); if (t && t.uid === user.uid && t.exp > Date.now() + 60000) { this.token = t.token; this.exp = t.exp; } } catch (e) { }
    this.set(this.token ? "ok" : "need", "");
  },
  fromMeta(m) { this.fileId = m.driveFileId || null; this.folderId = m.driveFolderId || null; this.lastBackup = m.lastBackup || null; },
  takeToken(cred) {
    if (!cred || !cred.accessToken || !user) return;
    this.token = cred.accessToken; this.exp = Date.now() + 55 * 60 * 1000;
    ls.set("kd-drive-token", JSON.stringify({ uid: user.uid, token: this.token, exp: this.exp }));
    this.set("ok", "");
  },
  forget() { this.token = null; this.exp = 0; ls.del("kd-drive-token"); clearTimeout(this.timer); },
  valid() { return this.token && this.exp > Date.now() + 30000; },
  set(state, msg) { this.state = state; this.msg = msg || ""; renderChips(); if ($("#drivePanel")) drivePanel(); },
  async authorize() { // kullanıcının dokunuşuyla çağrılır
    try { const res = await fb.au.reauthenticateWithPopup(user, provider()); this.takeToken(fb.au.GoogleAuthProvider.credentialFromResult(res)); return true; }
    catch (e) { if (e && e.code !== "auth/popup-closed-by-user") toast("Drive izni alınamadı: " + (e.message || e.code)); return false; }
  },
  async api(path, opts = {}) {
    const r = await fetch("https://www.googleapis.com" + path, { ...opts, headers: { Authorization: "Bearer " + this.token, ...(opts.headers || {}) } });
    if (r.status === 401) { this.forget(); const e = new Error("Drive oturumunun süresi doldu"); e.status = 401; throw e; }
    if (!r.ok) { let m = ""; try { m = (await r.json()).error.message; } catch (_) { } const e = new Error(m || ("Drive hatası " + r.status)); e.status = r.status; throw e; }
    return r.status === 204 ? null : r;
  },
  errText(e) {
    if (e && e.status === 401) return "Drive izninin süresi doldu. Yenilemek için dokun.";
    if (e && e.status === 403) return "Drive erişimi reddedildi. Google Cloud'da Drive API açık mı kontrol et.";
    if (!navigator.onLine) return "İnternet yok. Bağlanınca yedeklenecek.";
    return "Drive yedeği alınamadı: " + ((e && e.message) || "bilinmeyen hata");
  },
  async ensureFolder() {
    if (this.folderId) {
      try { const r = await this.api(`/drive/v3/files/${this.folderId}?fields=id,trashed`); const j = await r.json(); if (!j.trashed) return this.folderId; } catch (e) { if (e.status === 401) throw e; }
    }
    const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const l = await (await this.api(`/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`)).json();
    if (l.files && l.files[0]) { this.folderId = l.files[0].id; return this.folderId; }
    const c = await (await this.api("/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: "application/vnd.google-apps.folder" }) })).json();
    this.folderId = c.id; return c.id;
  },
  async upload(json) {
    if (this.fileId) {
      try { await this.api(`/upload/drive/v3/files/${this.fileId}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: json }); return this.fileId; }
      catch (e) { if (e.status !== 404) throw e; this.fileId = null; }
    }
    const folder = await this.ensureFolder();
    const boundary = "kd" + uid8();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DRIVE_FILE, parents: [folder], mimeType: "application/json" })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
    const c = await (await this.api("/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body })).json();
    this.fileId = c.id; return c.id;
  },
  dirty() {
    if (!live()) return;
    clearTimeout(this.timer);
    if (!this.valid()) { this.set("need", ""); return; }
    this.set("busy", "Değişiklik bekleniyor");
    this.timer = setTimeout(() => this.save(), 5000);
  },
  async save(manual) {
    if (!live()) return;
    if (!this.valid()) { this.set("need", ""); if (manual && await this.authorize()) return this.save(); return; }
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.set("busy", "Drive'a kaydediliyor");
    try {
      const snap = snapshotData();
      const id = await this.upload(JSON.stringify(snap));
      this.lastBackup = snap.savedAt;
      fb.fs.setDoc(metaRef(), { driveFileId: id, driveFolderId: this.folderId, lastBackup: snap.savedAt }, { merge: true }).catch(() => { });
      this.set("ok", "");
      if (manual) toast("Drive'a kaydedildi");
    } catch (e) { this.set(e.status === 401 ? "need" : "err", this.errText(e)); }
    this.busy = false;
    if (this.again) { this.again = false; this.dirty(); }
  },
  async download() {
    if (!this.valid() && !(await this.authorize())) return null;
    let id = this.fileId;
    if (!id) {
      const q = encodeURIComponent(`name='${DRIVE_FILE}' and trashed=false`);
      const l = await (await this.api(`/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id)&spaces=drive`)).json();
      id = l.files && l.files[0] && l.files[0].id;
    }
    if (!id) return null;
    return await (await this.api(`/drive/v3/files/${id}?alt=media`)).json();
  }
};

/* ---------- render ---------- */
const TABS = [["ozet", "Özet"], ["islemler", "İşlemler"], ["vadeler", "Vadeler"], ["hesaplar", "Hesaplar"], ["cariler", "Cariler"], ["raporlar", "Raporlar"]];
function showApp() { $("#loginRoot").hidden = true; $("#appRoot").hidden = false; render(); }
const GLOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
function renderLogin(err) {
  $("#appRoot").hidden = true; const r = $("#loginRoot"); r.hidden = false;
  r.innerHTML = `<div class="wrap login"><div class="login-card">
    <h1><span class="mark">₺</span>Kasa Defteri</h1>
    <p>Gelir, gider, banka hesapları, cariler ve vadeler tek yerde. Tüm cihazlarında anında güncel.</p>
    <ul class="feat"><li>Kayıtların yalnızca sana görünür</li><li>İnternet yokken de çalışır, bağlanınca eşitlenir</li><li>Google Drive'ına otomatik yedeklenir</li></ul>
    ${err ? `<p class="neg" style="font-size:.9rem">${esc(err)}</p>` : ""}
    <button class="gbtn" type="button" data-act="signin" ${mode === "loading" ? "disabled" : ""}>${GLOGO}Google ile giriş yap</button>
    <p class="small-note">Girişte Google, uygulamanın yalnızca kendi oluşturduğu Drive dosyalarına erişmesi için izin ister.</p>
  </div></div>`;
}
function render() {
  if ($("#appRoot").hidden) return;
  TODAY = iso(new Date());
  const overdue = pending().filter(p => p.due < TODAY).length;
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${ui.tab === k}" data-tab="${k}">${l}${k === "vadeler" && overdue ? `<span class="cnt">${overdue}</span>` : ""}</button>`).join("");
  const np = totalCash() + recv() - pay();
  const npEl = $("#netpos"); npEl.textContent = mode === "loading" ? "—" : money(np); npEl.className = "num " + (np < 0 ? "neg" : "");
  renderNotice(); renderChips();
  const v = $("#view");
  if (mode === "loading") { v.innerHTML = `<section class="panel empty"><h3>Defterin yükleniyor</h3><p>Kayıtların getiriliyor…</p></section>`; return; }
  if (mode === "empty") { v.innerHTML = emptyView(); return; }
  v.innerHTML = ({ ozet: viewOzet, islemler: viewIslemler, vadeler: viewVadeler, hesaplar: viewHesaplar, cariler: viewCariler, raporlar: viewRaporlar }[ui.tab] || viewOzet)();
  const qi = $("#fq"); if (qi && ui._focusQ) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); ui._focusQ = false; }
}
function renderNotice() {
  const b = $("#noticeBox"); let h = "";
  if (mode === "demo") h = `<div class="notice warn"><span><b>Deneme modu.</b> Firebase henüz ayarlanmadı; kayıtlar yalnızca bu cihazda tutuluyor. Kurulum için README'deki adımları izle.</span></div>`;
  else if (mode === "live" && meta.sample) h = `<div class="notice"><span><b>Örnek veriler yüklü.</b> Kendi kayıtlarına geçmek için örnekleri temizle.</span><span id="wipeSlot"><button class="btn small" data-act="wipe">Tümünü temizle</button></span></div>`;
  if (installEvt) h += `<div class="notice"><span><b>Kasa Defteri'ni telefonuna yükle.</b> Ana ekrandan tek dokunuşla, tam ekran açılır.</span><button class="btn small primary" data-act="install">Yükle</button></div>`;
  b.innerHTML = h;
}
function renderChips() {
  const el = $("#chips"); if (!el) return;
  let h = "";
  if (!navigator.onLine) h += `<span class="chip"><span class="dot busy"></span>Çevrimdışı</span>`;
  else if (live()) h += `<span class="chip" title="Aynı Google hesabıyla girdiğin tüm cihazlarda değişiklikler anında görünür"><span class="dot ok live"></span>Canlı senkron</span>`;
  if (live()) {
    const s = Drive.state, cls = s === "ok" ? "ok" : s === "busy" ? "busy" : s === "err" || s === "need" ? "err" : "";
    const t = s === "ok" ? (Drive.lastBackup ? `Drive · ${tfmt.format(new Date(Drive.lastBackup))}` : "Drive · hazır") : s === "busy" ? "Drive · kaydediliyor" : s === "need" ? "Drive · izin gerekli" : s === "err" ? "Drive · sorun var" : "Drive";
    h += `<button class="chip" type="button" data-act="drive"><span class="dot ${cls}"></span>${t}</button>`;
  }
  if (user) h += `<button class="chip acc-chip" type="button" data-act="account">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}${esc(user.displayName || user.email || "Hesabım")}</button>`;
  else if (mode === "demo") h += `<button class="chip" type="button" data-act="account">Deneme modu</button>`;
  el.innerHTML = h;
}
function emptyView() {
  return `<section class="panel empty"><h3>Defterin boş</h3>
  <p>Gelir, gider, banka hesapları, cariler ve vadeli ödemeler burada toplanır. Kayıtların yalnızca sana görünür.</p>
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
  <button class="btn primary" data-act="new-account">İlk hesabını ekle</button>
  <button class="btn" data-act="import">Yedek dosyasından yükle</button>
  <button class="btn" data-act="drive-restore">Drive'dan geri yükle</button>
  <button class="btn" data-act="seed">Örnek verilerle dene</button></div>
  <p class="small-note" style="margin-top:14px">Claude'daki Kasa Defteri'nden geçiyorsan: Drive'ındaki <b>Kasa Defteri</b> klasöründen <b>kasa-defteri-veri.json</b> dosyasını indir, sonra "Yedek dosyasından yükle"yi seç.</p></section>`;
}

/* --- Özet --- */
function viewOzet() {
  const cash = totalCash(), r = recv(), p = pay();
  const pr = projection(60), d30 = pr[30].bal, min = pr.reduce((m, x) => x.bal < m.bal ? x : m, pr[0]);
  const overdue = pending().filter(x => x.due < TODAY);
  const kpi = (l, v, s, cls = "") => `<div class="panel kpi ${cls}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
  const up = pending().filter(x => x.due <= addDays(TODAY, 14)).sort((a, b) => a.due < b.due ? -1 : 1);
  return `<section class="grid g-kpi">
    ${kpi("Kasa ve banka", money(cash), `${S.accounts.length} hesap`, "hl")}
    ${kpi("Alacaklar", `<span class="pos">${money(r)}</span>`, `${pending().filter(x => x.dir === "tahsilat").length} bekleyen tahsilat`)}
    ${kpi("Borçlar", `<span class="neg">${money(p)}</span>`, `${pending().filter(x => x.dir === "ödeme").length} bekleyen ödeme`)}
    ${kpi("30 gün sonra", `<span class="${d30 < 0 ? "neg" : ""}">${money(d30)}</span>`, `Bugüne göre ${signed(d30 - cash)}`)}
  </section>
  <section class="grid g-2">
    <div class="panel"><div class="ph"><div><h2>Nakit akışı tahmini</h2><p>Bugünkü bakiye + bekleyen vadeler, 60 gün</p></div>
      <span class="pill ${min.bal < 0 ? "neg" : min.bal < cash * 0.25 ? "warn" : "pos"}">En düşük ${money0(min.bal)} · ${dshort(min.day)}</span></div>
      ${projChart(pr)}
      ${min.bal < 0 ? `<p class="neg" style="margin:10px 0 0;font-size:.88rem"><b>Dikkat:</b> ${dshort(min.day)} civarında bakiye eksiye düşüyor. Tahsilatları öne çekmeyi veya bir ödemeyi ertelemeyi düşün.</p>` : ""}
    </div>
    <div class="panel"><div class="ph"><div><h2>Yaklaşan vadeler</h2><p>${overdue.length ? `${overdue.length} gecikmiş, ` : ""}önümüzdeki 14 gün</p></div>
      <button class="btn small" data-tab="vadeler">Tümü</button></div>
      <div class="list">${up.length ? up.slice(0, 7).map(planRow).join("") : `<p class="muted">Önümüzdeki 14 günde vade yok.</p>`}</div></div>
  </section>
  <section class="grid g-2">
    <div class="panel"><div class="ph"><div><h2>Son 6 ay</h2><p>Aylık gelir ve gider (transferler hariç)</p></div>
      <div class="legend"><span><i style="background:var(--pos)"></i>Gelir</span><span><i style="background:var(--neg)"></i>Gider</span></div></div>
      ${monthChart()}</div>
    <div class="panel"><div class="ph"><h2>Hesaplar</h2><button class="btn small" data-act="new-account">+ Hesap</button></div>
      <div class="list">${accountGroups().map(g => `<div class="dhead" style="padding-top:8px"><span>${esc(g.name)}</span><span class="num ${g.total < 0 ? "neg" : ""}">${money(g.total)}</span></div>` + g.list.map(a => `<div class="row click" data-edit-account="${esc(a.id)}" style="padding-left:12px"><div><div class="t">${esc(a.name)}</div><div class="m">${esc(kindLabel(a.kind))}</div></div><div class="amt ${balanceOf(a) < 0 ? "neg" : ""}">${money(balanceOf(a))}</div></div>`).join("")).join("") || `<p class="muted">Henüz hesap yok.</p>`}</div></div>
  </section>`;
}
function planRow(p) {
  const c = con(p.contactId), late = p.status !== "tamam" && p.due < TODAY, dd = diffDays(TODAY, p.due);
  const when = p.status === "tamam" ? `Tamamlandı ${p.doneDate ? dshort(p.doneDate) : ""}` : late ? `${-dd} gün gecikti` : dd === 0 ? "Bugün" : `${dd} gün sonra · ${dshort(p.due)}`;
  return `<div class="row"><div class="click" data-edit-plan="${esc(p.id)}" style="cursor:pointer;min-width:0">
    <div class="t"><span class="pill ${p.dir === "tahsilat" ? "pos" : "neg"}">${p.dir === "tahsilat" ? "Tahsilat" : "Ödeme"}</span> ${esc(c ? c.name : (p.note || p.category))}</div>
    <div class="m">${late ? `<span class="neg">${when}</span>` : when} · ${esc(p.category || "")}${p.repeat === "aylık" ? " · her ay" : ""}</div></div>
    <div class="act"><span class="amt ${p.dir === "tahsilat" ? "pos" : "neg"}">${p.dir === "tahsilat" ? "+" : "−"}${money(p.amount)}</span>
    ${p.status !== "tamam" ? `<button class="btn small" data-complete="${esc(p.id)}">${p.dir === "tahsilat" ? "Tahsil et" : "Öde"}</button>` : ""}</div></div>`;
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function projChart(pr) {
  const W = 640, H = 230, L = 58, R = 12, T = 14, B = 28;
  const vals = pr.map(x => x.bal), lo = Math.min(0, ...vals), hi = Math.max(...vals, 1);
  const step = niceStep((hi - lo || 1) / 4), y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const X = i => L + i * (W - L - R) / (pr.length - 1), Y = v => T + (y1 - v) * (H - T - B) / (y1 - y0 || 1);
  let g = ""; for (let v = y0; v <= y1 + 1e-6; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="${v === 0 ? 1.5 : 1}" ${v === 0 ? "" : 'stroke-dasharray="2 4"'}/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${cf.format(v)}</text>`;
  let xl = ""; [0, 15, 30, 45, 60].forEach(i => { if (pr[i]) xl += `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === 60 ? "end" : "middle"}">${i === 0 ? "Bugün" : dshort(pr[i].day)}</text>`; });
  let sp = `M${X(0)} ${Y(pr[0].bal)}`; for (let i = 1; i < pr.length; i++) sp += ` H${X(i)} V${Y(pr[i].bal)}`;
  const area = sp + ` V${Y(Math.max(y0, 0))} H${X(0)} Z`;
  const min = pr.reduce((m, x, i) => x.bal < m.v ? { v: x.bal, i } : m, { v: Infinity, i: 0 }), last = pr[pr.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="60 günlük nakit tahmini">${g}${xl}
    <path d="${area}" fill="var(--accent)" fill-opacity=".10"/>
    <path d="${sp}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="${X(min.i)}" cy="${Y(min.v)}" r="4.5" fill="${min.v < 0 ? "var(--neg)" : "var(--surface)"}" stroke="${min.v < 0 ? "var(--neg)" : "var(--accent)"}" stroke-width="2"/>
    <circle cx="${X(pr.length - 1)}" cy="${Y(last.bal)}" r="4.5" fill="var(--accent)"/></svg>`;
}
const monthKey = s => s.slice(0, 7);
function lastMonths(n) { const out = [], d = pd(TODAY); for (let i = n - 1; i >= 0; i--) out.push(iso(new Date(d.getFullYear(), d.getMonth() - i, 1)).slice(0, 7)); return out; }
function monthChart() {
  const data = lastMonths(6).map(m => ({ m, inc: sum(S.txns.filter(t => t.type === "gelir" && monthKey(t.date) === m), t => t.amount), exp: sum(S.txns.filter(t => t.type === "gider" && monthKey(t.date) === m), t => t.amount) }));
  const W = 640, H = 220, L = 50, R = 8, T = 12, B = 28, mx = Math.max(1, ...data.map(x => Math.max(x.inc, x.exp)));
  const step = niceStep(mx / 4), top = Math.ceil(mx / step) * step, Y = v => T + (top - v) * (H - T - B) / top, bw = (W - L - R) / data.length;
  let g = ""; for (let v = 0; v <= top + 1e-6; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v ? 'stroke-dasharray="2 4"' : ""}/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${cf.format(v)}</text>`;
  let b = ""; data.forEach((x, i) => {
    const cx = L + i * bw + bw / 2, w = Math.min(22, bw / 3.2);
    b += `<rect x="${cx - w - 2}" y="${Y(x.inc)}" width="${w}" height="${Y(0) - Y(x.inc)}" rx="3" fill="var(--pos)"><title>Gelir ${money(x.inc)}</title></rect>
    <rect x="${cx + 2}" y="${Y(x.exp)}" width="${w}" height="${Y(0) - Y(x.exp)}" rx="3" fill="var(--neg)"><title>Gider ${money(x.exp)}</title></rect>
    <text x="${cx}" y="${H - 8}" text-anchor="middle">${mfmt.format(pd(x.m + "-01"))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Son 6 ay gelir ve gider">${g}${b}</svg>`;
}

/* --- İşlemler --- */
function txLabel(t) {
  if (t.type === "transfer") { const a = acc(t.accountId), b = acc(t.toAccountId); return `${a ? accName(a) : "?"} → ${b ? accName(b) : "?"}`; }
  const c = con(t.contactId); return c ? c.name : (t.note || t.category);
}
function viewIslemler() {
  const q = ui.q.toLocaleLowerCase("tr");
  let rows = S.txns.filter(t => (!ui.ftype || t.type === ui.ftype) && (!ui.facc || (ui.facc.startsWith("g:") ? [t.accountId, t.toAccountId].some(id => id && acc(id) && groupOf(acc(id)) === ui.facc.slice(2)) : (t.accountId === ui.facc || t.toAccountId === ui.facc))));
  if (q) rows = rows.filter(t => [t.category, t.note, txLabel(t), String(t.amount)].join(" ").toLocaleLowerCase("tr").includes(q));
  rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const inc = sum(rows.filter(t => t.type === "gelir"), t => t.amount), exp = sum(rows.filter(t => t.type === "gider"), t => t.amount);
  let h = "", cur = "";
  for (const t of rows.slice(0, 300)) {
    const m = monthKey(t.date);
    if (m !== cur) {
      cur = m; const net = sum(rows.filter(x => monthKey(x.date) === m), x => x.type === "gelir" ? x.amount : x.type === "gider" ? -x.amount : 0);
      h += `<div class="dhead"><span>${mfmtL.format(pd(m + "-01"))}</span><span class="num ${net < 0 ? "neg" : "pos"}">${signed(net)}</span></div>`;
    }
    const a = acc(t.accountId), sg = t.type === "gelir" ? 1 : t.type === "gider" ? -1 : 0;
    h += `<div class="row click" data-edit-txn="${esc(t.id)}"><div><div class="t">${esc(txLabel(t))}</div>
      <div class="m">${dshort(t.date)} · ${esc(t.category || "")}${t.type !== "transfer" && a ? " · " + esc(accName(a)) : ""}${t.note && con(t.contactId) ? " · " + esc(t.note) : ""}</div></div>
      <div class="amt ${sg > 0 ? "pos" : sg < 0 ? "neg" : "muted"}">${sg > 0 ? "+" : sg < 0 ? "−" : "⇄ "}${money(t.amount)}</div></div>`;
  }
  return `<section class="panel"><div class="ph"><div><h2>İşlemler</h2><p>${rows.length} kayıt · <span class="pos">${money(inc)}</span> gelir · <span class="neg">${money(exp)}</span> gider</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="import-stmt">⇣ Ekstre içe aktar</button><button class="btn primary" data-act="new-txn">+ İşlem</button></div></div>
    <div class="filters"><input id="fq" type="search" placeholder="Ara: kategori, cari, not, tutar" value="${esc(ui.q)}" aria-label="İşlemlerde ara">
    <select id="ftype" aria-label="Tür"><option value="">Tüm türler</option>${["gelir", "gider", "transfer"].map(x => `<option value="${x}" ${ui.ftype === x ? "selected" : ""}>${x[0].toLocaleUpperCase("tr") + x.slice(1)}</option>`).join("")}</select>
    <select id="facc" aria-label="Hesap"><option value="">Tüm hesaplar</option>${accountGroups().map(g => `<optgroup label="${esc(g.name)}"><option value="g:${esc(g.name)}" ${ui.facc === "g:" + g.name ? "selected" : ""}>${esc(g.name)} · tümü</option>${g.list.map(a => `<option value="${esc(a.id)}" ${ui.facc === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</optgroup>`).join("")}</select></div>
    <div class="list">${h || `<p class="muted" style="padding:14px 4px">Eşleşen işlem yok.</p>`}</div></section>`;
}

/* --- Vadeler --- */
function viewVadeler() {
  const done = ui.planView === "tamam";
  const list = S.plans.filter(p => done ? p.status === "tamam" : p.status !== "tamam").sort((a, b) => done ? ((a.doneDate || "") < (b.doneDate || "") ? 1 : -1) : (a.due < b.due ? -1 : 1));
  let h = "";
  if (done) h = list.map(planRow).join("");
  else {
    const wk = addDays(TODAY, 7), mo = addDays(TODAY, 30);
    for (const [n, f] of [["Gecikmiş", p => p.due < TODAY], ["Bu hafta", p => p.due >= TODAY && p.due <= wk], ["30 gün içinde", p => p.due > wk && p.due <= mo], ["Daha sonra", p => p.due > mo]]) {
      const g = list.filter(f); if (!g.length) continue; const net = sum(g, p => p.dir === "tahsilat" ? p.amount : -p.amount);
      h += `<div class="dhead"><span>${n}</span><span class="num ${net < 0 ? "neg" : "pos"}">${signed(net)}</span></div>` + g.map(planRow).join("");
    }
  }
  return `<section class="panel"><div class="ph"><div><h2>Vadeler</h2><p>Yaklaşan ödemeler ve tahsilatlar. Tamamladığında işlem otomatik oluşur.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><div class="seg" role="group" aria-label="Durum"><button data-pv="bekliyor" aria-pressed="${!done}">Bekleyen</button><button data-pv="tamam" aria-pressed="${done}">Tamamlanan</button></div>
    <button class="btn primary" data-act="new-plan">+ Vade</button></div></div>
    ${!done ? `<div class="grid g-kpi" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:6px">
      <div class="kpi" style="padding:6px 0"><div class="lbl">Bekleyen tahsilat</div><div class="val pos">${money(recv())}</div></div>
      <div class="kpi" style="padding:6px 0"><div class="lbl">Bekleyen ödeme</div><div class="val neg">${money(pay())}</div></div>
      <div class="kpi" style="padding:6px 0"><div class="lbl">Fark</div><div class="val">${signed(recv() - pay())}</div></div></div>` : ""}
    <div class="list">${h || `<p class="muted" style="padding:14px 4px">${done ? "Henüz tamamlanan vade yok." : "Bekleyen vade yok."}</p>`}</div></section>`;
}

/* --- Hesaplar --- */
function viewHesaplar() {
  const gs = accountGroups(), total = totalCash(), assets = sum(gs, g => g.assets), debts = sum(gs, g => g.debts);
  let collapsed = {}; try { collapsed = JSON.parse(ls.get("kd-collapsed") || "{}"); } catch (e) { }
  return `<section class="panel"><div class="ph"><div><h2>Hesaplar</h2><p>${gs.length} grup · ${S.accounts.length} hesap</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="import-stmt">⇣ Ekstre</button><button class="btn" data-act="new-transfer">⇄ Transfer</button><button class="btn primary" data-act="new-account">+ Hesap</button></div></div>
    <div class="grid g-kpi" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="kpi" style="padding:4px 0"><div class="lbl">Varlıklar</div><div class="val pos">${money(assets)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Borçlar (kart, kredi)</div><div class="val neg">${money(debts)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Net</div><div class="val ${total < 0 ? "neg" : ""}">${money(total)}</div></div>
    </div></section>
  ${gs.map(g => {
    const open = !collapsed[g.name], share = assets > 0 ? Math.round(g.assets / assets * 100) : 0;
    return `<section class="panel"><div class="ph" style="margin-bottom:${open ? 12 : 0}px">
      <button type="button" class="btn ghost" data-toggle-group="${esc(g.name)}" style="padding:0;gap:10px;min-width:0" aria-expanded="${open}">
        <span class="mark" style="width:30px;height:30px;font-size:13px;flex:none">${esc(g.name.slice(0, 1).toLocaleUpperCase("tr"))}</span>
        <span style="text-align:left;min-width:0"><b style="font-size:1.02rem">${esc(g.name)}</b><br><span class="muted" style="font-size:.8rem;font-weight:400">${g.list.length} hesap${g.assets ? ` · varlıkların %${share}'i` : ""}</span></span>
        <span class="muted" aria-hidden="true">${open ? "▾" : "▸"}</span></button>
      <div style="text-align:right"><div class="num ${g.total < 0 ? "neg" : ""}" style="font-size:1.1rem;font-weight:500">${money(g.total)}</div>
        <div class="muted" style="font-size:.78rem">${g.debts ? `<span class="pos">+${money0(g.assets)}</span> · <span class="neg">−${money0(g.debts)}</span>` : "net"}</div></div></div>
      ${open ? `<div class="cards">${g.list.map(accCard).join("")}
        <button class="acard" type="button" data-new-in-group="${esc(g.name)}" style="place-content:center;text-align:center;border-style:dashed;color:var(--muted);min-height:90px">+ ${esc(g.name)} için hesap ekle</button></div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn small ghost" data-rename-group="${esc(g.name)}">Grup adını değiştir</button></div>` : ""}
    </section>`;
  }).join("") || `<section class="panel"><p class="muted">Henüz hesap yok.</p></section>`}`;
}
function accCard(a) {
  const b = balanceOf(a), tx = S.txns.filter(t => t.accountId === a.id || t.toAccountId === a.id), last = tx.reduce((m, t) => t.date > m ? t.date : m, "");
  return `<button class="acard" data-edit-account="${esc(a.id)}" type="button"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><b>${esc(a.name)}</b><span class="pill ${a.kind === "kredi kartı" || a.kind === "kredi" ? "neg" : a.kind === "yatırım" || a.kind === "vadeli" || a.kind === "birikim" ? "pos" : "acc"}">${esc(kindLabel(a.kind))}</span></div>
    <div class="bal ${b < 0 ? "neg" : ""}">${money(b)}</div>
    <div class="muted" style="font-size:.82rem">${tx.length} işlem${last ? ` · son ${dshort(last)}` : ""}</div></button>`;
}
function renameGroup(name) {
  openSheet("Grup adını değiştir", `<form class="form" id="frm" data-kind="rename-group" data-id="${esc(name)}">
    <label>Yeni ad<input id="f-gname" required value="${esc(name)}"></label>
    <p class="muted" style="margin:0;font-size:.85rem">Bu gruptaki ${accountGroups().find(g => g.name === name)?.list.length || 0} hesabın grubu değişecek.</p>
    ${formFoot(false)}</form>`);
}

/* --- Cariler --- */
function cariStats(c) {
  const op = pending().filter(p => p.contactId === c.id);
  const r = sum(op.filter(p => p.dir === "tahsilat"), p => p.amount), pp = sum(op.filter(p => p.dir === "ödeme"), p => p.amount);
  const tx = S.txns.filter(t => t.contactId === c.id);
  return { r, pp, net: r - pp, next: op.reduce((m, p) => !m || p.due < m.due ? p : m, null), tx, ciro: sum(tx, t => t.type === "gelir" ? t.amount : t.type === "gider" ? -t.amount : 0) };
}
function viewCariler() {
  const rows = S.contacts.map(c => ({ c, s: cariStats(c) })).sort((a, b) => Math.abs(b.s.net) - Math.abs(a.s.net));
  return `<section class="panel"><div class="ph"><div><h2>Cari hesaplar</h2><p>Müşteri ve tedarikçilerle açık alacak ve borçlar</p></div>
    <button class="btn primary" data-act="new-contact">+ Cari</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Cari</th><th>Tür</th><th class="r">Alacak</th><th class="r">Borç</th><th class="r">Net</th><th>Sıradaki vade</th><th class="r">Hareket toplamı</th></tr></thead><tbody>
    ${rows.map(({ c, s }) => `<tr class="click" data-show-contact="${esc(c.id)}"><td><b>${esc(c.name)}</b></td><td><span class="pill ${c.kind === "müşteri" ? "pos" : c.kind === "tedarikçi" ? "warn" : ""}">${esc(c.kind)}</span></td>
    <td class="r num pos">${s.r ? money(s.r) : "—"}</td><td class="r num neg">${s.pp ? money(s.pp) : "—"}</td><td class="r num ${s.net < 0 ? "neg" : s.net > 0 ? "pos" : "muted"}">${s.net ? signed(s.net) : "—"}</td>
    <td>${s.next ? `<span class="${s.next.due < TODAY ? "neg" : ""}">${dshort(s.next.due)}</span>` : "—"}</td><td class="r num">${s.tx.length ? signed(s.ciro) : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Henüz cari yok.</td></tr>`}
    </tbody></table></div></section>`;
}

/* --- Raporlar --- */
function periodRange(k) {
  const d = pd(TODAY), y = d.getFullYear(), m = d.getMonth();
  if (k === "bu-ay") return [iso(new Date(y, m, 1)), TODAY, "Bu ay"];
  if (k === "gecen-ay") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0)), "Geçen ay"];
  if (k === "3-ay") return [iso(new Date(y, m - 2, 1)), TODAY, "Son 3 ay"];
  if (k === "yil") return [iso(new Date(y, 0, 1)), TODAY, "Bu yıl"];
  return ["0000-01-01", "9999-12-31", "Tümü"];
}
function catBars(list, color) {
  const tot = sum(list, t => t.amount); if (!tot) return `<p class="muted">Bu dönemde kayıt yok.</p>`;
  const m = {}; list.forEach(t => { m[t.category || "Diğer"] = (m[t.category || "Diğer"] || 0) + t.amount; });
  const arr = Object.entries(m).sort((a, b) => b[1] - a[1]), mx = arr[0][1];
  return `<div class="bars">${arr.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(v / mx * 100).toFixed(1)}%;background:${color}"></div></div><span class="num">${money0(v)} <span class="muted">%${Math.round(v / tot * 100)}</span></span></div>`).join("")}</div>`;
}
function viewRaporlar() {
  const [a, b, lbl] = periodRange(ui.period);
  const tx = S.txns.filter(t => t.date >= a && t.date <= b);
  const inc = tx.filter(t => t.type === "gelir"), exp = tx.filter(t => t.type === "gider");
  const I = sum(inc, t => t.amount), E = sum(exp, t => t.amount), N = I - E, rate = I ? Math.round(N / I * 100) : 0;
  const months = [...new Set(tx.map(t => monthKey(t.date)))].sort();
  const top = {}; tx.forEach(t => { if (t.contactId && t.type !== "transfer") top[t.contactId] = (top[t.contactId] || 0) + (t.type === "gelir" ? t.amount : -t.amount); });
  const topArr = Object.entries(top).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 6);
  const P = [["bu-ay", "Bu ay"], ["gecen-ay", "Geçen ay"], ["3-ay", "Son 3 ay"], ["yil", "Bu yıl"], ["tumu", "Tümü"]];
  const twoCol = `grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))`;
  return `<section class="panel"><div class="ph"><div><h2>Gelir tablosu · ${lbl}</h2><p>${a === "0000-01-01" ? "Tüm kayıtlar" : `${dshort(a)} – ${dshort(b)}`} · ${tx.length} işlem</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><div class="seg" role="group" aria-label="Dönem">${P.map(([k, l]) => `<button data-period="${k}" aria-pressed="${ui.period === k}">${l}</button>`).join("")}</div>
    <button class="btn" data-act="csv">CSV indir</button></div></div>
    <div class="grid g-kpi">
      <div class="kpi" style="padding:4px 0"><div class="lbl">Gelir</div><div class="val pos">${money(I)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Gider</div><div class="val neg">${money(E)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Net kâr / zarar</div><div class="val ${N < 0 ? "neg" : ""}">${signed(N)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Kâr marjı</div><div class="val ${rate < 0 ? "neg" : ""}">%${rate}</div><div class="sub">Net ÷ gelir</div></div>
    </div></section>
  <section class="grid g-2" style="${twoCol}">
    <div class="panel"><div class="ph"><h2>Giderler kategoriye göre</h2></div>${catBars(exp, "var(--neg)")}</div>
    <div class="panel"><div class="ph"><h2>Gelirler kategoriye göre</h2></div>${catBars(inc, "var(--pos)")}</div>
  </section>
  <section class="grid g-2" style="${twoCol}">
    <div class="panel"><div class="ph"><h2>Aylık özet</h2></div><div class="tbl-wrap"><table><thead><tr><th>Ay</th><th class="r">Gelir</th><th class="r">Gider</th><th class="r">Net</th></tr></thead><tbody>
    ${months.map(m => { const i = sum(tx.filter(t => t.type === "gelir" && monthKey(t.date) === m), t => t.amount), e = sum(tx.filter(t => t.type === "gider" && monthKey(t.date) === m), t => t.amount); return `<tr><td>${mfmtL.format(pd(m + "-01"))}</td><td class="r num pos">${money(i)}</td><td class="r num neg">${money(e)}</td><td class="r num ${i - e < 0 ? "neg" : ""}">${signed(i - e)}</td></tr>`; }).join("") || `<tr><td colspan="4" class="muted">Kayıt yok.</td></tr>`}
    </tbody></table></div></div>
    <div class="panel"><div class="ph"><h2>Carilere göre hareket</h2></div><div class="list">
    ${topArr.map(([id, v]) => { const c = con(id); return `<div class="row"><div class="t">${esc(c ? c.name : "Silinmiş cari")}</div><div class="amt ${v < 0 ? "neg" : "pos"}">${signed(v)}</div></div>`; }).join("") || `<p class="muted">Bu dönemde cariye bağlı işlem yok.</p>`}
    </div></div>
  </section>`;
}
function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportCsv() {
  const [a, b, lbl] = periodRange(ui.period);
  const tx = S.txns.filter(t => t.date >= a && t.date <= b).sort((x, y) => x.date < y.date ? -1 : 1);
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Tarih", "Tür", "Tutar", "Kategori", "Hesap", "Hedef hesap", "Cari", "Not"].map(q).join(";")];
  tx.forEach(t => lines.push([t.date, t.type, String(t.amount).replace(".", ","), t.category, acc(t.accountId)?.name, acc(t.toAccountId)?.name, con(t.contactId)?.name, t.note].map(q).join(";")));
  saveFile(`kasa-defteri-${lbl.toLocaleLowerCase("tr").replace(/\s+/g, "-")}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

/* ---------- sheets / forms ---------- */
function openSheet(title, body) {
  $("#sheetRoot").innerHTML = `<div class="overlay" id="ov"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>${esc(title)}</h3><button class="btn ghost small" data-close aria-label="Kapat">✕</button></div>${body}</div></div>`;
  const f = $("#sheetRoot input:not([type=hidden]),#sheetRoot select"); if (f && matchMedia("(pointer:fine)").matches) setTimeout(() => f.focus(), 30);
}
const closeSheet = () => { $("#sheetRoot").innerHTML = ""; };
const opt = (arr, sel, blank) => (blank != null ? `<option value="">${blank}</option>` : "") + arr.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
const accOpts = sel => accountGroups().map(g => `<optgroup label="${esc(g.name)}">${g.list.map(a => `<option value="${esc(a.id)}" ${a.id === sel ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</optgroup>`).join("");
const conOpts = sel => opt(S.contacts.map(c => [c.id, c.name]), sel, "— Cari yok —");
const catList = (id, type) => `<datalist id="${id}">${(CATS[type] || [...CATS.gelir, ...CATS.gider]).map(c => `<option value="${esc(c)}">`).join("")}</datalist>`;
const amtStr = n => n ? String(n).replace(".", ",") : "";
const delBtn = has => has ? `<button type="button" class="btn danger" data-del>Sil</button>` : "<span></span>";
const formFoot = has => `<div class="foot">${delBtn(has)}<div class="r"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div>`;

function txnForm(t, presetType) {
  if (!S.accounts.length) { toast("Önce bir hesap ekle."); return accountForm(); }
  const type = t?.type || presetType || "gider";
  openSheet(t?.id ? "İşlemi düzenle" : "Yeni işlem", `<form class="form" id="frm" data-kind="txn" data-id="${esc(t?.id || "")}">
    <div class="seg" role="group" aria-label="İşlem türü">${["gelir", "gider", "transfer"].map(x => `<button type="button" data-ttype="${x}" aria-pressed="${type === x}">${x[0].toLocaleUpperCase("tr") + x.slice(1)}</button>`).join("")}</div>
    <input type="hidden" id="f-type" value="${type}">
    <div class="f2"><label>Tutar (₺)<input id="f-amount" inputmode="decimal" required placeholder="0,00" value="${amtStr(t?.amount)}"></label>
    <label>Tarih<input id="f-date" type="date" required value="${esc(t?.date || TODAY)}"></label></div>
    <div class="f2"><label>${type === "transfer" ? "Çıkış hesabı" : "Hesap"}<select id="f-acc">${accOpts(t?.accountId)}</select></label>
    ${type === "transfer" ? `<label>Giriş hesabı<select id="f-to">${accOpts(t?.toAccountId || S.accounts[1]?.id)}</select></label>` : `<label>Kategori<input id="f-cat" list="dl-cat" required value="${esc(t?.category || "")}" placeholder="Seç veya yaz">${catList("dl-cat", type)}</label>`}</div>
    ${type !== "transfer" ? `<label>Cari<select id="f-con">${conOpts(t?.contactId || "")}</select></label>` : ""}
    <label>Not<input id="f-note" value="${esc(t?.note || "")}" placeholder="İsteğe bağlı"></label>
    ${formFoot(t?.id)}</form>`);
}
function planForm(p) {
  const dir = p?.dir || "ödeme";
  openSheet(p?.id ? "Vadeyi düzenle" : "Yeni vade", `<form class="form" id="frm" data-kind="plan" data-id="${esc(p?.id || "")}">
    <div class="seg" role="group" aria-label="Yön">${[["tahsilat", "Tahsilat (alacak)"], ["ödeme", "Ödeme (borç)"]].map(([v, l]) => `<button type="button" data-pdir="${v}" aria-pressed="${dir === v}">${l}</button>`).join("")}</div>
    <input type="hidden" id="f-dir" value="${dir}">
    <div class="f2"><label>Tutar (₺)<input id="f-amount" inputmode="decimal" required placeholder="0,00" value="${amtStr(p?.amount)}"></label>
    <label>Vade tarihi<input id="f-due" type="date" required value="${esc(p?.due || addDays(TODAY, 7))}"></label></div>
    <div class="f2"><label>Cari<select id="f-con">${conOpts(p?.contactId || "")}</select></label>
    <label>Kategori<input id="f-cat" list="dl-cat" required value="${esc(p?.category || "")}" placeholder="Seç veya yaz">${catList("dl-cat", dir === "tahsilat" ? "gelir" : "gider")}</label></div>
    <div class="f2"><label>Tekrar<select id="f-rep">${opt([["yok", "Tek seferlik"], ["aylık", "Her ay"]], p?.repeat || "yok")}</select></label>
    <label>Not<input id="f-note" value="${esc(p?.note || "")}" placeholder="Fatura no, açıklama"></label></div>
    ${p?.status === "tamam" ? `<p class="muted" style="margin:0;font-size:.85rem">Bu vade ${p.doneDate ? dshort(p.doneDate) : ""} tarihinde tamamlandı.</p>` : ""}
    ${formFoot(p?.id)}</form>`);
}
function accountForm(a) {
  openSheet(a ? "Hesabı düzenle" : "Yeni hesap", `<form class="form" id="frm" data-kind="account" data-id="${esc(a?.id || "")}">
    <div class="f2"><label>Banka / Grup<input id="f-group" list="dl-groups" value="${esc(a ? (a.group || inferGroup(a.name)) : (ui.newGroup || ""))}" placeholder="Örn. Ziraat"><datalist id="dl-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join("")}</datalist></label>
    <label>Hesap adı<input id="f-name" required value="${esc(a?.name || "")}" placeholder="Örn. Bankomat, Yatırım, Bonus kart"></label></div>
    <div class="f2"><label>Tür<select id="f-kind">${opt(KINDS, a?.kind || ui.newKind || "banka")}</select></label>
    <label>Açılış bakiyesi (₺)<input id="f-open" inputmode="decimal" value="${amtStr(a?.opening) || "0"}"></label></div>
    <p class="muted" style="margin:0;font-size:.82rem">Aynı bankadaki hesaplar (bankomat, yatırım, kredi kartı) aynı grupta toplanır. Kredi kartı ve kredi borcunu eksi bakiye olarak gir (örn. -4500).</p>
    ${a ? `<p class="muted" style="margin:0;font-size:.85rem">Güncel bakiye: <b class="num">${money(balanceOf(a))}</b></p>` : ""}
    ${formFoot(a)}</form>`);
}
function contactForm(c) {
  openSheet(c ? "Cariyi düzenle" : "Yeni cari", `<form class="form" id="frm" data-kind="contact" data-id="${esc(c?.id || "")}">
    <label>Ad / Unvan<input id="f-name" required value="${esc(c?.name || "")}"></label>
    <div class="f2"><label>Tür<select id="f-kind">${opt([["müşteri", "Müşteri"], ["tedarikçi", "Tedarikçi"], ["diğer", "Diğer"]], c?.kind || "müşteri")}</select></label>
    <label>Telefon<input id="f-phone" inputmode="tel" value="${esc(c?.phone || "")}"></label></div>
    <label>Not<input id="f-note" value="${esc(c?.note || "")}" placeholder="Vergi no, adres, ödeme koşulu"></label>
    ${formFoot(c)}</form>`);
}
function contactDetail(c) {
  const s = cariStats(c), open = pending().filter(p => p.contactId === c.id).sort((a, b) => a.due < b.due ? -1 : 1), tx = s.tx.slice().sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 10);
  const tel = (c.phone || "").replace(/[^\d+]/g, "");
  openSheet(c.name, `<div class="form">
    <div class="f2"><div><div class="muted" style="font-size:.78rem">Açık alacak</div><div class="num pos">${money(s.r)}</div></div><div><div class="muted" style="font-size:.78rem">Açık borç</div><div class="num neg">${money(s.pp)}</div></div></div>
    ${c.phone ? `<div style="font-size:.9rem;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="muted">Telefon:</span> <span style="user-select:all">${esc(c.phone)}</span> <a class="btn small" href="tel:${esc(tel)}">Ara</a> <a class="btn small" href="https://wa.me/${esc(tel.replace(/^0/, "90").replace(/^\+/, ""))}" target="_blank" rel="noopener">WhatsApp</a></div>` : ""}
    <div><div class="dhead" style="padding-top:0"><span>Açık vadeler</span></div><div class="list">${open.map(planRow).join("") || `<p class="muted">Açık vade yok.</p>`}</div></div>
    <div><div class="dhead"><span>Son işlemler</span></div><div class="list">${tx.map(t => `<div class="row"><div><div class="t">${esc(t.category)}</div><div class="m">${dshort(t.date)}${t.note ? " · " + esc(t.note) : ""}</div></div><div class="amt ${t.type === "gelir" ? "pos" : "neg"}">${t.type === "gelir" ? "+" : "−"}${money(t.amount)}</div></div>`).join("") || `<p class="muted">İşlem yok.</p>`}</div></div>
    <div class="foot"><button class="btn" data-plan-for="${esc(c.id)}">+ Vade ekle</button><div class="r"><button class="btn" data-edit-contact="${esc(c.id)}">Düzenle</button><button class="btn primary" data-close>Kapat</button></div></div></div>`);
}
function completeForm(p) {
  if (!S.accounts.length) { toast("Önce bir hesap ekle."); return accountForm(); }
  const c = con(p.contactId);
  openSheet(p.dir === "tahsilat" ? "Tahsilatı kaydet" : "Ödemeyi kaydet", `<form class="form" id="frm" data-kind="complete" data-id="${esc(p.id)}">
    <p style="margin:0">${esc(c ? c.name : p.category)} · <b class="num ${p.dir === "tahsilat" ? "pos" : "neg"}">${money(p.amount)}</b> · vade ${dshort(p.due)}</p>
    <div class="f2"><label>Tutar (₺)<input id="f-amount" inputmode="decimal" required value="${amtStr(p.amount)}"></label>
    <label>Tarih<input id="f-date" type="date" required value="${TODAY}"></label></div>
    <label>${p.dir === "tahsilat" ? "Hangi hesaba girdi?" : "Hangi hesaptan çıktı?"}<select id="f-acc">${accOpts(S.accounts[0].id)}</select></label>
    ${p.repeat === "aylık" ? `<p class="muted" style="margin:0;font-size:.85rem">Her ay tekrarlıyor: bir sonraki vade ${dshort(addMonths(p.due, 1))} için otomatik oluşturulacak.</p>` : ""}
    <div class="foot"><span></span><div class="r"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div></form>`);
}
function newMenu() {
  openSheet("Ne eklemek istiyorsun?", `<div class="form" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${[["new-gelir", "Gelir", "Satış, hizmet, faiz"], ["new-gider", "Gider", "Kira, fatura, maaş"], ["new-transfer", "Transfer", "Hesaplar arası para aktarımı"], ["new-plan", "Vade", "Yaklaşan ödeme veya tahsilat"], ["new-contact", "Cari", "Müşteri veya tedarikçi"], ["new-account", "Hesap", "Banka, kasa, kredi kartı"], ["import-stmt", "Ekstre", "Bankadan indirilen Excel/CSV"]].map(([a, t, s]) => `<button class="acard" data-act="${a}" type="button"><b>${t}</b><span class="muted" style="font-size:.84rem">${s}</span></button>`).join("")}</div>`);
}
function accountPanel() {
  if (mode === "demo") {
    openSheet("Deneme modu", `<div class="form"><p style="margin:0">Firebase ayarları yapılmadığı için kayıtlar yalnızca bu cihazda tutuluyor. <b>firebase-config.js</b> dosyasını doldurduğunda Google ile giriş, anlık senkron ve Drive yedeği açılır.</p>
      <div class="foot" style="justify-content:flex-start"><button class="btn" data-act="export-json">Yedek dosyası indir</button><button class="btn" data-act="import">Yedek dosyasından yükle</button></div></div>`);
    return;
  }
  openSheet("Hesabım", `<div class="form">
    <div style="display:flex;gap:12px;align-items:center">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" width="44" height="44" style="border-radius:50%" referrerpolicy="no-referrer">` : ""}<div><b>${esc(user.displayName || "")}</b><div class="muted" style="font-size:.88rem">${esc(user.email || "")}</div></div></div>
    <p class="muted" style="margin:0;font-size:.88rem">Bu Google hesabıyla girdiğin tüm cihazlarda aynı kayıtları görürsün.</p>
    <div class="foot" style="justify-content:flex-start"><button class="btn" data-act="export-json">Yedek dosyası indir</button><button class="btn" data-act="import">Yedek dosyasından yükle</button></div>
    <div class="foot"><span></span><div class="r"><button class="btn danger" data-act="signout">Çıkış yap</button></div></div></div>`);
}
function drivePanel() {
  const d = Drive;
  const body = `<div class="form" id="drivePanel">
    <p style="margin:0">Her değişiklikten birkaç saniye sonra tüm kayıtların Google Drive'ındaki <b>${DRIVE_FOLDER}</b> klasörüne <b>${DRIVE_FILE}</b> olarak kaydedilir. Tek bir dosya tutulur ve her seferinde güncellenir.</p>
    <dl class="kv"><dt>Durum</dt><dd>${d.state === "ok" ? '<span class="pos">Bağlı</span>' : d.state === "busy" ? '<span style="color:var(--warn)">' + esc(d.msg || "Çalışıyor") + "</span>" : d.state === "need" ? '<span class="neg">Drive izninin süresi doldu (izin 1 saat geçerli). Aşağıdan yenile.</span>' : d.state === "err" ? '<span class="neg">' + esc(d.msg) + "</span>" : "Kapalı"}</dd>
    <dt>Son yedek</dt><dd>${d.lastBackup ? tfmt.format(new Date(d.lastBackup)) : "Henüz yok"}</dd>
    ${d.fileId ? `<dt>Dosya</dt><dd><a href="https://drive.google.com/file/d/${esc(d.fileId)}/view" target="_blank" rel="noopener" style="color:var(--accent)">Drive'da aç</a></dd>` : ""}</dl>
    <div class="foot" style="justify-content:flex-start;flex-wrap:wrap">
      <button class="btn primary" data-act="drive-save" ${d.busy ? "disabled" : ""}>${d.valid() ? "Şimdi Drive'a kaydet" : "Drive iznini yenile ve kaydet"}</button>
      <span id="restoreSlot"><button class="btn" data-act="drive-restore">Drive'dan geri yükle</button></span>
    </div>
    <p class="muted" style="margin:0;font-size:.82rem">Google, güvenlik gereği Drive iznini 1 saatte bir yeniletir. İzin dolduğunda kayıtların yine telefonda ve bulutta (Firebase) güvende; sadece Drive kopyası bir sonraki yenilemeye kadar bekler.</p></div>`;
  if ($("#drivePanel")) $("#drivePanel").outerHTML = body; else openSheet("Google Drive yedeği", body);
}

/* ---------- banka ekstresi içe aktarma ---------- */
let imp = null;
const ALLCATS = () => [...new Set([...CATS.gelir, ...CATS.gider, ...S.txns.map(t => t.category).filter(c => c && c !== "Transfer")])];
function openImport(accountId) {
  if (!S.accounts.length) { toast("Önce bankan için bir hesap ekle."); return accountForm(); }
  const accId = accountId || (acc(ls.get("kd-imp-acc")) ? ls.get("kd-imp-acc") : S.accounts[0].id);
  imp = { accountId: accId };
  openSheet("Banka ekstresi içe aktar", `<div class="form">
    <p style="margin:0">İnternet veya mobil bankacılıktan <b>hesap hareketlerini PDF, Excel ya da CSV</b> olarak indir, sonra burada seç. Kayıtlar eklenmeden önce sana gösterilir.</p>
    <label>Hangi hesabın ekstresi?<select id="imp-acc">${accOpts(accId)}</select></label>
    <button class="btn primary" type="button" data-act="imp-pick" style="justify-content:center;padding:12px">Dosya seç</button>
    <input type="file" id="stmtFile" accept=".pdf,.xlsx,.xls,.csv,.txt,.ods,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>
    <details class="small-note"><summary>Ekstreyi nereden indiririm?</summary>
      <p>Çoğu bankada: <b>Hesaplarım → hesabı seç → Hesap hareketleri → tarih aralığı → İndir / Excel</b>. Mobil uygulamada bulamazsan internet şubesinden indir. PDF de olur; taranmış (fotoğraf) PDF'ler okunamaz. Şifreli PDF'te şifre sorulur.</p></details>
  </div>`);
}
async function readStatement(file, password) {
  try {
    toast("Dosya okunuyor…");
    imp.file = file;
    const rows = await IMP.fileToRows(file, password);
    if (!rows || !rows.length) { toast("Dosyada okunabilir satır yok."); return; }
    let hIdx = IMP.detectHeader(rows);
    if (hIdx < 0) hIdx = 0;
    const headers = (rows[hIdx] || []).map(h => String(h ?? "").trim());
    const sig = IMP.headerSignature(headers);
    let map = null; try { map = JSON.parse(ls.get("kd-map:" + sig) || "null"); } catch (e) { }
    if (!map) { map = IMP.guessMapping(headers, rows.slice(hIdx + 1)); const ex = IMP.extract(rows, hIdx, map); if (acc(imp.accountId)?.kind === "kredi kartı" && ex.length && ex.filter(x => x.amount > 0).length > ex.length * 0.6) map.invert = true; }
    Object.assign(imp, { fileName: file.name, rows, hIdx, headers, sig, map, fixOpening: false });
    buildImpItems(); clearTimeout(tt); $("#toastRoot").innerHTML = ""; renderImport();
  } catch (e) {
    if (e instanceof IMP.PdfPasswordError) { clearTimeout(tt); $("#toastRoot").innerHTML = ""; return askPdfPassword(e.wrong); }
    toast((e && e.message) || "Dosya okunamadı.");
  }
}
function askPdfPassword(wrong) {
  openSheet("Şifreli PDF", `<form class="form" id="pdfPwForm" data-kind="pdfpw">
    <p style="margin:0">Bu ekstre şifreli. Bankanın e-ekstre şifresini gir. Genellikle T.C. kimlik numaranın bir kısmı ya da doğum tarihindir; bankanın e-postasında yazar.</p>
    ${wrong ? `<p class="neg" style="margin:0">Şifre yanlış, tekrar dene.</p>` : ""}
    <label>PDF şifresi<input id="pdf-pw" type="password" autocomplete="off" required></label>
    <p class="small-note" style="margin:0">Şifre sadece bu dosyayı açmak için kullanılır; hiçbir yere kaydedilmez.</p>
    <div class="foot"><span></span><div class="r"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn primary" type="submit">Aç</button></div></div></form>`);
  setTimeout(() => $("#pdf-pw")?.focus(), 50);
}
function buildImpItems() {
  const ext = IMP.extract(imp.rows, imp.hIdx, imp.map);
  const learned = {};
  const byContact = {};
  S.txns.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => {
    if (t.type === "transfer" || !t.category) return;
    if (t.note) learned[IMP.learnKey(t.note)] = t.category;
    if (t.contactId) byContact[t.contactId + "|" + t.type] = t.category;
  });
  const keys = new Set(S.txns.map(t => t.importKey).filter(Boolean));
  const occ = {};
  const contacts = S.contacts.filter(c => c.name && c.name.length >= 4).map(c => ({ id: c.id, n: IMP.up(c.name) }));
  imp.items = ext.map(x => {
    const base = `${imp.accountId}|${x.date}|${x.amount}|${IMP.learnKey(x.desc)}`;
    occ[base] = (occ[base] || 0) + 1;
    const key = base + "|" + occ[base];
    const type = x.amount > 0 ? "gelir" : "gider", amt = Math.abs(x.amount);
    const exact = keys.has(key);
    const maybe = !exact && S.txns.some(t => t.accountId === imp.accountId && t.date === x.date && t.type === type && Math.abs(t.amount - amt) < 0.01);
    const D = IMP.up(x.desc), ct = contacts.find(c => D.includes(c.n));
    const isCard = acc(imp.accountId)?.kind === "kredi kartı";
    if (isCard && x.amount > 0 && /ODEME|ÖDEME|TESEKKUR|TEŞEKKÜR|PAYMENT|HESAPTAN/i.test(IMP.up(x.desc))) {
      return { ...x, key, type, amt, dup: "kart", sel: false, cat: "Diğer gelir", contactId: "" };
    }
    let cat = IMP.guessCategory(x.desc, x.amount, learned);
    if (ct && /^Diğer/.test(cat) && byContact[ct.id + "|" + type]) cat = byContact[ct.id + "|" + type];
    return { ...x, key, type, amt, dup: exact ? "var" : maybe ? "olası" : "", sel: !exact && !maybe, cat, contactId: ct ? ct.id : "" };
  });
}
function impBalanceInfo() {
  const it = imp.items.filter(x => x.balance != null); if (!it.length) return null;
  const desc = it.length > 1 && it[0].date > it[it.length - 1].date;
  const maxD = it.reduce((m, x) => x.date > m ? x.date : m, "");
  const sameDay = it.filter(x => x.date === maxD);
  const latest = desc ? sameDay[0] : sameDay[sameDay.length - 1];
  const a = acc(imp.accountId); if (!a) return null;
  const after = balanceOf(a) + sum(imp.items.filter(x => x.sel), x => x.amount);
  return { bank: latest.balance, after, diff: Math.round((latest.balance - after) * 100) / 100, date: latest.date };
}
function renderImport() {
  const m = imp.map, H = imp.headers;
  const colOpts = (sel, blank) => `<option value="-1">${blank || "— yok —"}</option>` + H.map((h, i) => `<option value="${i}" ${+sel === i ? "selected" : ""}>${esc(h || `Sütun ${i + 1}`)}</option>`).join("");
  const items = imp.items, sel = items.filter(x => x.sel);
  const inc = sum(sel.filter(x => x.amount > 0), x => x.amount), exp = sum(sel.filter(x => x.amount < 0), x => -x.amount);
  const dates = items.map(x => x.date).sort();
  const bi = impBalanceInfo();
  const cats = ALLCATS();
  const dupN = items.filter(x => x.dup && x.dup !== "kart").length;
  const body = `<div class="form" id="impPanel">
    <p style="margin:0"><b>${esc(imp.fileName)}</b> · ${esc(acc(imp.accountId)?.name || "")}<br><span class="muted" style="font-size:.88rem">${items.length ? `${items.length} hareket bulundu · ${dshort(dates[0])} – ${dshort(dates[dates.length - 1])}` : "Hareket bulunamadı. Aşağıdan sütunları kontrol et."}${dupN ? ` · ${dupN} tanesi zaten kayıtlı olabilir` : ""}</span></p>
    <details ${items.length ? "" : "open"}><summary style="cursor:pointer;font-weight:600">Sütun eşleştirme ${items.length ? `<span class="pill pos">otomatik bulundu</span>` : `<span class="pill warn">kontrol et</span>`}</summary>
      <div class="form" style="margin-top:10px">
        <div class="f2"><label>Başlık satırı<input id="imp-h" type="number" min="1" max="${imp.rows.length}" value="${imp.hIdx + 1}"></label>
        <label>Tarih<select id="imp-date">${colOpts(m.date)}</select></label></div>
        <div class="f2"><label>Açıklama<select id="imp-desc">${colOpts(m.desc)}</select></label>
        <label>Tutar biçimi<select id="imp-mode">${opt([["signed", "Tek sütun (+ / −)"], ["split", "Ayrı Borç ve Alacak sütunları"], ["dir", "Tutar + Borç/Alacak (B/A) sütunu"]], m.mode)}</select></label></div>
        <div class="f2">${m.mode === "split" ? `<label>Borç (çıkan)<select id="imp-debit">${colOpts(m.debit)}</select></label><label>Alacak (giren)<select id="imp-credit">${colOpts(m.credit)}</select></label>`
      : `<label>Tutar<select id="imp-amount">${colOpts(m.amount)}</select></label>${m.mode === "dir" ? `<label>B/A sütunu<select id="imp-dir">${colOpts(m.dir)}</select></label>` : `<label>Bakiye (isteğe bağlı)<select id="imp-bal">${colOpts(m.balance)}</select></label>`}`}</div>
        <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="imp-inv" style="width:auto" ${m.invert ? "checked" : ""}> Gelir ve giderleri ters çevir <span class="muted">(kredi kartı ekstrelerinde harcamalar artı görünüyorsa)</span></label>
        <p class="small-note" style="margin:0">Bu eşleştirme bu bankanın dosyaları için hatırlanır.</p>
      </div></details>
    ${bi ? `<div class="notice ${Math.abs(bi.diff) < 0.01 ? "" : "warn"}" style="margin:0"><span>${Math.abs(bi.diff) < 0.01 ? `<b>Bakiye tutuyor.</b> Bankadaki bakiye (${dshort(bi.date)}) ile uygulamadaki bakiye aynı: <b class="num">${money(bi.bank)}</b>` : `<b>Bakiye farkı var.</b> Bankada <b class="num">${money(bi.bank)}</b>, içe aktarma sonrası uygulamada <b class="num">${money(bi.after)}</b> olacak (fark ${signed(bi.diff)}).<br><label style="display:flex;gap:8px;align-items:center;margin-top:6px;color:var(--ink);font-size:.9rem"><input type="checkbox" id="imp-fix" style="width:auto" ${imp.fixOpening ? "checked" : ""}> Açılış bakiyesini düzelterek eşitle (${money((+acc(imp.accountId).opening || 0) + bi.diff)})</label>`}</span></div>` : ""}
    ${items.length ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <label style="display:flex;gap:8px;align-items:center;font-size:.88rem"><input type="checkbox" id="imp-all" style="width:auto" ${sel.length === items.length ? "checked" : ""}> Tümünü seç</label>
      <span class="num" style="font-size:.88rem"><span class="pos">+${money(inc)}</span> · <span class="neg">−${money(exp)}</span></span></div>
    <div class="list" style="max-height:48vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:0 8px">
      ${items.slice(0, 600).map((x, i) => `<div class="row" style="grid-template-columns:auto minmax(0,1fr) auto;opacity:${x.sel ? 1 : .55}">
        <input type="checkbox" class="imp-sel" data-i="${i}" ${x.sel ? "checked" : ""} style="width:auto" aria-label="Seç">
        <div style="min-width:0"><div class="t" style="font-size:.9rem;font-weight:500">${esc(x.desc || "(açıklama yok)")}</div>
          <div class="m">${dshort(x.date)}${x.dup ? ` · <span style="color:var(--warn)">${x.dup === "var" ? "zaten eklendi" : x.dup === "kart" ? "kart ödemesi: gelir değil, bankadan karta transfer olarak gir" : "olası tekrar"}</span>` : ""}${x.contactId ? ` · ${esc(con(x.contactId)?.name || "")}` : ""}</div>
          <select class="imp-cat" data-i="${i}" style="margin-top:4px;padding:4px 6px;font-size:.82rem;width:auto;max-width:100%">${cats.map(c => `<option ${c === x.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="amt ${x.amount > 0 ? "pos" : "neg"}" style="font-size:.92rem">${x.amount > 0 ? "+" : "−"}${money(x.amt)}</div></div>`).join("")}
    </div>${items.length > 600 ? `<p class="small-note">İlk 600 satır gösteriliyor; hepsi eklenecek.</p>` : ""}` : ""}
    <div class="foot"><button type="button" class="btn" data-act="import-stmt">Başka dosya</button><div class="r"><button type="button" class="btn" data-close>Vazgeç</button>
      <button type="button" class="btn primary" data-act="imp-commit" ${sel.length || imp.fixOpening ? "" : "disabled"}>${sel.length} işlemi ekle</button></div></div>
  </div>`;
  if ($("#impPanel")) { const sc = $("#impPanel .list")?.scrollTop; $("#impPanel").outerHTML = body; if (sc && $("#impPanel .list")) $("#impPanel .list").scrollTop = sc; }
  else openSheet("Ekstreyi kontrol et", body);
}
function impMapChanged() {
  const g = id => { const el = $(id); return el ? +el.value : undefined; };
  const m = imp.map;
  const h = g("#imp-h"); if (h && h - 1 !== imp.hIdx && h >= 1 && h <= imp.rows.length) { imp.hIdx = h - 1; imp.headers = (imp.rows[imp.hIdx] || []).map(x => String(x ?? "").trim()); imp.sig = IMP.headerSignature(imp.headers); Object.assign(m, IMP.guessMapping(imp.headers, imp.rows.slice(imp.hIdx + 1))); }
  else {
    for (const [id, k] of [["#imp-date", "date"], ["#imp-desc", "desc"], ["#imp-amount", "amount"], ["#imp-debit", "debit"], ["#imp-credit", "credit"], ["#imp-dir", "dir"], ["#imp-bal", "balance"]]) { const v = g(id); if (v !== undefined) m[k] = v; }
    const inv = $("#imp-inv"); if (inv) m.invert = inv.checked;
    const mode = $("#imp-mode")?.value; if (mode && mode !== m.mode) { m.mode = mode; if (mode === "split") { m.debit = m.debit >= 0 ? m.debit : m.amount; } }
  }
  buildImpItems(); renderImport();
}
async function commitImport() {
  const sel = imp.items.filter(x => x.sel), bi = impBalanceInfo();
  const txs = sel.map(x => ({ id: uid8(), type: x.type, amount: x.amt, date: x.date, category: x.cat, accountId: imp.accountId, contactId: x.contactId || "", note: x.desc.slice(0, 140), importKey: x.key }));
  const a = acc(imp.accountId), fix = imp.fixOpening && bi && Math.abs(bi.diff) >= 0.01 ? Math.round(((+a.opening || 0) + bi.diff) * 100) / 100 : null;
  ls.set("kd-map:" + imp.sig, JSON.stringify(imp.map)); ls.set("kd-imp-acc", imp.accountId);
  if (live()) {
    const ops = txs.map(t => { const { id, ...d } = t; return { type: "set", col: "txns", id, data: d }; });
    if (fix != null) { const { id, ...d } = { ...a, opening: fix }; ops.push({ type: "set", col: "accounts", id, data: d }); }
    const ok = await safe(() => batchWrite(ops), `${txs.length} işlem eklendi`);
    if (!ok) return; Drive.dirty();
  } else {
    S.txns.push(...txs); if (fix != null) a.opening = fix; saveDemo(); render(); toast(`${txs.length} işlem eklendi`);
  }
  imp = null; closeSheet(); ui.tab = "islemler"; ls.set("kd-tab", "islemler"); render();
}

function submitForm(f) {
  const kind = f.dataset.kind, id = f.dataset.id; const v = s => (f.querySelector(s)?.value || "").trim();
  if (["txn", "plan", "complete"].includes(kind)) { const n = parseAmt(v("#f-amount")); if (!(n > 0)) { toast("Geçerli bir tutar gir (örn. 1.250,50)."); return; } }
  if (kind === "rename-group") {
    const nn = v("#f-gname"); if (!nn) return;
    const list = accountGroups().find(g => g.name === id)?.list || [];
    list.forEach(x => put("accounts", { ...x, group: nn }));
    toast(`${list.length} hesap "${nn}" grubuna taşındı`); closeSheet(); return;
  }
  if (kind === "txn") {
    const type = v("#f-type"); const o = { id: id || uid8(), type, amount: parseAmt(v("#f-amount")), date: v("#f-date"), accountId: v("#f-acc"), note: v("#f-note") };
    if (type === "transfer") { o.toAccountId = v("#f-to"); o.category = "Transfer"; o.contactId = ""; if (o.toAccountId === o.accountId) { toast("Çıkış ve giriş hesabı farklı olmalı."); return; } }
    else { o.category = v("#f-cat") || "Diğer"; o.contactId = v("#f-con"); }
    const old = S.txns.find(x => x.id === id); if (old && old.planId) o.planId = old.planId;
    put("txns", o); toast(id ? "İşlem güncellendi" : "İşlem kaydedildi"); closeSheet();
  } else if (kind === "plan") {
    const old = S.plans.find(x => x.id === id);
    const o = { ...(old || {}), id: id || uid8(), dir: v("#f-dir"), amount: parseAmt(v("#f-amount")), due: v("#f-due"), contactId: v("#f-con"), category: v("#f-cat") || "Diğer", repeat: v("#f-rep"), note: v("#f-note"), status: old?.status || "bekliyor" };
    put("plans", o); toast(id ? "Vade güncellendi" : "Vade eklendi"); closeSheet();
  } else if (kind === "account") {
    const o = { id: id || uid8(), name: v("#f-name"), group: v("#f-group") || inferGroup(v("#f-name")), kind: v("#f-kind"), opening: parseAmt(v("#f-open")) || 0 };
    ui.newGroup = ""; ui.newKind = "";
    if (!o.name) { toast("Hesap adı gir."); return; }
    put("accounts", o); toast(id ? "Hesap güncellendi" : "Hesap eklendi"); closeSheet();
  } else if (kind === "contact") {
    const o = { id: id || uid8(), name: v("#f-name"), kind: v("#f-kind"), phone: v("#f-phone"), note: v("#f-note") };
    if (!o.name) { toast("Cari adı gir."); return; }
    put("contacts", o); toast(id ? "Cari güncellendi" : "Cari eklendi"); closeSheet();
  } else if (kind === "complete") {
    const p = S.plans.find(x => x.id === id); if (!p) return closeSheet();
    const date = v("#f-date"), amount = parseAmt(v("#f-amount"));
    put("txns", { id: uid8(), type: p.dir === "tahsilat" ? "gelir" : "gider", amount, date, category: p.category || "Diğer", accountId: v("#f-acc"), contactId: p.contactId || "", note: p.note || "", planId: p.id });
    put("plans", { ...p, status: "tamam", doneDate: date, paidAmount: amount });
    if (p.repeat === "aylık") { const { doneDate, paidAmount, ...rest } = p; put("plans", { ...rest, id: uid8(), due: addMonths(p.due, 1), status: "bekliyor" }); }
    toast(p.dir === "tahsilat" ? "Tahsilat kaydedildi" : "Ödeme kaydedildi"); closeSheet();
  }
}
function deleteFromForm(f, btn) {
  if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Silmeyi onayla"; return; }
  const kind = f.dataset.kind, id = f.dataset.id;
  if (kind === "account" && S.txns.some(t => t.accountId === id || t.toAccountId === id)) { toast("Bu hesapta işlem var. Önce işlemleri sil veya başka hesaba taşı."); return; }
  remove({ txn: "txns", plan: "plans", account: "accounts", contact: "contacts" }[kind], id); toast("Silindi"); closeSheet();
}

/* ---------- events ---------- */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; renderNotice(); });
window.addEventListener("appinstalled", () => { installEvt = null; renderNotice(); toast("Kasa Defteri yüklendi"); });
window.addEventListener("online", () => { renderChips(); if (live()) Drive.dirty(); });
window.addEventListener("offline", renderChips);
document.addEventListener("visibilitychange", () => { if (!document.hidden && iso(new Date()) !== TODAY) render(); });

document.addEventListener("click", async e => {
  const el = e.target.closest("button,[data-edit-txn],[data-edit-plan],[data-edit-account],[data-show-contact],.overlay");
  if (!el) return;
  if (el.id === "ov" && e.target === el) return closeSheet();
  const d = el.dataset;
  if (d.tab) { ui.tab = d.tab; ls.set("kd-tab", d.tab); closeSheet(); render(); window.scrollTo({ top: 0 }); return; }
  if (el.hasAttribute("data-close")) return closeSheet();
  if (el.hasAttribute("data-del")) { const f = el.closest("form"); if (f) deleteFromForm(f, el); return; }
  if (d.ttype) {
    const f = $("#frm"), cur = f.dataset.id ? S.txns.find(x => x.id === f.dataset.id) : null;
    const keep = { amount: parseAmt($("#f-amount").value), date: $("#f-date").value, accountId: $("#f-acc").value, note: $("#f-note").value };
    txnForm({ ...(cur || {}), ...keep, type: d.ttype }, d.ttype); return;
  }
  if (d.pdir) { $("#f-dir").value = d.pdir; el.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === el)); const dl = $("#dl-cat"); if (dl) dl.outerHTML = catList("dl-cat", d.pdir === "tahsilat" ? "gelir" : "gider"); return; }
  if (d.pv) { ui.planView = d.pv; return render(); }
  if (d.period) { ui.period = d.period; return render(); }
  if (d.complete) { const p = S.plans.find(x => x.id === d.complete); if (p) completeForm(p); return; }
  if (d.editTxn) { const t = S.txns.find(x => x.id === d.editTxn); if (t) txnForm(t); return; }
  if (d.editPlan) { const p = S.plans.find(x => x.id === d.editPlan); if (p) planForm(p); return; }
  if (d.editAccount) { const a = acc(d.editAccount); if (a) accountForm(a); return; }
  if (d.editContact) { const c = con(d.editContact); if (c) contactForm(c); return; }
  if (d.showContact) { const c = con(d.showContact); if (c) contactDetail(c); return; }
  if (d.toggleGroup) { let c = {}; try { c = JSON.parse(ls.get("kd-collapsed") || "{}"); } catch (e) { } c[d.toggleGroup] = !c[d.toggleGroup]; ls.set("kd-collapsed", JSON.stringify(c)); return render(); }
  if (d.newInGroup) { ui.newGroup = d.newInGroup; return accountForm(); }
  if (d.renameGroup) return renameGroup(d.renameGroup);
  if (d.planFor) { planForm({ contactId: d.planFor, dir: "tahsilat" }); return; }
  if (el.id === "addBtn") return newMenu();
  const a = d.act; if (!a) return;
  if (a === "signin") return signIn();
  if (a === "signout") return signOutNow();
  if (a === "account") return accountPanel();
  if (a === "install") { if (installEvt) { installEvt.prompt(); installEvt = null; renderNotice(); } return; }
  if (a === "new-gelir") return txnForm(null, "gelir");
  if (a === "new-gider" || a === "new-txn") return txnForm(null, "gider");
  if (a === "new-transfer") { if (S.accounts.length < 2) { toast("Transfer için en az iki hesap gerekli."); return; } return txnForm(null, "transfer"); }
  if (a === "new-plan") return planForm();
  if (a === "new-account") return accountForm();
  if (a === "new-contact") return contactForm();
  if (a === "csv") return exportCsv();
  if (a === "import-stmt") return openImport(imp && imp.accountId);
  if (a === "imp-pick") { imp.accountId = $("#imp-acc").value; $("#stmtFile").value = ""; $("#stmtFile").click(); return; }
  if (a === "imp-commit") { el.disabled = true; el.textContent = "Ekleniyor…"; await commitImport(); return; }
  if (a === "export-json") return saveFile(`kasa-defteri-yedek-${TODAY}.json`, JSON.stringify(snapshotData(), null, 1), "application/json");
  if (a === "import") { $("#importFile").value = ""; $("#importFile").click(); return; }
  if (a === "seed") {
    if (mode === "demo") { S = buildSample(); saveDemo(); render(); return; }
    el.disabled = true; el.textContent = "Yükleniyor…"; if (!(await seedSample())) { el.disabled = false; el.textContent = "Örnek verilerle dene"; } return;
  }
  if (a === "wipe") { $("#wipeSlot").innerHTML = `<span style="display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn small danger" data-act="wipe-yes">Evet, hepsini sil</button><button class="btn small" data-act="wipe-no">Vazgeç</button></span>`; return; }
  if (a === "wipe-no") return renderNotice();
  if (a === "wipe-yes") { el.disabled = true; el.textContent = "Siliniyor…"; await wipeAll(); return; }
  if (a === "drive") return drivePanel();
  if (a === "drive-save") { clearTimeout(Drive.timer); await Drive.save(true); return; }
  if (a === "drive-restore") {
    if (mode === "demo") { toast("Drive yedeği için önce Firebase'i ayarla."); return; }
    if (!$("#restoreSlot")) { // boş ekrandan: doğrudan yükle
      el.disabled = true; try { const data = await Drive.download(); if (!data) { toast("Drive'da yedek bulunamadı."); } else await importData(data, "Drive yedeği"); } catch (err) { toast(Drive.errText(err)); } el.disabled = false; return;
    }
    $("#restoreSlot").innerHTML = `<span style="display:inline-flex;gap:6px;flex-wrap:wrap"><button class="btn danger" data-act="drive-restore-yes">Evet, Drive kopyasını yükle</button><button class="btn" data-act="drive-panel">Vazgeç</button></span>`; return;
  }
  if (a === "drive-panel") return drivePanel();
  if (a === "drive-restore-yes") {
    el.disabled = true; el.textContent = "Yükleniyor…";
    try { const data = await Drive.download(); if (!data) { toast("Drive'da yedek bulunamadı."); drivePanel(); return; } if (await importData(data, "Drive yedeği")) closeSheet(); }
    catch (err) { toast(Drive.errText(err)); drivePanel(); }
    return;
  }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.dataset.kind === "pdfpw") { const pw = $("#pdf-pw").value; if (imp && imp.file) { closeSheet(); readStatement(imp.file, pw); } return; }
  submitForm(e.target);
});
document.addEventListener("input", e => { if (e.target.id === "fq") { ui.q = e.target.value; ui._focusQ = true; render(); } });
document.addEventListener("change", async e => {
  if (e.target.id === "ftype") { ui.ftype = e.target.value; render(); }
  else if (e.target.id === "facc") { ui.facc = e.target.value; render(); }
  else if (e.target.id === "stmtFile") { const f = e.target.files && e.target.files[0]; if (f) readStatement(f); }
  else if (e.target.id === "imp-acc" && imp) { imp.accountId = e.target.value; }
  else if (e.target.closest && e.target.closest("#impPanel")) {
    const t = e.target, i = t.dataset.i != null ? +t.dataset.i : -1;
    if (t.classList.contains("imp-sel")) { imp.items[i].sel = t.checked; renderImport(); }
    else if (t.classList.contains("imp-cat")) { // aynı açıklamalı diğer satırlara da uygula
      const k = IMP.learnKey(imp.items[i].desc), prev = imp.items[i].cat; let n = 0;
      imp.items.forEach((x, j) => { if (j === i || (k && IMP.learnKey(x.desc) === k && x.cat === prev)) { x.cat = t.value; if (j !== i) n++; } });
      if (n) { renderImport(); toast(`Benzer ${n} satır da "${t.value}" yapıldı`); }
    }
    else if (t.id === "imp-all") { imp.items.forEach(x => { x.sel = t.checked && x.dup !== "var"; }); renderImport(); }
    else if (t.id === "imp-fix") { imp.fixOpening = t.checked; renderImport(); }
    else if (/^imp-/.test(t.id)) impMapChanged();
  }
  else if (e.target.id === "importFile") {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); if (await importData(data, "Yedek dosyası")) closeSheet(); }
    catch (err) { toast("Dosya okunamadı. Kasa Defteri'nin .json yedeğini seç."); }
  }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#ov")) closeSheet(); });

let tt; function toast(m) { clearTimeout(tt); $("#toastRoot").innerHTML = `<div class="toast" role="status">${esc(m)}</div>`; tt = setTimeout(() => { $("#toastRoot").innerHTML = ""; }, 3400); }

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => { }));
}
if (configured) renderLogin(); // Firebase yüklenirken giriş kartı (düğme pasif) görünür
boot();
