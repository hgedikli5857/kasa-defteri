// Kasa Defteri — PWA sürümü
// Veri: Firebase Firestore (anlık senkron + çevrimdışı), giriş: Google (Firebase Auth), yedek: Google Drive (drive.file)
import { firebaseConfig } from "./firebase-config.js";
import * as IMP from "./importer.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
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
/* --- taksit: alışveriş bir kez (toplam tutar) kaydedilir; analiz ve dönem hesabı aylara böler --- */
const instN = t => t && t.type === "gider" && +t.inst > 1 ? +t.inst : 0;
function instPieces(t) {
  const n = instN(t); if (!n) return [t];
  const per = Math.round(t.amount / n * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({ ...t, amount: i === n - 1 ? Math.round((t.amount - per * (n - 1)) * 100) / 100 : per, date: addMonths(t.date, i), instK: i + 1, instOf: t.id }));
}
const MOVE_CAT = "Hesaplar arası"; // kendi hesapları arasındaki para: gelir/gider analizine girmez
const isMove = t => t && t.category === MOVE_CAT;
const spreadTx = list => list.filter(t => !isMove(t)).flatMap(instPieces);
const mySurname = () => { const n = (user && user.displayName) || ""; return n.trim().split(/\s+/).pop() || ""; };
// birleşmiş tutar: 79999799.99 → 799.99 (ekstrede iki sütun yan yana okunmuştu)
const splitDup = v => { const c = String(Math.round(Math.abs(v) * 100)), h = c.length / 2; return c.length >= 8 && c.length % 2 === 0 && c.slice(0, h) === c.slice(h) ? +c.slice(0, h) / 100 : null; };
const INST_OPTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 24, 36];
function instInfo(d) { // ekstre satırı: "2/6 TAKSİT", "TAKSİT 2/6", "409,90 TL'LİK İŞLEMİN 2/2 TAKSİTİ"
  const U = String(d || "").toLocaleUpperCase("tr");
  const m = U.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\.?\s*TAKS/) || U.match(/TAKS[İI]T\S*\s*:?\s*(?:NO\s*:?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (!m) return null; const k = +m[1], n = +m[2]; if (!(n > 1 && n <= 48 && k >= 1 && k <= n)) return null;
  const tm = U.match(/([\d.]+,\d{2})\s*TL['’]?\s*L[İI]K/); return { k, n, total: tm ? IMP.parseAmount(tm[1]) : null };
}
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
const parseAmt = v => { let s = String(v || "").replace(/[^\d.,-]/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); const n = parseFloat(s); return isFinite(n) ? Math.round(n * 1000) / 1000 : NaN; };
const uid8 = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 16);
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, del(k) { try { localStorage.removeItem(k); } catch (e) { } } };

const CATS = {
  gelir: ["Satış", "Hizmet geliri", "Danışmanlık", "Komisyon", "Faiz geliri", "Diğer gelir"],
  gider: ["Kira", "Personel", "Faturalar", "Lojistik", "Pazarlama", "Vergi / SGK", "Yazılım", "Ofis", "Ulaşım", "Market / Gıda", "Giyim", "Yapı market / Ev", "Elektronik", "Sağlık", "Kişisel bakım", "Eğlence / Abonelik", "Online alışveriş", "Eğitim", "Banka masrafı", "Diğer gider"]
};
const COLS = ["accounts", "contacts", "txns", "plans"];
const configured = firebaseConfig && firebaseConfig.apiKey && !/^BURAYA/.test(firebaseConfig.apiKey);

/* ---------- sample data (relative to today) ---------- */
function buildSample() {
  const A = [{ id: "a1", name: "Bankomat", group: "Ziraat", kind: "banka", opening: 42500 }, { id: "a4", name: "Yatırım hesabı", group: "Ziraat", kind: "yatırım", opening: 75000 },
    { id: "a2", name: "Ticari vadesiz", group: "Garanti BBVA", kind: "banka", opening: 18200 }, { id: "a5", name: "Bonus Kart", group: "Garanti BBVA", kind: "kredi kartı", opening: -6200, limit: 30000 },
    { id: "a6", name: "Altın hesabı", group: "Ziraat", kind: "birikim", asset: "GRA", opening: 25 }, { id: "a7", name: "Dolar hesabı", group: "Garanti BBVA", kind: "banka", asset: "USD", opening: 1500 },
    { id: "a3", name: "Nakit Kasa", group: "Nakit", kind: "nakit", opening: 3750 }, { id: "a8", name: "Çeyrekler", group: "Nakit", kind: "birikim", asset: "CEYREKALTIN", opening: 6 }];
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
    push({ type: "gider", amount: Math.round(1600 + rnd(m + 13) * 900), date: day(15), category: "Faturalar", sub: "Elektrik", accountId: "a2", contactId: "", note: "ENERJISA ELEKTRIK" });
    push({ type: "gider", amount: Math.round(900 + rnd(m + 21) * (m === 0 ? 6800 : 2200)), date: day(9), category: "Giyim", sub: "Kıyafet", accountId: "a1", contactId: "", note: m % 2 ? "LC WAIKIKI ISTANBUL" : "KOTON AVM" });
    push({ type: "gider", amount: Math.round(2400 + rnd(m + 23) * 1600), date: day(13), category: "Market / Gıda", sub: "Market", accountId: "a1", contactId: "", note: "MIGROS KADIKOY" });
    push({ type: "gider", amount: Math.round(700 + rnd(m + 27) * 900), date: day(21), category: "Market / Gıda", sub: "Restoran / Kafe", accountId: "a3", contactId: "", note: "STARBUCKS" });
    if (m % 2 === 0) push({ type: "gider", amount: Math.round(600 + rnd(m + 29) * 2600), date: day(18), category: "Yapı market / Ev", sub: "Malzeme / hırdavat", accountId: "a2", contactId: "", note: "KOCTAS ATASEHIR" });
    push({ type: "gider", amount: Math.round(300 + rnd(m + 31) * 500), date: day(16), category: "Sağlık", sub: "Eczane", accountId: "a3", contactId: "", note: "ECZANE" });
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
// Kart/kredi hesaplarında bankadan alınan "kalan limit" bir sabit noktadır (syncBal @ syncDate):
// o tarihe kadarki işlemler bankanın rakamına zaten dahildir; yalnızca sonraki işlemler bakiyeyi değiştirir.
const anchored = a => a && a.syncDate && a.syncBal != null;
function balanceOf(a) {
  const anc = anchored(a), skip = anc ? new Set(a.syncIds || []) : null;
  let b = anc ? +a.syncBal : (+a.opening || 0);
  for (const t of S.txns) {
    if (anc && (t.date < a.syncDate || (t.date === a.syncDate && skip.has(t.id)) || (t.date === a.syncDate && t.importKey))) continue;
    if (t.type === "gelir" && t.accountId === a.id) b += t.amount;
    else if (t.type === "gider" && t.accountId === a.id) b -= t.amount;
    else if (t.type === "transfer") { if (t.accountId === a.id) b -= t.amount; if (t.toAccountId === a.id) b += (t.toAmount != null ? t.toAmount : t.amount); }
  }
  return b;
}
// a.excl: toplamlara (net pozisyon, varlıklar) dahil değil · a.hide: Özet'te gösterilmez
const inTotal = a => !a.excl;
const totalCash = () => sum(S.accounts.filter(inTotal), a => valueTRY(a));
const exclTotal = () => sum(S.accounts.filter(a => a.excl), a => valueTRY(a));
/* --- para birimleri ve kıymetli madenler --- */
const ASSETS = [
  ["TRY", "Türk lirası", "₺", "Para"], ["USD", "ABD doları", "$", "Para"], ["EUR", "Euro", "€", "Para"], ["GBP", "İngiliz sterlini", "£", "Para"], ["CHF", "İsviçre frangı", "CHF", "Para"], ["SAR", "Suudi riyali", "SAR", "Para"],
  ["GRA", "Gram altın (24 ayar)", "gr", "Altın"], ["YIA", "22 ayar bilezik", "gr", "Altın"], ["18AYARALTIN", "18 ayar altın", "gr", "Altın"], ["14AYARALTIN", "14 ayar altın", "gr", "Altın"],
  ["CEYREKALTIN", "Çeyrek altın", "adet", "Altın"], ["YARIMALTIN", "Yarım altın", "adet", "Altın"], ["TAMALTIN", "Tam altın", "adet", "Altın"], ["CUMHURIYETALTINI", "Cumhuriyet altını", "adet", "Altın"],
  ["ATAALTIN", "Ata altın", "adet", "Altın"], ["RESATALTIN", "Reşat altın", "adet", "Altın"], ["GREMSEALTIN", "Gremse altın", "adet", "Altın"],
  ["GUMUS", "Gümüş", "gr", "Gümüş"]
];
const assetOf = code => ASSETS.find(x => x[0] === code) || ASSETS[0];
const accAsset = a => (a && a.asset) || "TRY";
const unitOf = code => assetOf(code)[2];
const DEMO_RATES = { USD: 49.03, EUR: 55.63, GBP: 65.9, CHF: 61.5, SAR: 13.07, GRA: 6606, YIA: 6040, "18AYARALTIN": 4950, "14AYARALTIN": 3860, CEYREKALTIN: 10850, YARIMALTIN: 21700, TAMALTIN: 43300, CUMHURIYETALTINI: 44100, ATAALTIN: 45200, RESATALTIN: 45500, GREMSEALTIN: 108000, GUMUS: 96.7 };
const RATES = { auto: {}, date: null, fetchedAt: 0, manual: {}, failed: false };
try { const c = JSON.parse(ls.get("kd-rates") || "null"); if (c && c.auto) Object.assign(RATES, { auto: c.auto, date: c.date, fetchedAt: c.fetchedAt || 0 }); } catch (e) { }
try { RATES.manual = JSON.parse(ls.get("kd-manual-rates") || "{}"); } catch (e) { }
const RATE_URL = "https://finans.truncgil.com/v4/today.json";
async function fetchRates(force) {
  if (!force && RATES.fetchedAt && Date.now() - RATES.fetchedAt < 15 * 60e3) return;
  try {
    const r = await fetch(RATE_URL, { cache: "no-store" }); if (!r.ok) throw new Error(r.status);
    const j = await r.json(), auto = {};
    for (const [code] of ASSETS) if (code !== "TRY" && j[code] && +j[code].Buying > 0) auto[code] = +j[code].Buying;
    if (!Object.keys(auto).length) throw new Error("boş");
    Object.assign(RATES, { auto, date: j.Update_Date || new Date().toISOString(), fetchedAt: Date.now(), failed: false, retries: 0 });
    ls.set("kd-rates", JSON.stringify({ auto, date: RATES.date, fetchedAt: RATES.fetchedAt }));
    if (force) toast("Kurlar güncellendi");
  } catch (e) {
    // yedek: dövizler için ikinci kaynak (altın kurları son bilinen / elle girilen değerle kalır)
    try {
      const r2 = await fetch("https://open.er-api.com/v6/latest/TRY", { cache: "no-store" }); const j2 = await r2.json();
      if (j2 && j2.rates) { const auto = { ...RATES.auto }; for (const c of ["USD", "EUR", "GBP", "CHF", "SAR"]) if (+j2.rates[c] > 0) auto[c] = Math.round(1 / j2.rates[c] * 10000) / 10000;
        Object.assign(RATES, { auto, fetchedAt: Date.now() - 10 * 60e3, failed: true }); ls.set("kd-rates", JSON.stringify({ auto, date: RATES.date, fetchedAt: RATES.fetchedAt })); }
    } catch (_) { RATES.failed = true; }
    if (!force && (RATES.retries || 0) < 2) { RATES.retries = (RATES.retries || 0) + 1; setTimeout(() => { RATES.fetchedAt = 0; fetchRates(); }, 45e3 * RATES.retries); }
    if (force) toast("Altın kurları şu an alınamadı; son bilinen kurlar kullanılıyor. İstersen Kurlar ekranından elle gir.");
  }
  render(); if ($("#ratesPanel")) ratesPanel();
}
const rateOf = code => code === "TRY" ? 1 : (+RATES.manual[code] || RATES.auto[code] || DEMO_RATES[code] || null);
const rateSource = code => code === "TRY" ? "" : +RATES.manual[code] ? "elle" : RATES.auto[code] ? "canlı" : "örnek";
const valueTRY = a => { const r = rateOf(accAsset(a)); return r == null ? 0 : balanceOf(a) * r; };
const usesForeign = () => S.accounts.some(a => accAsset(a) !== "TRY");
const nfU = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
function fmtAsset(n, code) {
  code = code || "TRY";
  if (code === "TRY") return money(n);
  const [, , unit, grp] = assetOf(code);
  if (grp === "Para") { try { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(n || 0); } catch (e) { return nfU.format(n || 0) + " " + unit; } }
  return nfU.format(n || 0) + " " + unit;
}
const txAsset = t => accAsset(acc(t.accountId));
const txTRY = t => { const c = txAsset(t); if (c === "TRY") return t.amount; return t.amount * (+t.rate || rateOf(c) || 0); };
const assetOptions = sel => ["Para", "Altın", "Gümüş"].map(g => `<optgroup label="${g}">${ASSETS.filter(x => x[3] === g).map(([c, l, u]) => `<option value="${c}" ${c === (sel || "TRY") ? "selected" : ""}>${esc(l)}${u.length <= 4 && g !== "Para" ? " (" + u + ")" : ""}</option>`).join("")}</optgroup>`).join("");

/* --- kategoriler ve alt kategoriler --- */
const DEFAULT_SUBS = { "Giyim": ["Kıyafet", "Ayakkabı", "Aksesuar"], "Yapı market / Ev": ["Malzeme / hırdavat", "Mobilya / dekorasyon", "Ev tekstili"], "Sağlık": ["Eczane", "Hastane / doktor"], "Eğlence / Abonelik": ["Dijital abonelik", "Sinema / etkinlik"], "Elektronik": ["Telefon / bilgisayar", "Beyaz eşya"], "Faturalar": ["Elektrik", "Su", "Doğalgaz", "İnternet", "Telefon"], "Ulaşım": ["Akaryakıt", "Toplu taşıma", "Otopark / HGS", "Araç bakım"], "Market / Gıda": ["Market", "Restoran / Kafe"], "Vergi / SGK": ["SGK", "Vergi"], "Personel": ["Maaş", "Prim"], "Pazarlama": ["Reklam", "Basılı malzeme"], "Yazılım": ["Abonelik"], "Banka masrafı": ["Kart aidatı", "EFT / havale"] };
const defaultCats = () => ({ gelir: CATS.gelir.map(n => ({ n, s: [...(DEFAULT_SUBS[n] || [])] })), gider: CATS.gider.map(n => ({ n, s: [...(DEFAULT_SUBS[n] || [])] })) });
function catsObj() {
  if (live() && meta.cats && meta.cats.gelir) return meta.cats;
  if (!live()) { try { const c = JSON.parse(ls.get("kd-cats") || "null"); if (c && c.gelir) return c; } catch (e) { } }
  return defaultCats();
}
function saveCats(o) {
  if (live()) { meta.cats = o; fb.fs.setDoc(metaRef(), { cats: clean(o) }, { merge: true }).catch(e => toast(failMsg(e))); }
  else ls.set("kd-cats", JSON.stringify(o));
  render();
}
const catKind = type => type === "gelir" || type === "tahsilat" ? "gelir" : "gider";
function catNames(type) {
  const k = catKind(type), list = catsObj()[k].map(c => c.n);
  const used = [...S.txns.filter(t => t.type === k), ...S.plans.filter(p => catKind(p.dir) === k)].map(t => t.category).filter(Boolean);
  return [...new Set([...list, ...used, MOVE_CAT])].filter(c => c !== "Transfer");
}
const subsOf = (type, cat) => (catsObj()[catKind(type)].find(c => c.n === cat) || { s: [] }).s;
const catLabel = t => t.sub ? `${t.category} › ${t.sub}` : (t.category || "");
const catOptions = (type, sel) => catNames(type).map(c => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="__new">＋ Yeni kategori…</option>`;
const subOptions = (type, cat, sel) => `<option value="">— yok —</option>` + [...new Set([...subsOf(type, cat), ...(sel ? [sel] : [])])].map(s => `<option ${s === sel ? "selected" : ""}>${esc(s)}</option>`).join("") + (cat && cat !== "__new" ? `<option value="__new">＋ Yeni alt kategori…</option>` : "");
const catFields = (type, cat, sub) => {
  const c = cat || catNames(type)[0] || "";
  return `<div class="f2"><label>Kategori<select id="f-cat" data-ctype="${catKind(type)}">${catOptions(type, c)}</select><input id="f-cat-new" placeholder="Yeni kategori adı" hidden></label>
    <label>Alt kategori<select id="f-sub">${subOptions(type, c, sub)}</select><input id="f-sub-new" placeholder="Yeni alt kategori adı" hidden></label></div>`;
};
function resolveCat(f, type) {
  const k = catKind(type), o = JSON.parse(JSON.stringify(catsObj())); let changed = false;
  let cat = f.querySelector("#f-cat").value, sub = f.querySelector("#f-sub")?.value || "";
  if (cat === "__new") { cat = (f.querySelector("#f-cat-new").value || "").trim(); if (!cat) return null; if (!o[k].some(c => c.n === cat)) { o[k].push({ n: cat, s: [] }); changed = true; } }
  if (sub === "__new") { sub = (f.querySelector("#f-sub-new").value || "").trim(); }
  if (sub) { let c = o[k].find(x => x.n === cat); if (!c) { c = { n: cat, s: [] }; o[k].push(c); changed = true; } if (!c.s.includes(sub)) { c.s.push(sub); changed = true; } }
  if (changed) saveCats(o);
  return { category: cat || "Diğer", sub };
}

const accName = a => { const g = groupOf(a); return a.name.toLocaleUpperCase("tr").includes(g.toLocaleUpperCase("tr")) || g === "Nakit" || g === "Diğer hesaplar" ? a.name : `${g} ${a.name}`; };
/* --- hesap grupları (banka bazında) --- */
const KINDS = [["nakit", "Nakit (cüzdan / kasa / ev)"], ["bes", "BES / emeklilik"], ["banka", "Vadesiz / bankomat"], ["vadeli", "Vadeli mevduat"], ["yatırım", "Yatırım hesabı"], ["kredi kartı", "Kredi kartı"], ["kredi", "Kredi / KMH"], ["birikim", "Birikim / altın / döviz"]];
const isCash = a => a && a.kind === "nakit";
const cashTotal = () => sum(S.accounts.filter(a => isCash(a) && inTotal(a)), valueTRY);
const kindLabel = k => (KINDS.find(x => x[0] === k) || [k, k || "Hesap"])[1].replace(/ \(.*\)$/, "");
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
  const order = ["banka", "vadeli", "yatırım", "birikim", "bes", "kredi kartı", "kredi", "nakit"];
  const out = [...m.entries()].map(([name, list]) => {
    list.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || x.name.localeCompare(y.name, "tr"));
    const bals = list.filter(inTotal).map(valueTRY);
    return { name, list, total: sum(list, valueTRY), inc: sum(bals, x => x), assets: sum(bals, x => x > 0 ? x : 0), debts: sum(bals, x => x < 0 ? -x : 0),
      allEx: list.every(a => a.excl), allHide: list.every(a => a.hide), exN: list.filter(a => a.excl).length, hideN: list.filter(a => a.hide).length };
  });
  const rank = g => g.list.every(isCash) ? 0 : g.name === "Diğer hesaplar" ? 2 : 1; // nakit en üstte
  return out.sort((x, y) => rank(x) - rank(y) || y.assets + y.debts - (x.assets + x.debts));
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
    setTimeout(() => gmailAutoImport(), 8000);
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
  unsubs.push(fb.fs.onSnapshot(metaRef(), s => { meta = s.exists() ? s.data() : {}; Drive.fromMeta(meta); if (meta.manualRates) { RATES.manual = meta.manualRates; ls.set("kd-manual-rates", JSON.stringify(meta.manualRates)); } render(); }, () => { }));
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
  ls.del("kd-gmail-token"); Gmail.token = null; Gmail.list = null;
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

/* ---------- Gmail'den ekstre (gmail.readonly, yalnızca okuma; izin sadece bu düğmeye basınca istenir) ---------- */
const GMAIL_Q = '(ekstre OR "hesap hareket" OR "hesap özeti" OR "hesap ozeti" OR "kart özeti" OR "e-ekstre") newer_than:120d';
const Gmail = {
  token: null, exp: 0, list: null, busy: false, err: "",
  load() { try { const t = JSON.parse(ls.get("kd-gmail-token") || "null"); if (t && user && t.uid === user.uid && t.exp > Date.now() + 60000) { this.token = t.token; this.exp = t.exp; } } catch (e) { } },
  valid() { return this.token && this.exp > Date.now() + 30000; },
  async authorize() {
    try {
      const p = provider(); p.addScope(GMAIL_SCOPE);
      const res = await fb.au.reauthenticateWithPopup(user, p), cred = fb.au.GoogleAuthProvider.credentialFromResult(res);
      if (!cred || !cred.accessToken) throw new Error("izin alınamadı");
      this.token = cred.accessToken; this.exp = Date.now() + 55 * 60 * 1000;
      ls.set("kd-gmail-token", JSON.stringify({ uid: user.uid, token: this.token, exp: this.exp }));
      Drive.takeToken(cred); // aynı jeton Drive için de geçerli
      return true;
    } catch (e) { if (e && e.code !== "auth/popup-closed-by-user") toast("Gmail izni alınamadı: " + (e.message || e.code)); return false; }
  },
  async api(path) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { headers: { Authorization: "Bearer " + this.token } });
    if (r.status === 401) { this.token = null; ls.del("kd-gmail-token"); const e = new Error("Gmail izninin süresi doldu"); e.status = 401; throw e; }
    if (!r.ok) { let m = ""; try { m = (await r.json()).error.message; } catch (_) { } const e = new Error(m || "Gmail hatası " + r.status); e.status = r.status; throw e; }
    return r.json();
  },
  errText(e) {
    if (e && e.status === 401) return "Gmail izninin süresi doldu. Yeniden bağlan.";
    if (e && e.status === 403) return "Gmail erişimi reddedildi. Google Cloud'da Gmail API'yi etkinleştir (README › Gmail).";
    return (e && e.message) || "Gmail okunamadı";
  },
  parts(p, out = []) { if (!p) return out; if (p.filename && p.body && p.body.attachmentId) out.push({ name: p.filename, mime: p.mimeType, id: p.body.attachmentId, size: p.body.size || 0 }); (p.parts || []).forEach(x => this.parts(x, out)); return out; },
  html(p) { if (!p) return ""; if (p.mimeType === "text/html" && p.body && p.body.data) return b64u(p.body.data, true); for (const x of p.parts || []) { const h = this.html(x); if (h) return h; } return ""; },
  async search(q) {
    this.busy = true; this.err = ""; gmailPanel();
    try {
      const r = await this.api("messages?maxResults=25&q=" + encodeURIComponent(q));
      const msgs = await Promise.all((r.messages || []).map(m => this.api("messages/" + m.id + "?format=full")));
      this.list = msgs.map(m => { const h = n => ((m.payload.headers || []).find(x => x.name.toLowerCase() === n) || {}).value || "";
        return { id: m.id, from: h("from"), subject: h("subject"), date: new Date(+m.internalDate), files: this.parts(m.payload).filter(f => /\.(pdf|xlsx?|csv|ods|html?|png|jpe?g|webp)$/i.test(f.name)), hasHtml: /<table/i.test(this.html(m.payload)), payload: m.payload };
      });
    } catch (e) { this.err = this.errText(e); }
    this.busy = false; gmailPanel();
  }
};
function b64u(s, text) { const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/")); const u = Uint8Array.from(bin, c => c.charCodeAt(0)); return text ? new TextDecoder().decode(u) : u; }
const gmailSender = f => ((f || "").match(/<([^>]+)>/) || [, f || ""])[1].toLowerCase();
const gmailPat = (from, name) => gmailSender(from) + "|" + IMP.up(name || "eposta").replace(/[0-9]+/g, "#").replace(/\s+/g, "");
const gmailDone = () => { try { return JSON.parse(ls.get("kd-gmail-done") || "{}"); } catch (e) { return {}; } };
function gmailPanel() {
  if (!live()) { openSheet("Gmail'den ekstre", `<div class="form"><p style="margin:0">Gmail bağlantısı için Google hesabınla giriş yapmış olman gerekir. Deneme modunda çalışmaz.</p></div>`); return; }
  const G = Gmail, done = gmailDone(), q = ls.get("kd-gmail-q") || GMAIL_Q;
  const body = `<div class="form" id="gmailPanel">
    ${!G.valid() ? `<p style="margin:0">Bankaların e-postayla gönderdiği ekstreleri (PDF, Excel) Gmail'den doğrudan okuyup içe aktarır. Uygulama e-postalarını <b>sadece okur</b>; silemez, gönderemez. Okunan dosyalar yalnızca bu cihazda işlenir.</p>
      <button class="btn primary" type="button" data-act="gmail-auth" style="justify-content:center;padding:12px">Gmail'e bağlan</button>
      <p class="small-note" style="margin:0">Google "bu uygulama doğrulanmadı" derse: <b>Gelişmiş → Kasa Defteri'ne git</b> de. Uygulama senin; bu uyarı kişisel projelerde normaldir.</p>`
    : `<label>Arama<input id="gm-q" value="${esc(q)}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="gmail-search">${G.list ? "Yeniden ara" : "E-postaları ara"}</button><button class="btn ghost small" type="button" data-act="gmail-reset-q">Varsayılan arama</button></div>
      ${G.err ? `<div class="notice warn" style="margin:0"><span>${esc(G.err)}</span></div>` : ""}
      ${G.busy ? `<p class="muted">Gmail okunuyor…</p>` : G.list ? (G.list.length ? `<div class="list">${G.list.map(m => `<div class="row" style="display:block">
        <div class="t" style="font-size:.9rem">${esc(m.subject || "(konu yok)")}</div>
        <div class="m">${esc(gmailSender(m.from))} · ${dfmt.format(m.date)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${m.files.map(f => { const k = m.id + "|" + f.name, did = done[k];
          return `<button class="btn small ${did ? "" : "primary"}" type="button" data-gmail-msg="${esc(m.id)}" data-gmail-att="${esc(f.id)}" data-gmail-name="${esc(f.name)}">${did ? "✓ " : "⇣ "}${esc(f.name.length > 28 ? f.name.slice(0, 26) + "…" : f.name)}${did ? " · yüklendi" : ""}</button>`; }).join("")}
          ${!m.files.length && m.hasHtml ? `<button class="btn small" type="button" data-gmail-msg="${esc(m.id)}" data-gmail-att="" data-gmail-name="eposta.html">${done[m.id + "|eposta.html"] ? "✓ " : "⇣ "}E-postadaki tabloyu oku</button>` : ""}
          ${!m.files.length && !m.hasHtml ? `<span class="muted" style="font-size:.8rem">Okunabilir ek yok</span>` : ""}</div></div>`).join("")}</div>` : `<p class="muted">Bu aramayla e-posta bulunamadı. Aramayı değiştir (ör. <code>from:kuveytturk has:attachment</code>).</p>`) : ""}
      <p class="small-note" style="margin:0">Bir eke dokununca hangi hesaba ait olduğunu seçersin; aynı bankanın sonraki ekstreleri o hesaba otomatik önerilir. Daha önce eklenen hareketler tekrar eklenmez.</p>
      <label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--ink)"><input type="checkbox" id="gm-auto" style="width:auto;margin-top:3px" ${gmailAutoOn() ? "checked" : ""}>
        <span><b>Yeni ekstreleri otomatik ekle</b><br><span class="muted" style="font-size:.84rem">Uygulama açıkken 15 dakikada bir Gmail'e bakar; daha önce bir kez hesabını seçtiğin bankaların yeni ekstrelerini kontrol etmeden ekler (tekrarlar atlanır, "Yüklenen ekstreler"den geri alınabilir).${ls.get("kd-gmail-auto-at") ? ` Son kontrol: ${tfmt.format(new Date(ls.get("kd-gmail-auto-at")))}.` : ""}</span></span></label>`}
  </div>`;
  if ($("#gmailPanel")) $("#gmailPanel").outerHTML = body; else openSheet("Gmail'den ekstre", body);
}
/* --- ekstre ↔ hesap eşleştirme (IBAN, hesap-ek no, kart son 4) --- */
const idLabel = i => i.startsWith("IBAN:") ? i.slice(5).replace(/(.{4})/g, "$1 ").trim() : i.startsWith("KART:") ? "Kart •" + i.slice(5) : i.startsWith("HESAP:") ? "Hesap " + i.slice(6) : i;
const idsFromInput = v => String(v || "").split(/[,;\n]+/).map(x => x.trim().toUpperCase().replace(/^KART\s*•?\s*/, "").replace(/^HESAP\s*/, "")).filter(Boolean).map(x => /^TR[\d\s]+$/.test(x) ? "IBAN:" + x.replace(/\s/g, "") : /^\d{4}$/.test(x) ? "KART:" + x : /^\d{5,10}\s*-\s*\d{1,3}$/.test(x) ? "HESAP:" + x.replace(/\s/g, "") : x.includes(":") ? x : null).filter(Boolean);
function accountForIds(ids) { if (!ids || !ids.length) return null; const h = S.accounts.filter(a => (a.ids || []).some(i => ids.includes(i))); return h.length === 1 ? h[0] : null; }

/* --- Gmail otomatik içe aktarma: uygulama açıkken yeni ekstreleri kendisi ekler --- */
const GAuto = { busy: false, last: 0, need: false };
const gmailAutoOn = () => ls.get("kd-gmail-auto") === "1";
async function gmailAutoImport(force) {
  if (!live() || !gmailAutoOn() || GAuto.busy || !navigator.onLine) return;
  Gmail.load(); if (!Gmail.valid()) { if (!GAuto.need) { GAuto.need = true; renderChips(); } return; }
  if (!force && Date.now() - GAuto.last < 15 * 60e3) return;
  if (imp || ($("#sheetRoot") && $("#sheetRoot").innerHTML.trim())) return; // kullanıcı bir iş yaparken araya girme
  GAuto.busy = true; GAuto.last = Date.now(); GAuto.need = false; renderChips();
  let accs = {}; try { accs = JSON.parse(ls.get("kd-gmail-acc") || "{}"); } catch (e) { }
  const report = [];
  try {
    const q = (ls.get("kd-gmail-q") || GMAIL_Q).replace(/\s*newer_than:\S+/g, "") + " newer_than:21d";
    const r = await Gmail.api("messages?maxResults=15&q=" + encodeURIComponent(q));
    for (const m0 of r.messages || []) {
      const m = await Gmail.api("messages/" + m0.id + "?format=full"), from = ((m.payload.headers || []).find(h => h.name.toLowerCase() === "from") || {}).value || "";
      for (const f of Gmail.parts(m.payload).filter(f => /\.(pdf|xlsx?|csv)$/i.test(f.name))) {
        const key = m.id + "|" + f.name, done = gmailDone(); if (done[key]) continue;
        const patAcc = accs[gmailPat(from, f.name)], knownSender = Object.keys(accs).some(k => k.split("|")[0] === gmailSender(from));
        if (!acc(patAcc) && !knownSender) continue; // bu bankadan hiç ekstre yüklenmemiş
        let accId = null;
        try {
          const a = await Gmail.api(`messages/${m.id}/attachments/${f.id}`), file = new File([b64u(a.data)], f.name), rows = await IMP.fileToRows(file);
          const ids = [...new Set([...(rows.ids || []), ...IMP.statementIds("", f.name)])], byId = accountForIds(ids);
          accId = byId ? byId.id : (!ids.length && acc(patAcc) ? patAcc : null); // kimlik varsa sadece kimlikle eşleşen hesaba
          if (!accId) { report.push({ accId: null, err: `tanınmayan hesap (${ids.map(idLabel).join(", ") || f.name}), bir kez elle yükle` }); continue; }
          imp = { accountId: accId }; setupImp(rows, file); imp.gmailKey = key;
          const n = imp.items.filter(x => x.sel).length;
          if (n) await commitImport(true); else { done[key] = Date.now(); ls.set("kd-gmail-done", JSON.stringify(done)); }
          report.push({ accId, n });
        } catch (e) { report.push({ accId, err: e instanceof IMP.PdfPasswordError ? "şifreli PDF, elle yükle" : (e.message || "okunamadı") }); }
        imp = null;
      }
    }
    ls.set("kd-gmail-auto-at", new Date().toISOString());
  } catch (e) { if (e.status === 401) GAuto.need = true; }
  GAuto.busy = false; renderChips();
  const add = report.filter(x => x.n), bad = report.filter(x => x.err);
  if (add.length) toast("Gmail'den eklendi: " + add.map(x => `${accName(acc(x.accId))} ${x.n} hareket`).join(" · "));
  else if (bad.length) toast("Gmail: " + bad.map(x => `${x.accId ? accName(acc(x.accId)) + " – " : ""}${x.err}`).join(" · "));
}
async function gmailOpen(msgId, attId, name) {
  const m = (Gmail.list || []).find(x => x.id === msgId); if (!m) return;
  try {
    toast("Ek indiriliyor…");
    let file;
    if (attId) { const r = await Gmail.api(`messages/${msgId}/attachments/${attId}`); file = new File([b64u(r.data)], name); }
    else file = new File([Gmail.html(m.payload)], name, { type: "text/html" });
    const pat = gmailPat(m.from, name), accs = (() => { try { return JSON.parse(ls.get("kd-gmail-acc") || "{}"); } catch (e) { return {}; } })();
    const guess = acc(accs[pat]) ? accs[pat] : (S.accounts.find(a => gmailSender(m.from).includes(IMP.up(groupOf(a)).toLowerCase().replace(/[^a-z]/g, "").slice(0, 6))) || {}).id || ls.get("kd-imp-acc") || S.accounts[0]?.id;
    openSheet("Hangi hesabın ekstresi?", `<form class="form" id="gmAccForm" data-kind="gmacc">
      <p style="margin:0"><b>${esc(name)}</b><br><span class="muted" style="font-size:.86rem">${esc(m.subject || "")}</span></p>
      <label>Hesap<select id="gm-acc">${accOpts(guess)}</select></label>
      <div class="foot"><span></span><div class="r"><button type="button" class="btn" data-act="gmail">Geri</button><button class="btn primary" type="submit">Devam</button></div></div></form>`);
    ui.gmailPending = { file, pat, key: msgId + "|" + name };
  } catch (e) { toast(Gmail.errText(e)); }
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
    const s = Drive.state, ageH = Drive.lastBackup ? (Date.now() - new Date(Drive.lastBackup)) / 3600e3 : 999;
    const cls = s === "ok" ? "ok" : s === "busy" ? "busy" : s === "err" ? "err" : s === "need" ? (ageH < 24 ? "ok" : "busy") : "";
    const t = s === "busy" ? "Drive · kaydediliyor" : s === "err" ? "Drive · sorun var" : Drive.lastBackup ? `Drive · ${ageH < 24 ? "yedek " + tfmt.format(new Date(Drive.lastBackup)) : "yedek eski"}` : s === "need" ? "Drive · yedekle" : "Drive · hazır";
    h += `<button class="chip" type="button" data-act="drive"><span class="dot ${cls}"></span>${t}</button>`;
  }
  if (live() && gmailAutoOn()) h += `<button class="chip" type="button" data-act="${GAuto.need ? "gmail-reauth" : "gmail"}"><span class="dot ${GAuto.busy ? "busy" : GAuto.need ? "err" : "ok"}"></span>${GAuto.busy ? "Gmail · kontrol ediliyor" : GAuto.need ? "Gmail · bağlan" : "Gmail · otomatik"}</button>`;
  if (usesForeign()) { const src = Object.keys(RATES.auto).length ? (RATES.failed ? "err" : "ok") : "busy"; h += `<button class="chip" type="button" data-act="rates"><span class="dot ${src}"></span>Kurlar${RATES.date ? " · " + esc(String(RATES.date).slice(11, 16)) : ""}</button>`; }
  if (user) h += `<button class="chip acc-chip" type="button" data-act="account">${user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : ""}${esc(user.displayName || user.email || "Hesabım")}</button>`;
  else if (mode === "demo") h += `<button class="chip" type="button" data-act="account">Deneme modu</button>`;
  el.innerHTML = h;
}
function emptyView() {
  return `<section class="panel empty"><h3>Defterin boş</h3>
  <p>Gelir, gider, banka hesapları, cariler ve vadeli ödemeler burada toplanır. Kayıtların yalnızca sana görünür.</p>
  <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
  <button class="btn primary" data-act="new-account">İlk banka hesabını ekle</button>
  <button class="btn" data-act="new-cash">Nakit / kasa ekle</button>
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
  return `${dataCheckNotice()}<section class="grid g-kpi">
    ${kpi("Nakit ve banka", money(cash), S.accounts.some(isCash) ? `Nakit ${money0(cashTotal())} · Banka ${money0(cash - cashTotal())}` : `${S.accounts.length} hesap`, "hl")}
    ${kpi("Alacaklar", `<span class="pos">${money(r)}</span>`, `${pending().filter(x => x.dir === "tahsilat").length} bekleyen tahsilat`)}
    ${kpi("Borçlar", `<span class="neg">${money(p)}</span>`, `${pending().filter(x => x.dir === "ödeme").length} bekleyen ödeme`)}
    ${kpi("30 gün sonra", `<span class="${d30 < 0 ? "neg" : ""}">${money(d30)}</span>`, `Bugüne göre ${signed(d30 - cash)}`)}
  </section>
  ${creditCardsPanel()}
  ${spendingAnalysis()}
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
      <div class="list">${accountGroups().filter(g => !g.allHide).map(g => `<div class="dhead" style="padding-top:8px"><span>${esc(g.name)}${g.allEx ? ` <span class="pill">toplam dışı</span>` : ""}</span><span class="num ${g.total < 0 ? "neg" : ""} ${g.allEx ? "muted" : ""}">${money(g.total)}</span></div>` + g.list.filter(a => !a.hide).map(a => `<div class="row click" data-edit-account="${esc(a.id)}" style="padding-left:12px"><div><div class="t">${esc(a.name)}</div><div class="m">${esc(kindLabel(a.kind))}${accAsset(a) !== "TRY" ? " · " + fmtAsset(balanceOf(a), accAsset(a)) : ""}${limitInfo(a) ? ` · <span style="color:${limitInfo(a).col}">kalan limit ${money0(limitInfo(a).avail)}</span>` : ""}</div></div><div class="amt ${valueTRY(a) < 0 ? "neg" : ""} ${a.excl ? "muted" : ""}">${money(valueTRY(a))}</div></div>`).join("")).join("") || `<p class="muted">Henüz hesap yok.</p>`}
        ${S.accounts.some(a => a.hide) ? `<p class="small-note" style="margin:8px 0 0">${S.accounts.filter(a => a.hide).length} hesap gizli · göstermek için <button class="btn ghost small" data-tab="hesaplar" style="padding:0;display:inline">Hesaplar</button>'dan hesaba dokun.</p>` : ""}</div></div>
  </section>`;
}
function planRow(p) {
  const c = con(p.contactId), late = p.status !== "tamam" && p.due < TODAY, dd = diffDays(TODAY, p.due);
  const when = p.status === "tamam" ? `Tamamlandı ${p.doneDate ? dshort(p.doneDate) : ""}` : late ? `${-dd} gün gecikti` : dd === 0 ? "Bugün" : `${dd} gün sonra · ${dshort(p.due)}`;
  return `<div class="row"><div class="click" data-edit-plan="${esc(p.id)}" style="cursor:pointer;min-width:0">
    <div class="t"><span class="pill ${p.dir === "tahsilat" ? "pos" : "neg"}">${p.dir === "tahsilat" ? "Tahsilat" : "Ödeme"}</span> ${esc(c ? c.name : (p.note || p.category))}</div>
    <div class="m">${late ? `<span class="neg">${when}</span>` : when} · ${esc(catLabel(p))}${p.repeat === "aylık" ? " · her ay" : ""}</div></div>
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
  const TX = spreadTx(S.txns);
  const data = lastMonths(6).map(m => ({ m, inc: sum(TX.filter(t => t.type === "gelir" && monthKey(t.date) === m), txTRY), exp: sum(TX.filter(t => t.type === "gider" && monthKey(t.date) === m), txTRY) }));
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
  if (q) rows = rows.filter(t => [catLabel(t), t.note, txLabel(t), String(t.amount)].join(" ").toLocaleLowerCase("tr").includes(q));
  rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const inc = sum(rows.filter(t => t.type === "gelir" && !isMove(t)), txTRY), exp = sum(rows.filter(t => t.type === "gider" && !isMove(t)), txTRY);
  let h = "", cur = "";
  for (const t of rows.slice(0, 300)) {
    const m = monthKey(t.date);
    if (m !== cur) {
      cur = m; const net = sum(rows.filter(x => monthKey(x.date) === m), x => x.type === "gelir" ? txTRY(x) : x.type === "gider" ? -txTRY(x) : 0);
      h += `<div class="dhead"><span>${mfmtL.format(pd(m + "-01"))}</span><span class="num ${net < 0 ? "neg" : "pos"}">${signed(net)}</span></div>`;
    }
    const a = acc(t.accountId), sg = t.type === "gelir" ? 1 : t.type === "gider" ? -1 : 0;
    h += `<div class="row click" data-edit-txn="${esc(t.id)}"><div><div class="t">${esc(txLabel(t))}</div>
      <div class="m">${dshort(t.date)} · ${esc(catLabel(t))}${instN(t) ? ` · <span class="pill acc">${instN(t)} taksit · aylık ${money0(t.amount / instN(t))}</span>` : ""}${t.type !== "transfer" && a ? " · " + esc(accName(a)) : ""}${t.note && con(t.contactId) ? " · " + esc(t.note) : ""}</div></div>
      <div class="amt ${sg > 0 ? "pos" : sg < 0 ? "neg" : "muted"}">${sg > 0 ? "+" : sg < 0 ? "−" : "⇄ "}${fmtAsset(t.amount, txAsset(t))}${t.type === "transfer" && t.toAmount != null && accAsset(acc(t.toAccountId)) !== txAsset(t) ? `<div class="muted" style="font-size:.78rem">→ ${fmtAsset(t.toAmount, accAsset(acc(t.toAccountId)))}</div>` : txAsset(t) !== "TRY" && t.type !== "transfer" ? `<div class="muted" style="font-size:.78rem">≈ ${money(txTRY(t))}</div>` : ""}</div></div>`;
  }
  return `<section class="panel"><div class="ph"><div><h2>İşlemler</h2><p>${rows.length} kayıt · <span class="pos">${money(inc)}</span> gelir · <span class="neg">${money(exp)}</span> gider</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="import-stmt">⇣ Ekstre içe aktar</button>${S.txns.some(t => t.importKey) ? `<button class="btn" data-act="imports">Yüklenen ekstreler</button>` : ""}<button class="btn primary" data-act="new-txn">+ İşlem</button></div></div>
    ${otherTxs().length >= 3 ? `<div class="notice warn" style="margin:0 0 10px"><span><b>${otherTxs().length} işlem "Diğer" kategorisinde.</b> Ekstre açıklamalarından kategorileri yeniden tahmin edebilirim.</span><button class="btn small primary" data-act="recat">Otomatik kategorilendir</button></div>` : ""}
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
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="import-stmt">⇣ Ekstre</button><button class="btn" data-act="new-transfer">⇄ Transfer</button><button class="btn" data-act="new-cash">+ Nakit</button><button class="btn primary" data-act="new-account">+ Hesap</button></div></div>
    <div class="grid g-kpi" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="kpi" style="padding:4px 0"><div class="lbl">Nakit</div><div class="val">${money(cashTotal())}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Varlıklar</div><div class="val pos">${money(assets)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Borçlar (kart, kredi)</div><div class="val neg">${money(debts)}</div></div>
      <div class="kpi" style="padding:4px 0"><div class="lbl">Net</div><div class="val ${total < 0 ? "neg" : ""}">${money(total)}</div></div>
      ${S.accounts.some(a => a.excl) ? `<div class="kpi" style="padding:4px 0"><div class="lbl">Toplam dışı (BES, yatırım…)</div><div class="val muted">${money(exclTotal())}</div><div class="sub">${S.accounts.filter(a => a.excl).length} hesap · dahil: ${money0(total + exclTotal())}</div></div>` : ""}
    </div></section>
  ${!S.accounts.some(isCash) ? `<button class="acard" type="button" data-act="new-cash" style="text-align:left;border-style:dashed"><b>+ Nakit hesabı ekle</b><span class="muted" style="font-size:.85rem">Cüzdan, kasa, evde duran döviz veya altın. Bankaya yatırmadığın parayı da takip et.</span></button>` : ""}
  ${gs.map(g => {
    const open = !collapsed[g.name], share = assets > 0 ? Math.round(g.assets / assets * 100) : 0;
    return `<section class="panel"><div class="ph" style="margin-bottom:${open ? 12 : 0}px">
      <button type="button" class="btn ghost" data-toggle-group="${esc(g.name)}" style="padding:0;gap:10px;min-width:0" aria-expanded="${open}">
        <span class="mark" style="width:30px;height:30px;font-size:13px;flex:none">${esc(g.name.slice(0, 1).toLocaleUpperCase("tr"))}</span>
        <span style="text-align:left;min-width:0"><b style="font-size:1.02rem">${esc(g.name)}</b><br><span class="muted" style="font-size:.8rem;font-weight:400">${g.list.length} hesap${g.assets ? ` · varlıkların %${share}'i` : ""}${g.allEx ? " · toplam dışı" : g.exN ? ` · ${g.exN} hesap toplam dışı` : ""}${g.allHide ? " · Özet'te gizli" : ""}</span></span>
        <span class="muted" aria-hidden="true">${open ? "▾" : "▸"}</span></button>
      <div style="text-align:right"><div class="num ${g.total < 0 ? "neg" : ""}" style="font-size:1.1rem;font-weight:500">${money(g.total)}</div>
        <div class="muted" style="font-size:.78rem">${g.debts ? `<span class="pos">+${money0(g.assets)}</span> · <span class="neg">−${money0(g.debts)}</span>` : "net"}</div></div></div>
      ${open ? `<div class="cards">${g.list.map(accCard).join("")}
        <button class="acard" type="button" data-new-in-group="${esc(g.name)}" style="place-content:center;text-align:center;border-style:dashed;color:var(--muted);min-height:90px">+ ${esc(g.name)} için hesap ekle</button></div>
        <div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn small ghost" data-group-excl="${esc(g.name)}">${g.allEx ? "Toplamlara dahil et" : "Toplamlara dahil etme"}</button>
          <button class="btn small ghost" data-group-hide="${esc(g.name)}">${g.allHide ? "Özet'te göster" : "Özet'te gizle"}</button>
          <button class="btn small ghost" data-rename-group="${esc(g.name)}">Grup adını değiştir</button></div>` : ""}
    </section>`;
  }).join("") || `<section class="panel"><p class="muted">Henüz hesap yok.</p></section>`}`;
}
const old0 = id => S.accounts.find(x => x.id === id);
function creditAnchor(accId, limit, avail) {
  return { syncBal: Math.round(-(limit - avail) * 100) / 100, syncDate: TODAY, syncIds: S.txns.filter(t => (t.accountId === accId || t.toAccountId === accId) && t.date === TODAY).map(t => t.id), limitSyncAt: new Date().toISOString() };
}
const isCredit = a => a && (a.kind === "kredi kartı" || a.kind === "kredi");
function limitInfo(a) {
  if (!isCredit(a) || !(+a.limit > 0)) return null;
  const used = Math.max(0, -balanceOf(a)), lim = +a.limit, avail = lim - used, pct = Math.min(1, used / lim);
  return { lim, used, avail, pct, col: pct >= 0.8 ? "var(--neg)" : pct >= 0.5 ? "var(--warn)" : "var(--pos)" };
}
const cutOn = (y, m, day) => { const d = new Date(y, m, 1); y = d.getFullYear(); m = d.getMonth(); return iso(new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()))); };
function lastCut(day) { const t = pd(TODAY); let c = cutOn(t.getFullYear(), t.getMonth(), day); if (c > TODAY) c = cutOn(t.getFullYear(), t.getMonth() - 1, day); return c; }
function spentAnchor(accId) { return { syncSpent: null, spentDate: TODAY, spentIds: S.txns.filter(t => t.accountId === accId && t.type === "gider" && t.date === TODAY).map(t => t.id) }; }
// Banka uygulamasındaki gibi kart özeti: kullanılabilir limit, dönem içi harcamalar, önceki dönem/taksit
function cardSummary(a) {
  const L = limitInfo(a); if (!L) return null;
  const day = +a.cutDay > 0 ? Math.min(31, +a.cutDay) : 0, cut = day ? lastCut(day) : null;
  const start = cut ? addDays(cut, 1) : TODAY.slice(0, 8) + "01";
  const nextCut = cut ? (() => { const d = pd(cut); return cutOn(d.getFullYear(), d.getMonth() + 1, day); })() : null;
  const end = nextCut || (() => { const d = pd(TODAY); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); })();
  const own = S.txns.filter(t => t.accountId === a.id && t.type === "gider");
  const inPer = p => p.date >= start && p.date <= end && (p.instOf || p.date <= TODAY);
  let spent, synced = false;
  if (a.syncSpent != null && a.spentDate && a.spentDate >= start) {
    const skip = new Set(a.spentIds || []); synced = true;
    const after = own.filter(t => t.date <= TODAY && (t.date > a.spentDate || (t.date === a.spentDate && !skip.has(t.id) && !t.importKey)));
    spent = +a.syncSpent + sum(spreadTx(after).filter(inPer), p => +p.amount);
  } else spent = sum(spreadTx(own).filter(inPer), p => +p.amount);
  spent = Math.round(spent * 100) / 100;
  const fut = spreadTx(own.filter(instN)).filter(p => p.date > end), future = Math.round(sum(fut, p => +p.amount) * 100) / 100;
  const instAct = own.filter(t => instN(t) && addMonths(t.date, instN(t) - 1) > end).length;
  return { ...L, spent, future, instAct, prev: Math.max(0, Math.round((L.used - spent - future) * 100) / 100), start, cut, nextCut, end, synced };
}
function cardSummaryHtml(a) {
  const C = cardSummary(a); if (!C) return "";
  return `<div class="csum">
    <div class="csum-2"><div><div class="lbl">Kullanılabilir limit</div><div class="big" style="color:${C.col}">${money(C.avail)}</div></div>
      <div><div class="lbl">Dönem içi harcamalar</div><div class="big">${money(C.spent)}</div></div></div>
    <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="width:${(C.pct * 100).toFixed(1)}%;height:100%;background:${C.col}"></div></div>
    <div class="csum-rows">
      <span>Toplam borç</span><b class="num">${money(C.used)}</b>
      ${C.future >= 0.01 ? `<span>Gelecek dönem taksitleri${C.instAct ? ` (${C.instAct} alışveriş)` : ""}</span><b class="num">${money(C.future)}</b>` : ""}
      ${C.prev >= 0.01 ? `<span>${C.future >= 0.01 ? "Önceki dönem borcu" : "Önceki dönem / taksit"}</span><b class="num">${money(C.prev)}</b>` : ""}
      <span>Toplam limit</span><b class="num">${money(C.lim)}</b>
      <span>Dönem</span><b>${dshort(C.start)} – ${C.nextCut ? dshort(C.nextCut) + " (kesim)" : "bugün"}</b>
    </div>
    ${C.pct >= 0.8 ? `<div class="neg" style="font-size:.78rem">Limitin %${Math.round(C.pct * 100)} kadarı dolu</div>` : ""}
    ${!a.cutDay ? `<div class="muted" style="font-size:.74rem">Hesap kesim günü girilmedi; dönem ay başından sayılıyor.</div>` : ""}
    ${a.limitSyncAt ? `<div class="muted" style="font-size:.74rem">Bankayla eşitlendi: ${tfmt.format(new Date(a.limitSyncAt))}</div>` : ""}</div>`;
}
function instListHtml(a) {
  const C = cardSummary(a), end = C ? C.end : TODAY;
  const list = S.txns.filter(t => t.accountId === a.id && instN(t)).map(t => {
    const n = instN(t), ps = instPieces(t), k = ps.filter(p => p.date <= end).length, rest = sum(ps.filter(p => p.date > end), p => p.amount);
    return { t, n, k: Math.min(k, n), per: ps[0].amount, rest, done: k >= n };
  }).filter(x => !x.done).sort((x, y) => y.rest - x.rest);
  if (!list.length) return "";
  return `<div style="display:grid;gap:6px;border:1px solid var(--line);border-radius:10px;padding:12px">
    <b style="font-size:.92rem">Devam eden taksitler</b>
    ${list.map(x => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:.86rem"><span style="min-width:0"><b>${esc(x.t.note || catLabel(x.t))}</b><br><span class="muted">${dshort(x.t.date)} · ${money(x.t.amount)} · ${x.k}/${x.n}. taksit · aylık ${money(x.per)}</span></span><span class="num" style="text-align:right">kalan<br><b>${money(x.rest)}</b></span></div>`).join("")}
    <div class="small-note" style="margin:0">Toplam kalan taksit: <b>${money(sum(list, x => x.rest))}</b>. Limitten alışveriş anında tamamı düşer; her ay ekstreye bir taksit yansır.</div></div>`;
}
function creditCardsPanel() {
  const cards = S.accounts.filter(a => limitInfo(a) && !a.hide); if (!cards.length) return "";
  return `<section class="panel"><div class="ph"><div><h2>Kredi kartlarım</h2><p>Kalan limit ve bu dönemki harcama</p></div></div>
    <div class="grid g-2" style="gap:10px">${cards.map(a => `<button class="acard" data-edit-account="${esc(a.id)}" type="button"><b>${esc((a.group ? a.group + " · " : "") + a.name)}</b>${cardSummaryHtml(a)}</button>`).join("")}</div></section>`;
}
function accCard(a) {
  const b = balanceOf(a), tx = S.txns.filter(t => t.accountId === a.id || t.toAccountId === a.id), last = tx.reduce((m, t) => t.date > m ? t.date : m, "");
  return `<button class="acard" data-edit-account="${esc(a.id)}" type="button"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><b>${esc(a.name)}</b><span class="pill ${a.kind === "kredi kartı" || a.kind === "kredi" ? "neg" : a.kind === "yatırım" || a.kind === "vadeli" || a.kind === "birikim" || a.kind === "bes" ? "pos" : "acc"}">${esc(kindLabel(a.kind))}</span></div>
    <div class="bal ${b < 0 ? "neg" : ""}" ${a.excl ? 'style="opacity:.6"' : ""}>${fmtAsset(b, accAsset(a))}</div>
    ${a.excl || a.hide ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${a.excl ? `<span class="pill">toplam dışı</span>` : ""}${a.hide ? `<span class="pill">Özet'te gizli</span>` : ""}</div>` : ""}
    ${accAsset(a) !== "TRY" ? `<div class="muted" style="font-size:.82rem">≈ ${money(valueTRY(a))} · ${esc(assetOf(accAsset(a))[1])}</div>` : ""}
    ${limitInfo(a) ? cardSummaryHtml(a) : isCredit(a) ? `<div class="muted" style="font-size:.78rem">Limit girilmedi · düzenlemek için dokun</div>` : ""}
    <div class="muted" style="font-size:.82rem">${tx.length} işlem${last ? ` · son ${dshort(last)}` : ""}</div></button>`;
}
function updateOpenConv() {
  const el = $("#f-open-conv"); if (!el) return; const code = $("#f-asset")?.value || "TRY", n = parseAmt($("#f-open").value);
  el.textContent = code !== "TRY" && n ? `≈ ${money(n * (rateOf(code) || 0))} (1 ${unitOf(code)} = ${money(rateOf(code) || 0)})` : "";
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
  return { r, pp, net: r - pp, next: op.reduce((m, p) => !m || p.due < m.due ? p : m, null), tx, ciro: sum(tx, t => t.type === "gelir" ? txTRY(t) : t.type === "gider" ? -txTRY(t) : 0) };
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
  const tot = sum(list, txTRY); if (!tot) return `<p class="muted">Bu dönemde kayıt yok.</p>`;
  const m = {}; list.forEach(t => { const k = t.category || "Diğer"; (m[k] = m[k] || { v: 0, s: {} }).v += txTRY(t); if (t.sub) m[k].s[t.sub] = (m[k].s[t.sub] || 0) + txTRY(t); });
  const arr = Object.entries(m).sort((a, b) => b[1].v - a[1].v), mx = arr[0][1].v;
  return `<div class="bars">${arr.map(([k, o]) => { const subs = Object.entries(o.s).sort((a, b) => b[1] - a[1]); const rest = o.v - sum(subs, x => x[1]);
    const bar = `<div class="bar"><span>${esc(k)}${subs.length ? ` <span class="muted" style="font-size:.75rem">▸</span>` : ""}</span><div class="track"><div class="fill" style="width:${(o.v / mx * 100).toFixed(1)}%;background:${color}"></div></div><span class="num">${money0(o.v)} <span class="muted">%${Math.round(o.v / tot * 100)}</span></span></div>`;
    return subs.length ? `<details><summary style="list-style:none;cursor:pointer">${bar}</summary><div style="display:grid;gap:4px;margin:6px 0 8px 14px;font-size:.84rem">${subs.map(([s, v]) => `<div style="display:flex;justify-content:space-between;gap:8px"><span class="muted">${esc(s)}</span><span class="num">${money0(v)}</span></div>`).join("")}${rest > 0.5 ? `<div style="display:flex;justify-content:space-between;gap:8px"><span class="muted">Alt kategorisiz</span><span class="num">${money0(rest)}</span></div>` : ""}</div></details>` : bar;
  }).join("")}</div>`;
}
function viewRaporlar() {
  const [a, b, lbl] = periodRange(ui.period);
  const tx = S.txns.filter(t => t.date >= a && t.date <= b && !isMove(t));
  const inc = tx.filter(t => t.type === "gelir"), exp = tx.filter(t => t.type === "gider");
  const I = sum(inc, txTRY), E = sum(exp, txTRY), N = I - E, rate = I ? Math.round(N / I * 100) : 0;
  const months = [...new Set(tx.map(t => monthKey(t.date)))].sort();
  const top = {}; tx.forEach(t => { if (t.contactId && t.type !== "transfer") top[t.contactId] = (top[t.contactId] || 0) + (t.type === "gelir" ? txTRY(t) : -txTRY(t)); });
  const topArr = Object.entries(top).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 6);
  const P = [["bu-ay", "Bu ay"], ["gecen-ay", "Geçen ay"], ["3-ay", "Son 3 ay"], ["yil", "Bu yıl"], ["tumu", "Tümü"]];
  const twoCol = `grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))`;
  return `<section class="panel"><div class="ph"><div><h2>Gelir tablosu · ${lbl}</h2><p>${a === "0000-01-01" ? "Tüm kayıtlar" : `${dshort(a)} – ${dshort(b)}`} · ${tx.length} işlem</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><div class="seg" role="group" aria-label="Dönem">${P.map(([k, l]) => `<button data-period="${k}" aria-pressed="${ui.period === k}">${l}</button>`).join("")}</div>
    <button class="btn" data-act="cats">Kategoriler</button><button class="btn" data-act="csv">CSV indir</button></div></div>
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
    ${months.map(m => { const i = sum(tx.filter(t => t.type === "gelir" && monthKey(t.date) === m), txTRY), e = sum(tx.filter(t => t.type === "gider" && monthKey(t.date) === m), txTRY); return `<tr><td>${mfmtL.format(pd(m + "-01"))}</td><td class="r num pos">${money(i)}</td><td class="r num neg">${money(e)}</td><td class="r num ${i - e < 0 ? "neg" : ""}">${signed(i - e)}</td></tr>`; }).join("") || `<tr><td colspan="4" class="muted">Kayıt yok.</td></tr>`}
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
  const lines = [["Tarih", "Tür", "Tutar", "Birim", "TL karşılığı", "Kategori", "Alt kategori", "Hesap", "Hedef hesap", "Cari", "Not"].map(q).join(";")];
  const nc = n => String(Math.round(n * 1000) / 1000).replace(".", ",");
  tx.forEach(t => lines.push([t.date, t.type, nc(t.amount), unitOf(txAsset(t)), t.type === "transfer" ? "" : nc(Math.round(txTRY(t) * 100) / 100), t.category, t.sub || "", acc(t.accountId) ? accName(acc(t.accountId)) : "", acc(t.toAccountId) ? accName(acc(t.toAccountId)) : "", con(t.contactId)?.name, t.note].map(q).join(";")));
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
const amtUnit = a => { const c = accAsset(a); return c === "TRY" ? "₺" : unitOf(c) === "gr" || unitOf(c) === "adet" ? unitOf(c) + " · " + assetOf(c)[1] : unitOf(c); };
const amtStr = n => n ? String(n).replace(".", ",") : "";
const delBtn = has => has ? `<button type="button" class="btn danger" data-del>Sil</button>` : "<span></span>";
const formFoot = has => `<div class="foot">${delBtn(has)}<div class="r"><button type="button" class="btn" data-close>Vazgeç</button><button class="btn primary" type="submit">Kaydet</button></div></div>`;

function txnForm(t, presetType) {
  if (!S.accounts.length) { toast("Önce bir hesap ekle."); return accountForm(); }
  const type = t?.type || presetType || "gider";
  const accId = t?.accountId || ls.get("kd-last-acc") || S.accounts[0].id;
  openSheet(t?.id ? "İşlemi düzenle" : "Yeni işlem", `<form class="form" id="frm" data-kind="txn" data-id="${esc(t?.id || "")}">
    <div class="seg" role="group" aria-label="İşlem türü">${["gelir", "gider", "transfer"].map(x => `<button type="button" data-ttype="${x}" aria-pressed="${type === x}">${x[0].toLocaleUpperCase("tr") + x.slice(1)}</button>`).join("")}</div>
    <input type="hidden" id="f-type" value="${type}">
    <div class="f2"><label>${type === "transfer" ? "Çıkış hesabı" : "Hesap"}<select id="f-acc">${accOpts(acc(accId) ? accId : S.accounts[0].id)}</select></label>
    ${type === "transfer" ? `<label>Giriş hesabı<select id="f-to">${accOpts(t?.toAccountId || S.accounts.find(x => x.id !== accId)?.id)}</select></label>` : `<label>Tarih<input id="f-date" type="date" required value="${esc(t?.date || TODAY)}"></label>`}</div>
    <div class="f2"><label><span id="f-amt-lbl">Tutar</span><input id="f-amount" inputmode="decimal" required placeholder="0,00" value="${amtStr(t?.amount)}"></label>
    ${type === "transfer" ? `<label>Tarih<input id="f-date" type="date" required value="${esc(t?.date || TODAY)}"></label>` : `<label id="f-rate-row" hidden><span id="f-rate-lbl">Kur</span><input id="f-rate" inputmode="decimal" value="${t?.rate ? amtStr(t.rate) : ""}"></label>`}</div>
    ${type === "transfer" ? `<label id="f-toamt-row" hidden><span id="f-toamt-lbl">Giriş miktarı</span><input id="f-toamt" inputmode="decimal" value="${t?.toAmount != null ? amtStr(t.toAmount) : ""}"></label>` : ""}
    <p id="f-conv" class="small-note" style="margin:0" hidden></p>
    ${type === "gider" ? `<label id="f-inst-row" hidden>Taksit<select id="f-inst">${INST_OPTS.map(n => `<option value="${n}" ${n === (+t?.inst || 1) ? "selected" : ""}>${n === 1 ? "Peşin (tek çekim)" : n + " taksit"}</option>`).join("")}</select></label><p id="f-inst-note" class="small-note" style="margin:0" hidden></p>` : ""}
    ${type !== "transfer" ? catFields(type, t?.category, t?.sub) + `<label>Cari<select id="f-con">${conOpts(t?.contactId || "")}</select></label>` : ""}
    <label>Not<input id="f-note" value="${esc(t?.note || "")}" placeholder="İsteğe bağlı"></label>
    ${type !== "transfer" ? `<button type="button" class="btn ghost small" data-act="cats" style="justify-self:start;padding-left:0">Kategorileri düzenle</button>` : ""}
    ${formFoot(t?.id)}</form>`);
  updateTxnUnits();
}
function updateTxnUnits() {
  const f = $("#frm"); if (!f || f.dataset.kind !== "txn") return;
  const type = $("#f-type").value, a = acc($("#f-acc").value), code = accAsset(a);
  $("#f-amt-lbl").textContent = `Tutar (${amtUnit(a)})`;
  const amt = parseAmt($("#f-amount").value), conv = $("#f-conv");
  conv.hidden = true;
  if ($("#f-inst-row")) {
    const show = type === "gider" && isCredit(a), n = +$("#f-inst").value || 1; $("#f-inst-row").hidden = !show;
    const note = $("#f-inst-note"); note.hidden = !(show && n > 1);
    if (show && n > 1) note.textContent = `Aylık ${amt > 0 ? money(amt / n) : "—"} × ${n} ay. Kart limitinden tamamı (${amt > 0 ? money(amt) : "toplam"}) şimdi düşer; harcama analizi ve dönem içi harcamalar her aya bir taksit yazar.`;
  }
  if (type !== "transfer") {
    const row = $("#f-rate-row"); row.hidden = code === "TRY";
    if (code !== "TRY") {
      $("#f-rate-lbl").textContent = `Kur (1 ${unitOf(code)} = ? ₺)`;
      const inp = $("#f-rate"); inp.placeholder = String(rateOf(code) || "").replace(".", ",");
      const r = parseAmt(inp.value) || rateOf(code);
      if (amt > 0 && r) { conv.hidden = false; conv.textContent = `≈ ${money(amt * r)} · ${assetOf(code)[1]} için ${rateSource(code) === "canlı" && !parseAmt(inp.value) ? "güncel kur" : "girilen kur"} kullanılıyor`; }
    }
  } else {
    const b = acc($("#f-to").value), c2 = accAsset(b), row = $("#f-toamt-row"); row.hidden = code === c2;
    if (code !== c2) {
      $("#f-toamt-lbl").textContent = `Giriş miktarı (${amtUnit(b)})`;
      const r1 = rateOf(code), r2 = rateOf(c2), sug = amt > 0 && r1 && r2 ? Math.round(amt * r1 / r2 * 1000) / 1000 : null;
      $("#f-toamt").placeholder = sug != null ? String(sug).replace(".", ",") + " (kura göre)" : "";
      const got = parseAmt($("#f-toamt").value) || sug;
      if (amt > 0 && got) { conv.hidden = false; const tl = code === "TRY" ? amt : c2 === "TRY" ? got : amt * r1; conv.textContent = `${fmtAsset(amt, code)} → ${fmtAsset(got, c2)} · birim fiyat ${money(code === "TRY" ? amt / got : got / amt * (c2 === "TRY" ? 1 : r2))}${code === "TRY" ? " / " + unitOf(c2) : " / " + unitOf(code)}`; }
    }
  }
}
function planForm(p) {
  const dir = p?.dir || "ödeme";
  openSheet(p?.id ? "Vadeyi düzenle" : "Yeni vade", `<form class="form" id="frm" data-kind="plan" data-id="${esc(p?.id || "")}">
    <div class="seg" role="group" aria-label="Yön">${[["tahsilat", "Tahsilat (alacak)"], ["ödeme", "Ödeme (borç)"]].map(([v, l]) => `<button type="button" data-pdir="${v}" aria-pressed="${dir === v}">${l}</button>`).join("")}</div>
    <input type="hidden" id="f-dir" value="${dir}">
    <div class="f2"><label>Tutar (₺)<input id="f-amount" inputmode="decimal" required placeholder="0,00" value="${amtStr(p?.amount)}"></label>
    <label>Vade tarihi<input id="f-due" type="date" required value="${esc(p?.due || addDays(TODAY, 7))}"></label></div>
    <label>Cari<select id="f-con">${conOpts(p?.contactId || "")}</select></label>
    <div id="f-catwrap">${catFields(dir, p?.category, p?.sub)}</div>
    <div class="f2"><label>Tekrar<select id="f-rep">${opt([["yok", "Tek seferlik"], ["aylık", "Her ay"]], p?.repeat || "yok")}</select></label>
    <label>Not<input id="f-note" value="${esc(p?.note || "")}" placeholder="Fatura no, açıklama"></label></div>
    ${p?.status === "tamam" ? `<p class="muted" style="margin:0;font-size:.85rem">Bu vade ${p.doneDate ? dshort(p.doneDate) : ""} tarihinde tamamlandı.</p>` : ""}
    ${formFoot(p?.id)}</form>`);
}
function accountForm(a) {
  openSheet(a ? "Hesabı düzenle" : isCash({ kind: ui.newKind }) ? "Yeni nakit hesabı" : "Yeni hesap", `<form class="form" id="frm" data-kind="account" data-id="${esc(a?.id || "")}">
    <div class="f2"><label><span id="f-group-lbl">${isCash(a || { kind: ui.newKind }) ? "Grup" : "Banka / Grup"}</span><input id="f-group" list="dl-groups" value="${esc(a ? (a.group || inferGroup(a.name)) : (ui.newGroup || ""))}" placeholder="${isCash(a || { kind: ui.newKind }) ? "Nakit" : "Örn. Ziraat"}"><datalist id="dl-groups">${groupNames().map(g => `<option value="${esc(g)}">`).join("")}</datalist></label>
    <label>Hesap adı<input id="f-name" required value="${esc(a?.name || "")}" placeholder="${isCash(a || { kind: ui.newKind }) ? "Örn. Cüzdan, Kasa, Evdeki dolar" : "Örn. Bankomat, Yatırım, Bonus kart"}"></label></div>
    <div class="f2"><label>Tür<select id="f-kind">${opt(KINDS, a?.kind || ui.newKind || "banka")}</select></label>
    <label>Para / varlık cinsi<select id="f-asset">${assetOptions(a?.asset || "TRY")}</select></label></div>
    <div id="f-limit-box" ${isCredit(a || { kind: ui.newKind }) ? "" : "hidden"} style="display:grid;gap:10px;border:1px solid var(--line);border-radius:10px;padding:12px">
      <b style="font-size:.92rem">Kart / kredi limiti</b>
      <div class="f2"><label>Toplam limit (₺)<input id="f-limit" inputmode="decimal" value="${a && a.limit ? amtStr(a.limit) : ""}" placeholder="Örn. 90.000"></label>
      <label>Bankadaki güncel kalan limit (₺)<input id="f-avail" inputmode="decimal" placeholder="Örn. 37.253,42"></label></div>
      <div class="f2"><label>Dönem içi harcamalar (₺)<input id="f-spent" inputmode="decimal" placeholder="Örn. 48.534,82"></label>
      <label>Hesap kesim günü<input id="f-cut" inputmode="numeric" value="${a && a.cutDay ? a.cutDay : ""}" placeholder="Ayın kaçı? Örn. 15"></label></div>
      <p class="small-note" style="margin:0" id="f-avail-hint">Kalan limiti bankanın uygulamasından bakıp yazarsan, borç buna göre eşitlenir. Ekstreden gelen tutarlarla oluşan farklar böylece düzelir.</p>
    </div>
    ${a && isCredit(a) ? instListHtml(a) : ""}
    <label>Ekstre tanıma bilgisi <span class="muted" style="font-weight:400">(IBAN, hesap-ek no ya da kart son 4 hane; virgülle)</span><input id="f-ids" value="${esc((a?.ids || []).map(idLabel).join(", "))}" placeholder="Örn. TR26 0020 …, 8094007-18, 9099"></label>
    <p class="small-note" style="margin:-4px 0 0">Ekstre yüklediğinde kendiliğinden öğrenilir. Aynı bankada birden çok hesabın varsa ekstrelerin doğru hesaba gitmesini bu sağlar.</p>
    <div style="display:grid;gap:6px;border:1px solid var(--line);border-radius:10px;padding:10px 12px">
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="f-excl" style="width:auto" ${a?.excl ? "checked" : ""}> Toplamlara dahil etme <span class="muted" style="font-size:.82rem">(net pozisyon, varlıklar, nakit akışı)</span></label>
      <label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="f-hide" style="width:auto" ${a?.hide ? "checked" : ""}> Özet'te gizle <span class="muted" style="font-size:.82rem">(Hesaplar'da görünmeye devam eder)</span></label>
      <p class="small-note" style="margin:0">BES, borsa, emeklilik gibi hemen kullanamayacağın birikimler için uygun. İşlemleri ve bakiyesi tutulmaya devam eder.</p></div>
    <label><span id="f-open-lbl">Açılış bakiyesi (${amtUnit(a || { asset: "TRY" })})</span><input id="f-open" inputmode="decimal" value="${amtStr(a?.opening) || "0"}"></label>
    <p id="f-open-conv" class="small-note" style="margin:0"></p>
    <p class="muted" style="margin:0;font-size:.82rem">Aynı bankadaki hesaplar (bankomat, yatırım, kredi kartı) aynı grupta toplanır. Kredi kartı ve kredi borcunu eksi bakiye olarak gir (örn. -4500).</p>
    ${a ? `<p class="muted" style="margin:0;font-size:.85rem">Güncel bakiye: <b class="num">${fmtAsset(balanceOf(a), accAsset(a))}</b>${accAsset(a) !== "TRY" ? ` ≈ ${money(valueTRY(a))}` : ""}</p>` : ""}
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
    <div><div class="dhead"><span>Son işlemler</span></div><div class="list">${tx.map(t => `<div class="row"><div><div class="t">${esc(catLabel(t))}</div><div class="m">${dshort(t.date)}${t.note ? " · " + esc(t.note) : ""}</div></div><div class="amt ${t.type === "gelir" ? "pos" : "neg"}">${t.type === "gelir" ? "+" : "−"}${fmtAsset(t.amount, txAsset(t))}</div></div>`).join("") || `<p class="muted">İşlem yok.</p>`}</div></div>
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
  openSheet("Ne eklemek istiyorsun?", `<div class="form" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${[["new-gelir", "Gelir", "Satış, hizmet, faiz"], ["new-gider", "Gider", "Kira, fatura, maaş"], ["new-transfer", "Transfer", "Hesaplar arası para aktarımı"], ["new-plan", "Vade", "Yaklaşan ödeme veya tahsilat"], ["new-contact", "Cari", "Müşteri veya tedarikçi"], ["new-account", "Hesap", "Banka, kredi kartı, yatırım"], ["new-cash", "Nakit", "Cüzdan, kasa, evdeki döviz/altın"], ["import-stmt", "Ekstre", "Bankadan indirilen Excel/CSV"]].map(([a, t, s]) => `<button class="acard" data-act="${a}" type="button"><b>${t}</b><span class="muted" style="font-size:.84rem">${s}</span></button>`).join("")}</div>`);
}
/* --- harcama analizi (Özet) --- */
// renk ölçeği: en yüksek pay kırmızı, sonra turuncu, amber; küçük kalemler nötr
const heat = (rank, share) => share >= 0.25 || rank === 0 ? "var(--neg)" : rank === 1 || share >= 0.15 ? "#E8710A" : rank === 2 || share >= 0.08 ? "#D9A400" : "var(--muted)";
function analysisRange(k) {
  const d = pd(TODAY), y = d.getFullYear(), m = d.getMonth(), dim = new Date(y, m + 1, 0).getDate();
  if (k === "gecen-ay") return { a: iso(new Date(y, m - 1, 1)), b: iso(new Date(y, m, 0)), pa: iso(new Date(y, m - 4, 1)), pb: iso(new Date(y, m - 1, 0)), f: 1 / 3, lbl: "Geçen ay", cmp: "önceki 3 ayın ortalaması", cmpTo: "önceki 3 ayın ortalamasına" };
  if (k === "3-ay") return { a: iso(new Date(y, m - 2, 1)), b: TODAY, pa: iso(new Date(y, m - 5, 1)), pb: iso(new Date(y, m - 2, 0)), f: 1, lbl: "Son 3 ay", cmp: "önceki 3 ay", cmpTo: "önceki 3 aya" };
  return { a: iso(new Date(y, m, 1)), b: TODAY, pa: iso(new Date(y, m - 3, 1)), pb: iso(new Date(y, m, 0)), f: d.getDate() / dim / 3, lbl: "Bu ay", cmp: "son 3 ayın aynı dönemi", cmpTo: "son 3 ayın aynı dönemine" };
}
// Düzenli ödemeler: en az 2 farklı ayda, ayda ~1 kez, benzer tutarla tekrar eden harcama
// Havale/FAST açıklamasından okunur ad: "Borç ödemesi - HAKAN GEDİKLİ, Seyit Arslan, FAST..." → "Seyit Arslan · Borç ödemesi"
function payee(note) {
  let d = IMP.cleanDesc(note || ""); const me = IMP.up(mySurname());
  let m = d.match(/^(.*?)\s+-\s+([^,]+),\s*([^,]+),\s*(FAST|EFT|HAVALE)/i), desc = "";
  if (m) desc = m[1].trim(); else m = (d.match(/^()([^,\-]+),\s*([^,]+),\s*(FAST|EFT|HAVALE)/i));
  if (m) { const snd = m[2].trim(), rcv = m[3].trim(), who = me && IMP.up(snd).includes(me) ? rcv : snd; return who + (desc ? " · " + desc : ""); }
  return d.replace(/,?\s*(FAST|EFT)\s+Para Transferi.*$/i, "").replace(/,?\s*Ödeme Türü\s*:.*$/i, "")
    .replace(/^(GOOGLE|LINK\.COM|PAYPAL|APPLE\.COM\/BILL)\s*\*\s*/i, "").replace(/\b\d{4,}[-\d]*\b/g, "")
    .replace(/\s+(LONDON|DUBLIN|SYDNEY|SOUTH SAN FRA\w*|SAN FRANCISCO|AMSTERDAM|LUXEMBOURG|SINGAPORE)?\s*(GBR|USA|AUS|IRL|NLD|LUX|SGP|US)$/i, "").replace(/\s+/g, " ").trim();
}
const merchKey = t => IMP.learnKey(payee(t.note)).split(" ").slice(0, 2).join(" ");
const SUB_RX = /NETFLIX|SPOTIFY|YOUTUBE|GOOGLE|APPLE\.COM|ITUNES|ICLOUD|CLAUDE|ANTHROPIC|CHATGPT|OPENAI|CANVA|POE\.COM|MICROSOFT|ADOBE|DISNEY|EXXEN|BLUTV|BLU TV|AMAZON PRIME|PRIME VIDEO|TABII|GAIN|DIGITURK|D-SMART|NOTION|DROPBOX|ZOOM|LINKEDIN|WPS|CAPCUT|DUOLINGO|STORYTEL/;
const REG_CATS = ["Yazılım", "Eğlence / Abonelik", "Faturalar", "Kira", "Eğitim", "Vergi / SGK"];
function recurring() {
  const g = {};
  S.txns.filter(t => t.type === "gider" && !isMove(t) && t.note).forEach(t => { const k = merchKey(t); if (k) (g[k] = g[k] || []).push(t); });
  const out = [];
  for (const [k, l] of Object.entries(g)) {
    l.sort((x, y) => x.date < y.date ? -1 : 1);
    const last = l[l.length - 1], months = new Set(l.map(t => monthKey(t.date)));
    if (diffDays(last.date, TODAY) > 70) continue;
    const a = l.map(txTRY).sort((x, y) => x - y), med = a[Math.floor(a.length / 2)];
    const sub = SUB_RX.test(IMP.up(last.note).replace(/İ/g, "I"));
    const monthly = months.size >= 2 && l.length <= months.size * 1.5 && l.filter(t => Math.abs(txTRY(t) - med) <= med * 0.25).length / l.length >= 0.7;
    const exact = months.size >= 3 && l.filter(t => Math.abs(txTRY(t) - med) <= med * 0.03).length >= 3;
    if (!(sub || (monthly && (REG_CATS.includes(last.category) || exact)))) continue;
    out.push({ k, med: sub ? txTRY(last) : med, n: months.size, last: last.date, cat: last.category, sub, name: payee(last.note).slice(0, 34) });
  }
  return out.sort((x, y) => y.med - x.med);
}
// Hangi hesabın ekstresi dönemin sonuna kadar gelmiyor?
function coverageGaps(a, b) {
  return S.accounts.map(ac => {
    const l = S.txns.filter(t => (t.accountId === ac.id || t.importAcc === ac.id) && t.importKey); if (l.filter(t => t.date >= addDays(b, -90)).length < 5) return null;
    const last = l.reduce((m, t) => t.date > m ? t.date : m, "");
    return last < b && diffDays(last, b) >= 5 && last >= addDays(a, -75) ? { ac, last } : null;
  }).filter(Boolean);
}
function spendingAnalysis() {
  // ayın ilk günlerinde (az harcama varken) varsayılan olarak geçen ayı göster
  const TX = spreadTx(S.txns); // taksitli alışverişler aylara bölünür
  const thisMonthN = TX.filter(t => t.type === "gider" && t.date >= TODAY.slice(0, 8) + "01" && t.date <= TODAY).length;
  const day = pd(TODAY).getDate(), per = ui.anPeriod || (day <= 7 || (thisMonthN < 5 && day < 10) ? "gecen-ay" : "bu-ay"), R = analysisRange(per);
  const inR = (t, a, b) => t.date >= a && t.date <= b;
  // karşılaştırma yalnızca verisi olan aylarla (ör. ekstre sadece 2 ay geriye gidiyorsa 3'e bölme)
  { const ms = new Set(TX.filter(t => t.type === "gider" && t.date >= R.pa && t.date <= R.pb).map(t => monthKey(t.date))).size;
    if (per === "3-ay") R.f = ms >= 3 ? 1 : 0; else R.f = ms ? (per === "bu-ay" ? day / new Date(pd(TODAY).getFullYear(), pd(TODAY).getMonth() + 1, 0).getDate() : 1) / ms : 0; }
  const early = per === "bu-ay" && day < 15;
  const exp = TX.filter(t => t.type === "gider" && inR(t, R.a, R.b)), inc = TX.filter(t => t.type === "gelir" && inR(t, R.a, R.b));
  const prev = TX.filter(t => t.type === "gider" && inR(t, R.pa, R.pb));
  const E = sum(exp, txTRY), I = sum(inc, txTRY), PE = sum(prev, txTRY) * R.f;
  const by = {}, pby = {};
  exp.forEach(t => { const k = t.category || "Diğer gider"; (by[k] = by[k] || { v: 0, n: 0, s: {} }); by[k].v += txTRY(t); by[k].n++; if (t.sub) by[k].s[t.sub] = (by[k].s[t.sub] || 0) + txTRY(t); });
  prev.forEach(t => { const k = t.category || "Diğer gider"; pby[k] = (pby[k] || 0) + txTRY(t); });
  const arr = Object.entries(by).sort((x, y) => y[1].v - x[1].v);
  const P = [["bu-ay", "Bu ay"], ["gecen-ay", "Geçen ay"], ["3-ay", "Son 3 ay"]];
  const head = `<div class="ph"><div><h2>Harcama analizi · ${R.lbl}</h2><p>${exp.length} gider · <b class="num neg">${money(E)}</b>${PE > 0 ? ` · ${R.cmp}: ${money(PE)} <span class="${E > PE * 1.1 ? "neg" : E < PE * 0.9 ? "pos" : "muted"}">${E >= PE ? "▲" : "▼"} %${Math.abs(Math.round((E - PE) / PE * 100))}</span>` : ""}</p></div>
    <div class="seg" role="group" aria-label="Analiz dönemi">${P.map(([k, l]) => `<button type="button" data-an="${k}" aria-pressed="${per === k}">${l}</button>`).join("")}</div></div>`;
  if (!arr.length) return `<section class="panel">${head}<p class="muted" style="margin:0">Bu dönemde gider yok. Ekstreni içe aktarınca harcamaların burada kategori kategori incelenir.</p></section>`;
  // uyarılar
  const W = [], [tk, tv] = arr.find(([k]) => !/^Diğer/.test(k)) || arr[0], ts = tv.v / E;
  const unc0 = by["Diğer gider"]; if (unc0 && unc0.v / E >= 0.3) W.push({ l: "warn", t: `<b>Harcamaların %${Math.round(unc0.v / E * 100)} kadarı tanınamadı ("Diğer gider").</b> Analiz bu yüzden eksik; İşlemler'de bu kayıtlara kategori verirsen uygulama sonrakileri hatırlar.` });
  W.push({ l: ts >= 0.3 ? "neg" : "warn", t: `<b>En çok harcama: ${esc(tk)}</b> · ${money(tv.v)} · toplam gider içindeki payı <b>%${Math.round(ts * 100)}</b> (${tv.n} işlem).${ts >= 0.3 ? " Harcamalarının yaklaşık üçte biri tek kalemde; bu kategori için aylık üst sınır belirlemeyi düşün." : ""}` });
  const gaps = per !== "3-ay" ? coverageGaps(R.a, R.b) : [];
  if (gaps.length) W.unshift({ l: "warn", t: `<b>Bu dönemin verisi eksik.</b> ${gaps.slice(0, 3).map(g => `${esc(accName(g.ac))} (son hareket ${dshort(g.last)})`).join(", ")}${gaps.length > 3 ? ` ve ${gaps.length - 3} hesap daha` : ""}. Bu hesapların yeni ekstresini yükleyince analiz tamamlanır.` });
  if (per === "bu-ay" && day >= 7) { const dim = new Date(pd(TODAY).getFullYear(), pd(TODAY).getMonth() + 1, 0).getDate(), proj = E / day * dim, avg = R.f ? PE / (day / dim) : 0;
    W.push({ l: avg && proj > avg * 1.15 ? "neg" : "warn", t: `<b>Ay sonu tahmini: ${money0(proj)}</b> (günde ortalama ${money0(E / day)}).${avg ? ` Son aylarda bir ay ortalama ${money0(avg)}; ${proj > avg ? `bu hızla <b>${money0(proj - avg)} fazla</b> harcayacaksın.` : `bu hızla ${money0(avg - proj)} daha az harcayacaksın.`}` : ""}` }); }
  { const fq = {}; exp.forEach(t => { const k = merchKey(t); if (k) { (fq[k] = fq[k] || { n: 0, v: 0, d: payee(t.note) }); fq[k].n++; fq[k].v += txTRY(t); } });
    const f = Object.values(fq).sort((x, y) => y.n - x.n)[0]; if (f && f.n >= 4) W.push({ l: "warn", t: `<b>En sık gittiğin yer: ${esc(f.d.slice(0, 40))}</b> · ${f.n} kez, toplam ${money0(f.v)} (ortalama ${money0(f.v / f.n)}). Küçük ama sık harcamalar ayın sonunda büyük toplam ediyor.` }); }
  const movIn = sum(S.txns.filter(t => isMove(t) && t.type === "gelir" && inR(t, R.a, R.b)), txTRY);
  if (early) {} else if (E > I && movIn >= E - I) W.push({ l: "warn", t: `<b>Gelirin eksik görünüyor.</b> Bu dönem harcaman ${money(E)}, kayıtlı gelirin ${money(I)}; paranın çoğu kendi hesaplarından aktarılmış (${money(movIn)}). Maaşın yattığı hesabın ekstresini de yüklersen gelir-gider dengesi doğru hesaplanır.` });
  else if (I > 0 && E > I) W.push({ l: "neg", t: `<b>Gider geliri aştı.</b> ${money(E - I)} açık var; bu dönem kazandığından fazlasını harcadın.` });
  else if (I > 0 && E / I >= 0.85) W.push({ l: "warn", t: `<b>Gelirinin %${Math.round(E / I * 100)} kadarını harcadın.</b> Kenara kalan: ${money(I - E)}.` });
  arr.map(([k, o]) => { const base = (pby[k] || 0) * R.f; return { k, v: o.v, base, ch: base > 0 ? (o.v - base) / base : null }; })
    .filter(x => !early && x.ch != null && x.ch >= 0.3 && x.v - x.base >= 300).sort((x, y) => (y.v - y.base) - (x.v - x.base)).slice(0, 2)
    .forEach(x => W.push({ l: x.ch >= 0.6 ? "neg" : "warn", t: `<b>${esc(x.k)} harcaman arttı:</b> ${R.cmp} ${money(x.base)} iken şimdi ${money(x.v)} (<b>+%${Math.round(x.ch * 100)}</b>).` }));
  arr.filter(([k, o]) => !early && R.f > 0 && !pby[k] && o.v >= Math.max(500, E * 0.08)).slice(0, 1).forEach(([k, o]) => W.push({ l: "warn", t: `<b>Yeni kalem: ${esc(k)}</b> · ${money(o.v)}. Önceki dönemde bu kategoride harcama yoktu.` }));
  arr.map(([k, o]) => ({ k, v: o.v, base: (pby[k] || 0) * R.f })).filter(x => !early && x.base >= 500 && x.v <= x.base * 0.7).slice(0, 1)
    .forEach(x => W.push({ l: "pos", t: `<b>${esc(x.k)} azaldı:</b> ${R.cmpTo} göre %${Math.round((1 - x.v / x.base) * 100)} daha az harcadın.` }));
  const uncategorized = by["Diğer gider"]; if (uncategorized && uncategorized.v / E >= 0.1 && uncategorized.v / E < 0.3) W.push({ l: "warn", t: `<b>Harcamaların %${Math.round(uncategorized.v / E * 100)} kadarı "Diğer gider" kategorisinde.</b> İşlemler'den bunlara kategori verirsen analiz netleşir.` });
  // en çok harcanan yerler
  const pl = {}; exp.filter(t => t.category !== "Diğer gider" || t.note).forEach(t => { const k = t.note ? merchKey(t) : (con(t.contactId)?.name || ""); if (!k) return; (pl[k] = pl[k] || { n: 0, v: 0, d: t.note ? payee(t.note) : k }); pl[k].n++; pl[k].v += txTRY(t); });
  const places = Object.entries(pl).sort((x, y) => y[1].v - x[1].v).slice(0, 5).map(([k, o]) => [o.d.slice(0, 40), o]);
  // halka grafik
  const R0 = 64, C = 2 * Math.PI * R0; let off = 0;
  const top6 = arr.slice(0, 6), restV = E - sum(top6, x => x[1].v);
  const seg = (v, col, title) => { const len = v / E * C, s = `<circle r="${R0}" cx="80" cy="80" fill="none" stroke="${col}" stroke-width="24" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"><title>${esc(title)}</title></circle>`; off += len; return s; };
  const donut = `<svg viewBox="0 0 160 160" style="width:170px;max-width:100%;height:auto;flex:none" role="img" aria-label="Harcamaların kategori dağılımı">
    ${top6.map(([k, o], i) => seg(o.v, heat(i, o.v / E), `${k}: ${money(o.v)}`)).join("")}${restV > 0.5 ? seg(restV, "var(--line)", `Diğer: ${money(restV)}`) : ""}
    <text x="80" y="76" text-anchor="middle" style="fill:var(--muted);font:10px var(--f-body)">toplam gider</text><text x="80" y="95" text-anchor="middle" style="fill:var(--ink);font:600 14px var(--f-num)">${esc(money0(E))}</text></svg>`;
  const mx = arr[0][1].v;
  const rows = arr.map(([k, o], i) => { const sh = o.v / E, col = heat(i, sh), base = early ? 0 : (pby[k] || 0) * R.f, ch = base > 0 ? (o.v - base) / base : null;
    const subs = Object.entries(o.s).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([s, v]) => `${esc(s)} ${money0(v)}`).join(" · ");
    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px;padding:9px 0;border-top:1px solid var(--line)">
      <div style="min-width:0"><span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${col};margin-right:7px"></span><b ${i === 0 ? `style="color:${col}"` : ""}>${esc(k)}</b>${i === 0 ? ` <span class="pill neg" style="font-size:.66rem">en yüksek</span>` : sh >= 0.25 ? ` <span class="pill neg" style="font-size:.66rem">yüksek pay</span>` : ""}</div>
      <div class="num" style="text-align:right;${i < 3 ? `color:${col};font-weight:600` : ""}">${money(o.v)}</div>
      <div style="grid-column:1/-1;height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="width:${(o.v / mx * 100).toFixed(1)}%;height:100%;background:${col}"></div></div>
      <div class="muted" style="font-size:.78rem;min-width:0">%${Math.round(sh * 100)} · ${o.n} işlem${subs ? " · " + subs : ""}</div>
      <div style="font-size:.78rem;text-align:right;white-space:nowrap">${ch == null ? `<span class="muted">${pby[k] || !R.f || early ? "" : "yeni"}</span>` : `<span class="${ch > 0.1 ? "neg" : ch < -0.1 ? "pos" : "muted"}">${ch >= 0 ? "▲" : "▼"} %${Math.abs(Math.round(ch * 100))}</span>`}</div></div>`; }).join("");
  const wcol = l => l === "neg" ? "background:var(--neg-soft);border-left:3px solid var(--neg)" : l === "pos" ? "background:var(--pos-soft);border-left:3px solid var(--pos)" : "background:var(--warn-soft);border-left:3px solid var(--warn)";
  return `<section class="panel">${head}
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">${donut}
      <div style="flex:1 1 280px;min-width:0;display:grid;gap:8px">${W.map(w => `<div style="${wcol(w.l)};border-radius:8px;padding:9px 12px;font-size:.9rem">${w.t}</div>`).join("")}</div></div>
    <div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))">
      <div style="min-width:0"><div class="dhead" style="padding-top:0"><span>Kategoriler · yüksekten düşüğe</span><span>${per === "3-ay" ? "önceki 3 aya göre" : "ortalamaya göre"}</span></div>${rows}</div>
      <div style="min-width:0"><div class="dhead" style="padding-top:0"><span>En çok harcanan yerler</span></div>
        ${places.map(([k, o], i) => `<div class="row" style="padding:9px 2px"><div><div class="t" ${i === 0 ? 'style="color:var(--neg)"' : ""}>${esc(k)}</div><div class="m">${o.n} işlem · ortalama ${money0(o.v / o.n)}</div></div><div class="amt ${i === 0 ? "neg" : ""}">${money(o.v)}</div></div>`).join("") || `<p class="muted">Açıklaması olan işlem yok.</p>`}
        <p class="small-note">Bir harcamanın kategorisi yanlışsa İşlemler'de kayda dokunup düzelt; ekstreden gelen benzer kayıtlar bundan sonra o kategoriye düşer.</p></div>
    </div>
    ${(() => {
      const big = exp.slice().sort((x, y) => txTRY(y) - txTRY(x)).slice(0, 5);
      const subs = recurring(), subT = sum(subs, x => x.med);
      const un = {}; exp.filter(t => t.category === "Diğer gider").forEach(t => { const k = IMP.learnKey(t.note || "") || "(açıklamasız)"; (un[k] = un[k] || { n: 0, v: 0, d: payee(t.note) }); un[k].n++; un[k].v += txTRY(t); });
      const unl = Object.entries(un).sort((x, y) => y[1].v - x[1].v).slice(0, 6);
      const col = (title, sub, body) => `<div style="min-width:0"><div class="dhead" style="padding-top:0"><span>${title}</span>${sub ? `<span>${sub}</span>` : ""}</div>${body}</div>`;
      return `<div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))">
        ${col("En büyük harcamalar", "", big.map(t => `<div class="row click" data-edit-txn="${esc(t.instOf || t.id)}" style="padding:8px 2px"><div style="min-width:0"><div class="t" style="font-size:.9rem">${esc(payee(t.note) || catLabel(t))}</div><div class="m">${dshort(t.date)} · ${esc(catLabel(t))}${t.instK ? ` · ${t.instK}/${instN(t)}. taksit` : ""}</div></div><div class="amt neg">${money(txTRY(t))}</div></div>`).join(""))}
        ${col("Düzenli ödemeler", subs.length ? `aylık ≈ ${money0(subT)}` : "", subs.length ? subs.slice(0, 8).map(x => `<div class="row" style="padding:8px 2px"><div style="min-width:0"><div class="t" style="font-size:.9rem">${esc(x.name)}</div><div class="m">${x.sub ? `<span class="pill acc">abonelik</span> ` : ""}${esc(x.cat || "")} · ${x.n > 1 ? x.n + " aydır" : "aylık"} · son ${dshort(x.last)}</div></div><div class="amt">${money(x.med)}</div></div>`).join("") + `<p class="small-note">Her ay benzer tutarla tekrar eden ödemeler (abonelik, fatura). Kullanmadığın varsa iptal etmek yıllık ${money0(subT * 12)} içinde tasarruf demek.</p>` : `<p class="muted" style="font-size:.88rem">En az 2 ay tekrar eden ödeme bulunamadı.</p>`)}
        ${unl.length ? col("Tanınmayan harcamalar", "kategori seç", unl.map(([k, o]) => `<div class="row" style="padding:8px 2px;display:block"><div style="display:flex;justify-content:space-between;gap:8px"><span class="t" style="font-size:.88rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.d || k)}</span><span class="num neg" style="font-size:.88rem">${money0(o.v)}</span></div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px"><span class="m" style="white-space:nowrap">${o.n} işlem</span><select class="an-uncat" data-key="${esc(k)}" style="padding:3px 6px;font-size:.8rem;width:auto;max-width:100%"><option value="">Kategori seç…</option>${impCatOptions("gider", "").replace(/ selected/g, "").replace(/<option value="Diğer gider"[^>]*>[^<]*<\/option>/, "")}</select></div></div>`).join("") + `<p class="small-note">Seçtiğin kategori bu açıklamaya sahip tüm kayıtlara ve sonraki ekstrelere uygulanır.</p>`) : ""}
      </div>`;
    })()}
  </section>`;
}

/* --- veri kontrolü: analizi bozan kayıtlar --- */
const ignored = () => { try { return JSON.parse(ls.get("kd-ign") || "{}"); } catch (e) { return {}; } };
function dataIssues() {
  const ign = ignored(), sn = mySurname();
  const dupAmt = S.txns.filter(t => t.type !== "transfer" && !ign[t.id] && splitDup(t.amount));
  const moves = S.txns.filter(t => t.type !== "transfer" && !isMove(t) && !ign[t.id] && IMP.ownMove(t.note, sn));
  const mv = new Set(moves.map(t => t.id));
  const recat = S.txns.filter(t => t.type !== "transfer" && /^Diğer (gider|gelir)$/.test(t.category || "") && t.note && !mv.has(t.id) && !ign[t.id]).map(t => {
    let g = IMP.guessCategory(t.note, t.type === "gelir" ? 1 : -1, {}); if (/^Diğer/.test(g)) return null;
    if (!g.includes("|")) { const gs = IMP.guessSub(t.note); if (gs && subsOf(t.type, g).includes(gs)) g += "|" + gs; }
    return { t, g };
  }).filter(Boolean);
  return { dupAmt, moves, recat, n: dupAmt.length + moves.length + recat.length };
}
function dataCheckNotice() {
  const D = dataIssues(); if (!D.n) return "";
  const parts = [D.dupAmt.length ? `<b>${D.dupAmt.length} işlemin tutarı hatalı okunmuş</b> (ör. ${money(D.dupAmt[0].amount)} → ${money(splitDup(D.dupAmt[0].amount))})` : "", D.moves.length ? `<b>${D.moves.length} işlem kendi hesapların arasında para aktarımı</b> ama gelir/gider sayılıyor (${money0(sum(D.moves, txTRY))})` : "", D.recat.length ? `<b>${D.recat.length} "Diğer" kaydı</b> artık kategorilenebiliyor` : ""].filter(Boolean);
  return `<div class="notice warn" style="margin:0 0 14px"><span>Özetteki rakamlar şu yüzden yanıltıcı: ${parts.join("; ")}.</span><button class="btn small primary" data-act="data-check">İncele ve düzelt</button></div>`;
}
function dataCheckPanel() {
  const D = dataIssues(), sn = mySurname();
  const row = (t, right, why) => `<label class="row" style="grid-template-columns:auto minmax(0,1fr) auto;cursor:pointer"><input type="checkbox" class="dc-sel" value="${esc(t.id)}" checked style="width:auto">
    <span style="min-width:0"><span class="t" style="display:block;font-size:.88rem">${esc((t.note || catLabel(t)).slice(0, 70))}</span><span class="m">${dshort(t.date)} · ${esc(accName(acc(t.accountId)) || "")} · ${why}</span></span><span class="amt" style="font-size:.86rem;text-align:right">${right}</span></label>`;
  openSheet("Veri kontrolü", `<div class="form" id="dcPanel">
    ${D.dupAmt.length ? `<div><b>Hatalı okunan tutarlar</b><p class="small-note" style="margin:2px 0 6px">Yurt dışı harcamalarda ekstredeki iki tutar sütunu yan yana okunup birleşmiş. Okuyucu düzeltildi; bu kayıtların tutarı da düzelir.</p>
      <div class="list" style="border:1px solid var(--line);border-radius:8px;padding:0 8px">${D.dupAmt.map(t => row(t, `<s class="muted">${money(t.amount)}</s><br><b>${money(splitDup(t.amount))}</b>`, esc(t.category || ""))).join("")}</div></div>` : ""}
    ${D.moves.length ? `<div><b>Kendi hesapların arası para hareketleri</b><p class="small-note" style="margin:2px 0 6px">Kendi hesabından kendine havale, kart borcu ödemesi, ATM yatırma/çekme gibi hareketler gelir veya gider değildir; analizde gelirini ve giderini şişirir. Seçilenler <b>"${MOVE_CAT}"</b> kategorisine alınır: bakiyeler değişmez, sadece analiz ve raporlardan çıkar.</p>
      <div class="list" style="max-height:44vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:0 8px">${D.moves.sort((a, b) => b.amount - a.amount).map(t => row(t, `<span class="${t.type === "gelir" ? "pos" : "neg"}">${t.type === "gelir" ? "+" : "−"}${money(t.amount)}</span>`, `${t.type} · ${esc(IMP.ownMove(t.note, sn))}`)).join("")}</div></div>` : ""}
    ${D.recat.length ? `<div><b>Kategorisi bulunabilen "Diğer" kayıtları</b><p class="small-note" style="margin:2px 0 6px">Yeni eklenen tanıma kurallarıyla (lokanta, EGO, KKDF/vade farkı, mobilya…) bu kayıtların kategorisi bulundu.</p>
      <div class="list" style="max-height:36vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:0 8px">${D.recat.map(({ t, g }) => row(t, `<span class="${t.type === "gelir" ? "pos" : "neg"}">${money(t.amount)}</span>`, `→ <b>${esc(g.replace("|", " › "))}</b>`)).join("")}</div></div>` : ""}
    <div class="foot"><button type="button" class="btn ghost small" data-act="dc-ignore">Seçilenleri yok say</button><div class="r"><button type="button" class="btn" data-close>Vazgeç</button><button type="button" class="btn primary" data-act="dc-apply">Seçilenleri düzelt</button></div></div>
  </div>`);
}
async function dataCheckApply(ignore) {
  const ids = new Set([...document.querySelectorAll(".dc-sel:checked")].map(i => i.value)); if (!ids.size) { toast("Önce kayıt seç."); return; }
  if (ignore) { const g = ignored(); ids.forEach(id => { g[id] = 1; }); ls.set("kd-ign", JSON.stringify(g)); toast(`${ids.size} kayıt yok sayıldı`); closeSheet(); return render(); }
  const sn = mySurname(), ops = [], rc = new Map(dataIssues().recat.map(x => [x.t.id, x.g]));
  for (const t of S.txns.filter(t => ids.has(t.id))) {
    const o = { ...t }, f = splitDup(t.amount);
    if (f) { o.amount = f; const p = (o.importKey || "").split("|"); if (p.length >= 3) { p[2] = String((+p[2] < 0 ? -1 : 1) * f); o.importKey = p.join("|"); } }
    if (!isMove(t) && IMP.ownMove(t.note, sn)) { o.category = MOVE_CAT; o.sub = ""; }
    else if (rc.has(t.id)) { const [c, sb = ""] = rc.get(t.id).split("|"); o.category = c; o.sub = sb; }
    const { id, ...d } = o; ops.push({ type: "set", col: "txns", id, data: d });
  }
  if (live()) { if (!(await safe(() => batchWrite(ops)))) return; Drive.dirty(); }
  else { ops.forEach(o => { const i = S.txns.findIndex(t => t.id === o.id); S.txns[i] = { id: o.id, ...o.data }; }); saveDemo(); }
  toast(`${ops.length} kayıt düzeltildi`); closeSheet(); render();
}

/* --- yüklenen ekstreler: geri al / taşı --- */
function importBatches() {
  const m = new Map();
  for (const t of S.txns) {
    if (!t.importKey) continue;
    const ia = t.importAcc || t.accountId, k = (t.importId || "eski") + "|" + ia;
    if (!m.has(k)) m.set(k, { key: k, legacy: !t.importId, file: t.importFile || "", at: t.importAt || "", accountId: ia, txs: [] });
    m.get(k).txs.push(t);
  }
  return [...m.values()].map(b => { const d = b.txs.map(t => t.date).sort(); return { ...b, from: d[0], to: d[d.length - 1], inc: sum(b.txs.filter(t => t.type === "gelir"), t => t.amount), exp: sum(b.txs.filter(t => t.type === "gider"), t => t.amount), prevOpening: b.txs.find(t => t.importPrevOpening != null)?.importPrevOpening }; })
    .sort((x, y) => (y.at || "") < (x.at || "") ? -1 : 1);
}
function importsPanel() {
  const bs = importBatches();
  openSheet("Yüklenen ekstreler", `<div class="form">
    ${otherTxs().length ? `<button class="btn" type="button" data-act="recat" style="justify-self:start">"Diğer"deki ${otherTxs().length} işlemi otomatik kategorilendir</button>` : ""}
    <p style="margin:0">Yanlış hesaba ya da yanlış ekstre yüklediysen ilgili satıra dokun; işlemleri toplu <b>silebilir</b> veya <b>doğru hesaba taşıyabilirsin</b>.</p>
    <div class="list">${bs.map(b => { const ac = acc(b.accountId);
      return `<div class="row click" data-batch="${esc(b.key)}"><div style="min-width:0"><div class="t">${esc(b.legacy ? "Önceki içe aktarımlar" : (b.file || "Ekstre"))}</div>
        <div class="m">${esc(ac ? accName(ac) : "Silinmiş hesap")} · ${b.txs.length} işlem · ${dshort(b.from)} – ${dshort(b.to)}${b.at ? " · yüklendi " + tfmt.format(new Date(b.at)) : ""}</div></div>
        <div class="amt" style="font-size:.85rem"><span class="pos">+${money0(b.inc)}</span><br><span class="neg">−${money0(b.exp)}</span></div></div>`; }).join("") || `<p class="muted">Ekstreden yüklenmiş işlem yok.</p>`}</div>
    <div class="foot"><span></span><div class="r"><button class="btn" data-close>Kapat</button></div></div></div>`);
}
function batchPanel(key) {
  const b = importBatches().find(x => x.key === key); if (!b) return importsPanel();
  const ac = acc(b.accountId), code = accAsset(ac);
  const prevOk = b.prevOpening != null && ac && b.txs.some(t => t.importPrevOpening != null && t.importKey.startsWith(ac.id + "|"));
  openSheet("Ekstreyi düzelt", `<div class="form" id="batchPanel" data-key="${esc(key)}">
    <p style="margin:0"><b>${esc(b.legacy ? "Önceki içe aktarımlar" : (b.file || "Ekstre"))}</b> · ${esc(ac ? accName(ac) : "")}<br><span class="muted" style="font-size:.88rem">${b.txs.length} işlem · ${dshort(b.from)} – ${dshort(b.to)}</span></p>
    ${b.legacy ? `<p class="small-note" style="margin:0">Bu kayıtlar ekstre geçmişi tutulmadan önce yüklendi; bu hesaba ekstreden gelen tüm işlemler birlikte listeleniyor. Doğru olanların işaretini kaldır.</p>` : ""}
    <label style="display:flex;gap:8px;align-items:center;font-size:.88rem"><input type="checkbox" id="b-all" style="width:auto" checked> Tümünü seç</label>
    <div class="list" style="max-height:40vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:0 8px">
      ${b.txs.slice().sort((x, y) => x.date < y.date ? -1 : 1).map(t => `<label class="row" style="grid-template-columns:auto minmax(0,1fr) auto;cursor:pointer"><input type="checkbox" class="b-sel" value="${esc(t.id)}" checked style="width:auto">
        <span style="min-width:0"><span class="t" style="display:block;font-size:.9rem">${esc(t.note || catLabel(t))}</span><span class="m">${dshort(t.date)} · ${esc(catLabel(t))}</span></span>
        ${(() => { const inn = t.type === "gelir" || (t.type === "transfer" && t.toAccountId === b.accountId), v = t.type === "transfer" && t.toAccountId === b.accountId ? (t.toAmount ?? t.amount) : t.amount;
          return `<span class="amt ${inn ? "pos" : "neg"}" style="font-size:.9rem">${t.type === "transfer" ? "⇄ " : ""}${inn ? "+" : "−"}${fmtAsset(v, code)}</span>`; })()}</label>`).join("")}
    </div>
    ${code !== "TRY" ? `<div style="display:grid;gap:8px;border-top:1px solid var(--line);padding-top:12px">
      <b>Tutarlar TL olarak mı kaydedildi?</b>
      <p class="small-note" style="margin:0">Örneğin 3 gr altın alımı ${fmtAsset(13000, code)} gibi görünüyorsa, seçilenleri ${esc(unitOf(code))} cinsine çevir. Miktar açıklamada yazıyorsa (ör. "3 GR") o kullanılır, yoksa güncel kurla (1 ${esc(unitOf(code))} = ${money(rateOf(code) || 0)}) hesaplanır.</p>
      <div><button class="btn primary" type="button" data-act="batch-unit">Seçilenleri ${esc(unitOf(code))} cinsine çevir</button></div></div>` : ""}
    <div style="display:grid;gap:8px;border-top:1px solid var(--line);padding-top:12px">
      <b>Doğru hesaba taşı</b>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><select id="b-target" style="flex:1 1 200px">${accOpts(S.accounts.find(x => x.id !== b.accountId)?.id)}</select><button class="btn primary" type="button" data-act="batch-move">Seçilenleri taşı</button></div>
    </div>
    <div style="display:grid;gap:8px;border-top:1px solid var(--line);padding-top:12px">
      <b>Ya da tamamen sil</b>
      ${prevOk && +ac.opening !== b.prevOpening ? `<label style="display:flex;gap:8px;align-items:center;font-size:.88rem"><input type="checkbox" id="b-restore" style="width:auto" checked> Yükleme sırasında değişen açılış bakiyesini eski değerine (${fmtAsset(b.prevOpening, code)}) döndür</label>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn danger" type="button" data-act="batch-del">Seçilenleri sil</button><button class="btn" type="button" data-act="imports">Geri</button></div>
    </div></div>`);
}
async function batchApply(kind, btn) {
  const key = $("#batchPanel").dataset.key, b = importBatches().find(x => x.key === key); if (!b) return;
  const ids = new Set([...document.querySelectorAll(".b-sel:checked")].map(i => i.value));
  const list = b.txs.filter(t => ids.has(t.id)); if (!list.length) { toast("Önce işlem seç."); return; }
  if (kind === "del" && btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = `Evet, ${list.length} işlemi sil`; return; }
  const ops = [];
  if (kind === "unit") {
    const code = accAsset(acc(b.accountId));
    list.forEach(t => { if (t.type === "transfer") return; const c = tlToUnit(+t.amount, t.note || "", code); if (!c.qty) return;
      const parts = (t.importKey || "").split("|"); if (parts.length >= 3) parts[2] = String((+parts[2] < 0 ? -1 : 1) * c.qty);
      const { id, ...d } = { ...t, amount: c.qty, rate: c.price, tlAmount: +t.amount, importKey: parts.join("|") }; ops.push({ type: "set", col: "txns", id, data: d }); });
    if (!ops.length) { toast("Kur bulunamadı; Kurlar'dan fiyat gir."); return; }
  } else if (kind === "del") {
    list.forEach(t => ops.push({ type: "delete", col: "txns", id: t.id }));
    const ac = acc(b.accountId); if ($("#b-restore")?.checked && ac) { const { id, ...d } = { ...ac, opening: b.prevOpening }; ops.push({ type: "set", col: "accounts", id, data: d }); }
  } else {
    const to = $("#b-target").value; if (to === b.accountId) { toast("Farklı bir hesap seç."); return; }
    list.forEach(t => { const side = t.importAcc && t.toAccountId === t.importAcc ? { toAccountId: to } : { accountId: to };
      const { id, importPrevOpening, ...d } = { ...t, ...side, ...(t.importAcc ? { importAcc: to } : {}), importKey: t.importKey.replace(/^[^|]+/, to) }; ops.push({ type: "set", col: "txns", id, data: d }); });
  }
  if (live()) { if (!(await safe(() => batchWrite(ops)))) return; Drive.dirty(); }
  else {
    for (const o of ops) { if (o.type === "delete") S.txns = S.txns.filter(t => t.id !== o.id); else if (o.col === "txns") { const i = S.txns.findIndex(t => t.id === o.id); S.txns[i] = { id: o.id, ...o.data }; } else { const ac = acc(o.id); Object.assign(ac, o.data); } }
    saveDemo(); render();
  }
  toast(kind === "unit" ? `${ops.length} işlem ${unitOf(accAsset(acc(b.accountId)))} cinsine çevrildi` : kind === "del" ? `${list.length} işlem silindi` : `${list.length} işlem ${accName(acc($("#b-target").value))} hesabına taşındı`);
  closeSheet();
}

/* --- toplu kategori düzeltme --- */
function learnedMap() {
  const m = {}; S.txns.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => { if (t.note && t.category && !/^Diğer/.test(t.category) && t.type !== "transfer") m[IMP.learnKey(t.note)] = t.category + (t.sub ? "|" + t.sub : ""); }); return m;
}
const otherTxs = () => S.txns.filter(t => t.importKey && t.type !== "transfer" && /^Diğer (gider|gelir)$/.test(t.category || ""));
async function recategorize() {
  const learned = learnedMap(), ops = []; let n = 0;
  for (const t of S.txns.filter(t => t.importKey && t.type !== "transfer")) {
    const note = IMP.cleanDesc(t.note || ""); const isOther = /^Diğer/.test(t.category || "");
    const upd = { ...t, note };
    if (isOther) {
      let g = IMP.guessCategory(note, t.type === "gelir" ? 1 : -1, learned);
      if (!g.includes("|")) { const gs = IMP.guessSub(note); if (gs && subsOf(t.type, g).includes(gs)) g += "|" + gs; }
      const [c, sub = ""] = g.split("|"); if (c !== t.category) { upd.category = c; upd.sub = sub; n++; }
    }
    if (upd.note !== t.note || upd.category !== t.category) { const { id, ...d } = upd; ops.push({ type: "set", col: "txns", id, data: d }); }
  }
  if (!ops.length) { toast("Yeni tahmin edilebilecek kategori bulunamadı."); return; }
  if (live()) { if (!(await safe(() => batchWrite(ops)))) return; Drive.dirty(); }
  else { ops.forEach(o => { const i = S.txns.findIndex(t => t.id === o.id); S.txns[i] = { id: o.id, ...o.data }; }); saveDemo(); render(); }
  const left = otherTxs().length;
  toast(`${n} işleme kategori verildi${left ? `; ${left} işlem hâlâ "Diğer"de` : ""}`);
}
function offerBulk(t, oldCat) {
  const k = IMP.learnKey(t.note || ""); if (!k || !t.note) return;
  const same = S.txns.filter(x => x.id !== t.id && x.type === t.type && x.note && IMP.learnKey(x.note) === k && x.category === oldCat);
  if (!same.length) return;
  ui.bulk = { ids: same.map(x => x.id), category: t.category, sub: t.sub || "" };
  openSheet("Benzer işlemler", `<div class="form"><p style="margin:0"><b>${esc(IMP.cleanDesc(t.note))}</b> için ${same.length} işlem daha var ve hepsi "${esc(oldCat)}" kategorisinde.</p>
    <p style="margin:0">Hepsini <b>${esc(catLabel(t))}</b> yapayım mı? Gelecek ekstrelerde de bu yer otomatik bu kategoriye düşer.</p>
    <div class="foot"><span></span><div class="r"><button class="btn" data-close>Hayır, sadece bunu</button><button class="btn primary" data-act="bulk-apply">Hepsini değiştir (${same.length})</button></div></div></div>`);
}
async function bulkApply() {
  const B = ui.bulk; if (!B) return closeSheet();
  const ops = B.ids.map(id => S.txns.find(t => t.id === id)).filter(Boolean).map(t => { const { id, ...d } = { ...t, category: B.category, sub: B.sub }; return { type: "set", col: "txns", id, data: d }; });
  if (live()) { if (!(await safe(() => batchWrite(ops)))) return; Drive.dirty(); }
  else { ops.forEach(o => { const i = S.txns.findIndex(t => t.id === o.id); S.txns[i] = { id: o.id, ...o.data }; }); saveDemo(); render(); }
  toast(`${ops.length} işlem güncellendi`); ui.bulk = null; closeSheet();
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
    <div class="foot" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn" data-act="export-json">Yedek dosyası indir</button><button class="btn" data-act="import">Yedek dosyasından yükle</button><button class="btn" data-act="cats">Kategoriler</button><button class="btn" data-act="rates">Kurlar</button></div>
    <div class="foot"><span></span><div class="r"><button class="btn danger" data-act="signout">Çıkış yap</button></div></div></div>`);
}
function ratesPanel() {
  const used = [...new Set(S.accounts.map(accAsset).filter(c => c !== "TRY"))];
  const list = ui.ratesAll ? ASSETS.filter(x => x[0] !== "TRY").map(x => x[0]) : used;
  const body = `<div class="form" id="ratesPanel">
    <p style="margin:0">Döviz ve altın hesapların bu kurlarla TL'ye çevrilir (alış fiyatı). Kaynak: Truncgil Finans${RATES.date ? ` · son güncelleme <b>${esc(RATES.date)}</b>` : ""}.</p>
    ${RATES.failed ? `<p class="neg" style="margin:0;font-size:.88rem">Canlı kurlar şu an alınamadı. Son bilinen ya da elle girdiğin kurlar kullanılıyor.</p>` : ""}
    <div class="tbl-wrap"><table><thead><tr><th>Varlık</th><th class="r">Canlı kur</th><th>Elle kur (isteğe bağlı)</th></tr></thead><tbody>
    ${list.map(c => `<tr><td>${esc(assetOf(c)[1])} <span class="muted">/ ${esc(unitOf(c))}</span></td><td class="r num">${RATES.auto[c] ? money(RATES.auto[c]) : "—"}</td>
      <td><input class="mrate" data-code="${c}" inputmode="decimal" style="max-width:150px" value="${RATES.manual[c] ? amtStr(RATES.manual[c]) : ""}" placeholder="boş = canlı"></td></tr>`).join("") || `<tr><td colspan="3" class="muted">Döviz ya da altın hesabın yok.</td></tr>`}
    </tbody></table></div>
    <div class="foot" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" type="button" data-act="rates-save">Elle kurları kaydet</button><button class="btn" type="button" data-act="rates-refresh">Canlı kurları yenile</button>
      <button class="btn ghost" type="button" data-act="rates-all">${ui.ratesAll ? "Sadece kullandıklarım" : "Tüm varlıkları göster"}</button></div></div>`;
  if ($("#ratesPanel")) $("#ratesPanel").outerHTML = body; else openSheet("Kurlar", body);
}
function saveManualRates() {
  const m = { ...RATES.manual };
  document.querySelectorAll(".mrate").forEach(i => { const v = parseAmt(i.value); if (v > 0) m[i.dataset.code] = v; else delete m[i.dataset.code]; });
  RATES.manual = m; ls.set("kd-manual-rates", JSON.stringify(m));
  if (live()) fb.fs.setDoc(metaRef(), { manualRates: m }, { merge: true }).catch(e => toast(failMsg(e)));
  toast("Kurlar kaydedildi"); render(); ratesPanel();
}
const CM = { type: "gider", edit: null };
function catManager() {
  const o = catsObj(), list = o[CM.type];
  const cnt = n => S.txns.filter(t => catKind(t.type) === CM.type && t.category === n).length;
  const body = `<div class="form" id="catPanel">
    <div class="seg" role="group"><button type="button" data-cm-type="gider" aria-pressed="${CM.type === "gider"}">Gider kategorileri</button><button type="button" data-cm-type="gelir" aria-pressed="${CM.type === "gelir"}">Gelir kategorileri</button></div>
    <form class="f2" data-kind="cm-add" style="align-items:end"><label>Yeni ${CM.type} kategorisi<input id="cm-new" placeholder="Örn. Araç, Çocuk, One More"></label><button class="btn primary" type="submit">Ekle</button></form>
    <div class="list">${list.map((c, i) => `<div style="border-top:1px solid var(--line);padding:10px 2px;display:grid;gap:8px">
      ${CM.edit && CM.edit.i === i && CM.edit.k === "ren" ? `<form class="f2" data-kind="cm-ren" data-i="${i}" style="align-items:end"><label>Yeni ad<input id="cm-ren" value="${esc(c.n)}"></label><div style="display:flex;gap:6px"><button class="btn primary small" type="submit">Kaydet</button><button class="btn small" type="button" data-cm-cancel>Vazgeç</button></div></form>`
      : `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(c.n)} <span class="muted" style="font-weight:400;font-size:.8rem">${cnt(c.n)} işlem</span></b>
        <span style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small" type="button" data-cm-addsub="${i}">+ Alt</button><button class="btn small" type="button" data-cm-ren="${i}">Adını değiştir</button><button class="btn small danger" type="button" data-cm-del="${i}">Sil</button></span></div>`}
      ${c.s.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${c.s.map((s, j) => `<span class="pill acc" style="display:inline-flex;gap:6px;align-items:center;font-size:.8rem">${esc(s)}<button type="button" class="btn ghost small" style="padding:0 2px;min-height:0" data-cm-delsub="${i}|${j}" aria-label="${esc(s)} alt kategorisini sil">✕</button></span>`).join("")}</div>` : ""}
      ${CM.edit && CM.edit.i === i && CM.edit.k === "sub" ? `<form class="f2" data-kind="cm-sub" data-i="${i}" style="align-items:end"><label>Alt kategori adı<input id="cm-sub" placeholder="Örn. Elektrik"></label><div style="display:flex;gap:6px"><button class="btn primary small" type="submit">Ekle</button><button class="btn small" type="button" data-cm-cancel>Vazgeç</button></div></form>` : ""}
    </div>`).join("")}</div>
    <p class="small-note" style="margin:0">Bir kategoriyi silmek geçmiş işlemleri silmez; sadece listeden kaldırır. Adını değiştirince eski işlemler de yeni ada taşınır.</p></div>`;
  if ($("#catPanel")) $("#catPanel").outerHTML = body; else openSheet("Kategoriler", body);
  if (CM.edit) setTimeout(() => $("#cm-ren,#cm-sub")?.focus(), 30);
}
function cmSubmit(f) {
  const o = JSON.parse(JSON.stringify(catsObj())), list = o[CM.type], k = f.dataset.kind, i = +f.dataset.i;
  if (k === "cm-add") { const n = $("#cm-new").value.trim(); if (!n) return; if (list.some(c => c.n.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr"))) { toast("Bu kategori zaten var."); return; } list.push({ n, s: [] }); saveCats(o); toast(`"${n}" eklendi`); }
  else if (k === "cm-sub") { const n = $("#cm-sub").value.trim(); if (!n) return; if (!list[i].s.includes(n)) list[i].s.push(n); CM.edit = null; saveCats(o); }
  else if (k === "cm-ren") {
    const n = $("#cm-ren").value.trim(), old = list[i].n; if (!n || n === old) { CM.edit = null; return catManager(); }
    list[i].n = n; CM.edit = null; saveCats(o);
    const tx = S.txns.filter(t => catKind(t.type) === CM.type && t.category === old), pl = S.plans.filter(p => catKind(p.dir) === CM.type && p.category === old);
    tx.forEach(t => put("txns", { ...t, category: n })); pl.forEach(p => put("plans", { ...p, category: n }));
    toast(`"${old}" → "${n}"${tx.length + pl.length ? ` · ${tx.length + pl.length} kayıt güncellendi` : ""}`);
  }
  catManager();
}
function drivePanel() {
  const d = Drive;
  const body = `<div class="form" id="drivePanel">
    <p style="margin:0">Her değişiklikten birkaç saniye sonra tüm kayıtların Google Drive'ındaki <b>${DRIVE_FOLDER}</b> klasörüne <b>${DRIVE_FILE}</b> olarak kaydedilir. Tek bir dosya tutulur ve her seferinde güncellenir.</p>
    <dl class="kv"><dt>Durum</dt><dd>${d.state === "ok" ? '<span class="pos">Bağlı</span>' : d.state === "busy" ? '<span style="color:var(--warn)">' + esc(d.msg || "Çalışıyor") + "</span>" : d.state === "need" ? (d.lastBackup && Date.now() - new Date(d.lastBackup) < 24 * 3600e3 ? '<span class="pos">Yedek güncel</span> <span class="muted">· yeni değişiklikler bir sonraki yedekte Drive\'a gider</span>' : '<span style="color:var(--warn)">Son yedek 1 günden eski. Aşağıdan tek dokunuşla yedekle.</span>') : d.state === "err" ? '<span class="neg">' + esc(d.msg) + "</span>" : "Kapalı"}</dd>
    <dt>Son yedek</dt><dd>${d.lastBackup ? tfmt.format(new Date(d.lastBackup)) : "Henüz yok"}</dd>
    ${d.fileId ? `<dt>Dosya</dt><dd><a href="https://drive.google.com/file/d/${esc(d.fileId)}/view" target="_blank" rel="noopener" style="color:var(--accent)">Drive'da aç</a></dd>` : ""}</dl>
    <div class="foot" style="justify-content:flex-start;flex-wrap:wrap">
      <button class="btn primary" data-act="drive-save" ${d.busy ? "disabled" : ""}>Şimdi Drive'a yedekle</button>
      <span id="restoreSlot"><button class="btn" data-act="drive-restore">Drive'dan geri yükle</button></span>
    </div>
    <p class="muted" style="margin:0;font-size:.82rem">Kayıtların her zaman bulutta (Firebase) anlık olarak saklanır; Drive'daki dosya ek bir yedektir. Google, tarayıcıdan verilen Drive iznini güvenlik gereği 1 saatte bir sona erdirdiği için uygulama Drive yedeğini açık olduğu sürede otomatik alır, sonra günde bir hatırlatır.</p></div>`;
  if ($("#drivePanel")) $("#drivePanel").outerHTML = body; else openSheet("Google Drive yedeği", body);
}

/* ---------- banka ekstresi içe aktarma ---------- */
let imp = null;
const impCatOptions = (type, sel) => { const out = []; const names = [...new Set([...catNames(type), ...CATS[catKind(type)]])]; for (const c of names) { out.push([c, c]); for (const s of subsOf(type, c)) out.push([c + "|" + s, c + " › " + s]); } if (sel && !out.some(o => o[0] === sel)) out.push([sel, sel.replace("|", " › ")]); return out.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join(""); };
function openImport(accountId) {
  if (!S.accounts.length) { toast("Önce bankan için bir hesap ekle."); return accountForm(); }
  const accId = accountId || (acc(ls.get("kd-imp-acc")) ? ls.get("kd-imp-acc") : S.accounts[0].id);
  imp = { accountId: accId };
  openSheet("Banka ekstresi içe aktar", `<div class="form">
    <p style="margin:0">İnternet veya mobil bankacılıktan <b>hesap hareketlerini PDF, Excel ya da CSV</b> olarak indir, sonra burada seç. <b>Ekran görüntüsü / fotoğraf</b> da olur (birden fazla seçebilirsin). Kayıtlar eklenmeden önce sana gösterilir.</p>
    <label>Hangi hesabın ekstresi?<select id="imp-acc">${accOpts(accId)}</select></label>
    <button class="btn primary" type="button" data-act="imp-pick" style="justify-content:center;padding:12px">Dosya seç</button>
    <button class="btn" type="button" data-act="gmail" style="justify-content:center;padding:12px">✉ Gmail'deki ekstrelerden seç</button>
    <input type="file" id="stmtFile" multiple accept="image/*,.pdf,.xlsx,.xls,.csv,.txt,.ods,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden>
    ${S.txns.some(t => t.importKey) ? `<button class="btn ghost small" type="button" data-act="imports" style="justify-self:start;padding-left:0">Yüklediğin ekstreler · yanlış yüklemeyi geri al</button>` : ""}
    <details class="small-note"><summary>Ekstreyi nereden indiririm?</summary>
      <p>Çoğu bankada: <b>Hesaplarım → hesabı seç → Hesap hareketleri → tarih aralığı → İndir / Excel</b>. Mobil uygulamada bulamazsan internet şubesinden indir. PDF de olur; taranmış (fotoğraf) PDF'ler okunamaz. Şifreli PDF'te şifre sorulur.</p></details>
  </div>`);
}
async function readStatement(file, password) {
  try {
    const files = Array.isArray(file) ? file : [file]; file = files[0];
    const img = files.every(f => IMP.isImage(f));
    toast(img ? "Görsel okunuyor… (ilk seferde okuyucu indirilir, 10-20 sn sürebilir)" : "Dosya okunuyor…");
    imp.file = file;
    let lastP = -1; const prog = p => { const k = Math.round(p * 100); if (k - lastP >= 5) { lastP = k; toast(`Görsel okunuyor… %${k}`); } };
    const rows = img && files.length > 1 ? await IMP.imagesToRows(files, prog) : await IMP.fileToRows(file, password, prog);
    if (img) file = { name: files.length > 1 ? `${files.length} ekran görüntüsü` : file.name };
    if (!rows || !rows.length) { toast("Dosyada okunabilir satır yok."); return; }
    setupImp(rows, file);
    clearTimeout(tt); $("#toastRoot").innerHTML = ""; renderImport();
  } catch (e) {
    if (e instanceof IMP.PdfPasswordError) { clearTimeout(tt); $("#toastRoot").innerHTML = ""; return askPdfPassword(e.wrong); }
    toast((e && e.message) || "Dosya okunamadı.");
  }
}
// okunan satırlardan içe aktarma önizlemesini kurar (ekransız da çalışır: Gmail otomatik içe aktarma)
function setupImp(rows, file) {
    let hIdx = IMP.detectHeader(rows);
    if (hIdx < 0) hIdx = 0;
    const headers = (rows[hIdx] || []).map(h => String(h ?? "").trim());
    const sig = IMP.headerSignature(headers);
    let map = null; try { map = JSON.parse(ls.get("kd-map:" + sig) || "null"); } catch (e) { }
    if (!map) { map = IMP.guessMapping(headers, rows.slice(hIdx + 1)); const ex = IMP.extract(rows, hIdx, map); if (acc(imp.accountId)?.kind === "kredi kartı" && ex.length && ex.filter(x => x.amount > 0).length > ex.length * 0.6) map.invert = true; }
    Object.assign(imp, { fileName: file.name, rows, hIdx, headers, sig, map, fixOpening: false, unitFor: null, unitMode: null, tradeAcc: tradeAccDefault(acc(imp.accountId)) });
    imp.meta = rows.meta || null;
    imp.ids = [...new Set([...(rows.ids || IMP.statementIds(rows.slice(0, 15).map(r => (r || []).join(" ")).join("\n"))), ...IMP.statementIds("", file && file.name)])];
    if (imp.meta && isCredit(acc(imp.accountId))) { if (imp.meta.limit) imp.limit = imp.meta.limit; if (imp.meta.cutDay) imp.cut = imp.meta.cutDay; }
    buildImpItems();
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
// Döviz/altın hesabına ekstre: tutar hesap biriminde mi (gr, adet, $) yoksa TL mi?
function impUnitSetup() {
  const a = acc(imp.accountId), code = accAsset(a), m = imp.map, H = (imp.headers || []).map(h => IMP.up(h));
  if (code === "TRY") return { code, mode: "unit" };
  if (imp.unitFor !== code) { // yeni dosya / hesap: otomatik karar
    imp.unitFor = code;
    const amtH = H[m.mode === "split" ? m.debit : m.amount] || "";
    const qc = m.qtyCol >= 0 && m.qtyCol !== m.amount && m.qtyCol !== m.debit && m.qtyCol !== m.credit ? m.qtyCol : -1;
    if (qc >= 0) imp.unitMode = "col";
    else if (/\b(TL|TRY)\b/.test(amtH)) imp.unitMode = "tl";
    else {
      const ex = IMP.extract(imp.rows, imp.hIdx, m, { qty: true }).map(x => Math.abs(x.amount)).sort((x, y) => x - y);
      const med = ex.length ? ex[Math.floor(ex.length / 2)] : 0, grp = assetOf(code)[3], u = unitOf(code);
      imp.unitMode = grp !== "Para" && med > (u === "adet" ? 20 : 100) ? "tl" : "unit";
    }
  }
  return { code, mode: imp.unitMode || "unit" };
}
// TL tutarı hesap birimine çevir: önce açıklamadaki miktar (3 GR), yoksa güncel kur
function tlToUnit(tl, desc, code) {
  const d = IMP.qtyFromDesc(desc), r = rateOf(code) || 0;
  const qty = d || (r ? Math.round(tl / r * 1000) / 1000 : 0);
  return { qty, price: qty ? Math.round(tl / qty * 100) / 100 : r, fromDesc: !!d };
}
const TRADE_RX = /\b(ALIS|ALIM|SATIS|SATIM|BOZDUR|DONUSUM|ALTIN AL|DOVIZ AL|DOVIZ SAT|ALTIN SAT)/;
function tradeAccDefault(a) { const t = S.accounts.filter(x => accAsset(x) === "TRY" && !isCredit(x)); return (t.find(x => groupOf(x) === groupOf(a)) || t[0] || {}).id || ""; }
function buildImpItems() {
  const U = impUnitSetup(), m = imp.map;
  let ext = IMP.extract(imp.rows, imp.hIdx, m, U.code === "TRY" ? {} : { qty: U.mode === "unit", qtyCol: U.mode === "col" ? m.qtyCol : -1 });
  if (U.code !== "TRY" && U.mode !== "unit") ext = ext.map(x => {
    const sg = x.amount < 0 ? -1 : 1, tl = Math.abs(x.amount);
    if (U.mode === "col" && x.q) return { ...x, amount: sg * x.q, tl, price: Math.round(tl / x.q * 100) / 100 };
    const c = tlToUnit(tl, x.rawDesc || x.desc, U.code); if (!c.qty) return null;
    return { ...x, amount: sg * c.qty, tl, price: c.price, est: !c.fromDesc, balance: null };
  }).filter(Boolean);
  const learned = {};
  const byContact = {};
  S.txns.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => {
    if (t.type === "transfer" || !t.category) return;
    if (t.note && !/^Diğer (gider|gelir)$/.test(t.category)) learned[IMP.learnKey(t.note)] = t.category + (t.sub ? "|" + t.sub : "");
    if (t.contactId) byContact[t.contactId + "|" + t.type] = t.category;
  });
  const keys = new Set(S.txns.map(t => t.importKey).filter(Boolean));
  const occ = {};
  const contacts = S.contacts.filter(c => c.name && c.name.length >= 4).map(c => ({ id: c.id, n: IMP.up(c.name) }));
  const seenInst = [], acNow = imp.accountId, usedMan = new Set();
  imp.items = ext.map(x => {
    const base = `${imp.accountId}|${x.date}|${x.amount}|${IMP.learnKey(x.desc)}`;
    occ[base] = (occ[base] || 0) + 1;
    const key = base + "|" + occ[base];
    const type = x.amount > 0 ? "gelir" : "gider", amt = Math.abs(x.amount);
    const exact = keys.has(key);
    const maybe = !exact && S.txns.some(t => t.date === x.date && (t.accountId === imp.accountId && t.type === type && Math.abs(t.amount - amt) < 0.01
      || t.type === "transfer" && (type === "gider" && t.accountId === imp.accountId && Math.abs(t.amount - amt) < 0.01 || type === "gelir" && t.toAccountId === imp.accountId && Math.abs((t.toAmount ?? t.amount) - amt) < 0.01)));
    const D = IMP.up(x.desc), ct = contacts.find(c => D.includes(c.n));
    const isCard = acc(imp.accountId)?.kind === "kredi kartı";
    if (isCard && ((x.amount > 0 && /ODEME|ÖDEME|TESEKKUR|TEŞEKKÜR|PAYMENT|HESAPTAN/i.test(IMP.up(x.desc))) || /TESEKKUR|TEŞEKKÜR|ÖDEMENİZ|ODEMENIZ/.test(IMP.up(x.desc)))) {
      return { ...x, amount: Math.abs(x.amount), key, type: "gelir", amt, dup: "kart", sel: false, cat: "Diğer gelir", contactId: "" };
    }
    if (U.code !== "TRY" && TRADE_RX.test(D)) return { ...x, key, type, amt, dup: exact ? "var" : maybe ? "olası" : "", sel: !exact && !maybe, cat: type === "gelir" ? "Diğer gelir" : "Diğer gider", contactId: "", trade: true, tl: x.tl || Math.round(amt * (x.price || rateOf(U.code) || 0) * 100) / 100 };
    let cat = IMP.ownMove(x.desc, mySurname()) ? MOVE_CAT : IMP.guessCategory(x.desc, x.amount, learned);
    if (ct && /^Diğer/.test(cat) && byContact[ct.id + "|" + type]) cat = byContact[ct.id + "|" + type];
    if (!cat.includes("|")) { const sg = IMP.guessSub(x.desc); if (sg && subsOf(type, cat).includes(sg)) cat += "|" + sg; }
    // elle girilmiş (ekstresiz) kayıt: aynı gün, yakın tutar → ekstredeki kayıt onun yerine geçer (çift sayılmaz, açıklama ve doğru tutar gelir)
    const man = !exact ? S.txns.find(t => t.accountId === acNow && !t.importKey && t.type === type && t.date === x.date && !usedMan.has(t.id) && Math.abs(t.amount - amt) <= Math.max(5, amt * 0.15)) : null;
    const mc = man && man.category && !/^Diğer/.test(man.category) ? man.category : "", gc = /^Diğer/.test(cat) ? "" : cat.split("|")[0];
    if (man && mc && gc && mc !== gc && !(man.note || "").trim()) { // kategori çelişiyor: otomatik değiştirme, kullanıcı karar versin
      usedMan.add(man.id); return { ...x, key, type, amt, dup: "elle?", sel: false, manAmt: man.amount, manCat: mc, cat, contactId: ct ? ct.id : "" };
    }
    if (man) { usedMan.add(man.id); return { ...x, key, type, amt, dup: "elle", sel: true, replaceId: man.id, manAmt: man.amount, cat: man.category && !/^Diğer/.test(man.category) && man.category !== "Transfer" ? man.category + (man.sub ? "|" + man.sub : "") : cat, contactId: man.contactId || (ct ? ct.id : "") }; }
    const item = { ...x, key, type, amt, dup: exact ? "var" : maybe ? "olası" : "", sel: !exact && !maybe, cat, contactId: ct ? ct.id : "" };
    const ii = isCard && type === "gider" && !exact ? instInfo(x.desc) : null;
    if (ii) { // ekstredeki taksit satırı → tek bir taksitli alışveriş
      const per = amt, buy = addMonths(x.date, -(ii.k - 1)), near = d => Math.abs(diffDays(d, buy)) <= 45;
      const legacy = S.txns.some(t => t.accountId === acNow && !instN(t) && t.type === "gider" && Math.abs(t.amount - per) < 0.01 && (instInfo(t.note) || {}).n === ii.n);
      if (legacy) return { ...item, instPart: ii };
      const have = S.txns.find(t => t.accountId === acNow && instN(t) === ii.n && Math.abs(t.amount / ii.n - per) < 1.01 && near(t.date)) || seenInst.find(s => s.n === ii.n && Math.abs(s.per - per) < 1.01 && near(s.date));
      if (have) return { ...item, dup: "taksit", sel: false, instPart: ii };
      const total = ii.total && Math.abs(ii.total / ii.n - per) < 1.01 ? ii.total : Math.round(per * ii.n * 100) / 100;
      seenInst.push({ n: ii.n, per, date: buy });
      const clean = x.desc.replace(/\s*[\d.]+,\d{2}\s*TL['’]?\s*L[İIiı]K\s+İŞLEM.*$/i, "").replace(/\s*TAKS[İIiı]T\S*\s*:?\s*\d{1,2}\s*\/\s*\d{1,2}|\s*\d{1,2}\s*\/\s*\d{1,2}\s*\.?\s*TAKS\S*/gi, "").trim() || x.desc;
      return { ...item, desc: clean, amount: -total, amt: total, date: buy, inst: ii.n, instPart: ii, instPer: per };
    }
    return item;
  });
}
function impBalanceInfo() {
  const it = imp.items.filter(x => x.balance != null); if (!it.length) return null;
  const desc = it.length > 1 && it[0].date > it[it.length - 1].date;
  const maxD = it.reduce((m, x) => x.date > m ? x.date : m, "");
  const sameDay = it.filter(x => x.date === maxD);
  const latest = desc ? sameDay[0] : sameDay[sameDay.length - 1];
  const a = acc(imp.accountId); if (!a) return null;
  const after = balanceOf(a) + sum(imp.items.filter(x => x.sel), x => x.amount + (x.replaceId ? (x.type === "gider" ? x.manAmt : -x.manAmt) : 0));
  return { bank: latest.balance, after, diff: Math.round((latest.balance - after) * 100) / 100, date: latest.date };
}
function renderImport() {
  const m = imp.map, H = imp.headers;
  const colOpts = (sel, blank) => `<option value="-1">${blank || "— yok —"}</option>` + H.map((h, i) => `<option value="${i}" ${+sel === i ? "selected" : ""}>${esc(h || `Sütun ${i + 1}`)}</option>`).join("");
  const items = imp.items, sel = items.filter(x => x.sel);
  const inc = sum(sel.filter(x => x.amount > 0), x => x.amount), exp = sum(sel.filter(x => x.amount < 0), x => -x.amount);
  const dates = items.map(x => x.date).sort();
  const bi = impBalanceInfo(), IC = accAsset(acc(imp.accountId));

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
    ${(() => { const code = accAsset(acc(imp.accountId)); if (code === "TRY") return ""; const u = unitOf(code), est = items.filter(x => x.est).length;
      return `<div style="display:grid;gap:8px;border:1px solid var(--line);border-radius:10px;padding:12px">
      <label>Ekstredeki tutarlar hangi birimde?<select id="imp-unit">${opt([["unit", `${u} — hesabın kendi birimi`], ["tl", `TL — ${u} olarak çevir`], ...(imp.map.qtyCol >= 0 && ![imp.map.amount, imp.map.debit, imp.map.credit].includes(imp.map.qtyCol) ? [["col", `Miktar sütunu (${esc(imp.headers[imp.map.qtyCol] || "")}) + TL tutar`]] : [])], imp.unitMode || "unit")}</select></label>
      ${items.some(x => x.trade) ? `<label>Alış / satışlar hangi TL hesabından?<select id="imp-trade"><option value="">— Transfer yapma, gelir/gider say —</option>${S.accounts.filter(x => accAsset(x) === "TRY" && !isCredit(x)).map(x => `<option value="${esc(x.id)}" ${x.id === imp.tradeAcc ? "selected" : ""}>${esc(accName(x))}</option>`).join("")}</select></label>
      <p class="small-note" style="margin:0">${items.filter(x => x.trade).length} alış/satış satırı TL hesabıyla <b>transfer</b> olarak kaydedilir: alışta TL hesabından para çıkar, ${esc(unitOf(code))} bu hesaba girer. Gelir/gider raporlarını şişirmez. O TL hesabının ekstresini sonra yüklersen bu satırlar "olası tekrar" diye işaretlenir.</p>` : ""}
      <p class="small-note" style="margin:0">Hesap ${esc(assetOf(code)[1])} cinsinden; işlemler <b>${u}</b> olarak kaydedilir. ${imp.unitMode === "tl" ? `Miktar açıklamada yazıyorsa (ör. "3 GR") o alınır, yazmıyorsa güncel kurla (1 ${u} = ${money(rateOf(code) || 0)}) hesaplanır${est ? `; <b>${est} satır kurla tahmin edildi</b>, kontrol et` : ""}.` : imp.unitMode === "col" ? "Miktar ilgili sütundan, alış fiyatı TL tutardan alınır." : `Tutarlar ${u} değil de TL ise yukarıdan "TL" seç.`}</p></div>`; })()}
    ${(() => { const m = accountForIds(imp.ids); if (m && m.id !== imp.accountId) return `<div class="notice warn" style="margin:0"><span><b>Bu ekstre başka bir hesaba ait görünüyor:</b> ${esc(accName(m))} (${(imp.ids || []).filter(i => (m.ids || []).includes(i)).map(idLabel).join(", ")}).</span><button class="btn small primary" type="button" data-act="imp-switch" data-acc="${esc(m.id)}">O hesaba aktar</button></div>`;
      if (imp.ids && imp.ids.length && !(acc(imp.accountId)?.ids || []).some(i => imp.ids.includes(i))) return `<p class="small-note" style="margin:0">Ekstrede bulunan kimlik: <b>${imp.ids.map(idLabel).join(", ")}</b>. Eklediğinde bu hesaba kaydedilir; sonraki ekstreler (otomatik içe aktarma dahil) bununla doğru hesaba gider.</p>`; return ""; })()}
    ${isCredit(acc(imp.accountId)) ? `<div style="display:grid;gap:8px;border:1px solid var(--line);border-radius:10px;padding:12px">
      <b style="font-size:.92rem">Kart limiti</b>
      <div class="f2"><label>Toplam limit (₺)<input id="imp-limit" inputmode="decimal" value="${imp.limit != null ? amtStr(imp.limit) : acc(imp.accountId).limit ? amtStr(acc(imp.accountId).limit) : ""}" placeholder="Örn. 90.000"></label>
      <label>Bankadaki güncel kalan limit (₺)<input id="imp-avail" inputmode="decimal" value="${imp.avail != null ? amtStr(imp.avail) : ""}" placeholder="Örn. 37.253,42"></label></div>
      <div class="f2"><label>Dönem içi harcamalar (₺)<input id="imp-spent" inputmode="decimal" value="${imp.spent != null && !isNaN(imp.spent) ? amtStr(imp.spent) : ""}" placeholder="Örn. 48.534,82"></label>
      <label>Hesap kesim günü<input id="imp-cut" inputmode="numeric" value="${imp.cut || acc(imp.accountId).cutDay || ""}" placeholder="Örn. 15"></label></div>
      ${imp.meta && (imp.meta.limit || imp.meta.cutDay || imp.meta.debt != null) ? `<p class="small-note" style="margin:0;color:var(--pos)">Ekstreden okundu: ${[imp.meta.limit ? "kart limiti " + money0(imp.meta.limit) : "", imp.meta.cutDay ? "kesim günü " + imp.meta.cutDay : "", imp.meta.debt != null ? "dönem borcu " + money(imp.meta.debt) : ""].filter(Boolean).join(" · ")}</p>` : ""}
      <p class="small-note" style="margin:0">Yazarsan kartın borcu bankadaki rakama sabitlenir; ekstredeki geçmiş harcamalar limiti ikinci kez düşürmez, sadece analizde kullanılır.</p></div>` : ""}
    ${bi && !isCredit(acc(imp.accountId)) ? `<div class="notice ${Math.abs(bi.diff) < 0.01 ? "" : "warn"}" style="margin:0"><span>${Math.abs(bi.diff) < 0.01 ? `<b>Bakiye tutuyor.</b> Bankadaki bakiye (${dshort(bi.date)}) ile uygulamadaki bakiye aynı: <b class="num">${fmtAsset(bi.bank, IC)}</b>` : `<b>Bakiye farkı var.</b> Bankada <b class="num">${fmtAsset(bi.bank, IC)}</b>, içe aktarma sonrası uygulamada <b class="num">${fmtAsset(bi.after, IC)}</b> olacak (fark ${IC === "TRY" ? signed(bi.diff) : fmtAsset(bi.diff, IC)}).<br><label style="display:flex;gap:8px;align-items:center;margin-top:6px;color:var(--ink);font-size:.9rem"><input type="checkbox" id="imp-fix" style="width:auto" ${imp.fixOpening ? "checked" : ""}> Açılış bakiyesini düzelterek eşitle (${fmtAsset((+acc(imp.accountId).opening || 0) + bi.diff, IC)})</label>`}</span></div>` : ""}
    ${impAnalysis(sel)}
    ${items.length ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <label style="display:flex;gap:8px;align-items:center;font-size:.88rem"><input type="checkbox" id="imp-all" style="width:auto" ${sel.length === items.length ? "checked" : ""}> Tümünü seç</label>
      <span class="num" style="font-size:.88rem"><span class="pos">+${fmtAsset(inc, IC)}</span> · <span class="neg">−${fmtAsset(exp, IC)}</span></span></div>
    <div class="list" style="max-height:48vh;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:0 8px">
      ${items.slice(0, 600).map((x, i) => `<div class="row" style="grid-template-columns:auto minmax(0,1fr) auto;opacity:${x.sel ? 1 : .55}">
        <input type="checkbox" class="imp-sel" data-i="${i}" ${x.sel ? "checked" : ""} style="width:auto" aria-label="Seç">
        <div style="min-width:0"><div class="t" style="font-size:.9rem;font-weight:500">${esc(x.desc || "(açıklama yok)")}</div>
          <div class="m">${dshort(x.date)}${x.dup ? ` · <span style="color:var(--warn)">${x.dup === "var" ? "zaten eklendi" : x.dup === "kart" ? "kart ödemesi: gelir değil, bankadan karta transfer olarak gir" : x.dup === "taksit" ? `${x.instPart.k}/${x.instPart.n}. taksit: alışveriş zaten kayıtlı` : x.dup === "elle" ? `elle girdiğin ${money(x.manAmt)} kaydın yerine geçer` : x.dup === "elle?" ? `elle girdiğin ${money(x.manAmt)} (${esc(x.manCat)}) kaydınla aynı olabilir` : "olası tekrar"}</span>` : ""}${x.inst ? ` · <span class="pill acc">${x.inst} taksit · aylık ${money(x.instPer)}</span> <span class="muted">(ekstrede ${x.instPart.k}/${x.inst}. taksit)</span>` : ""}${x.contactId ? ` · ${esc(con(x.contactId)?.name || "")}` : ""}</div>
          ${x.trade && imp.tradeAcc ? `<span class="pill acc" style="margin-top:4px;display:inline-block">⇄ ${x.amount > 0 ? "←" : "→"} ${esc(accName(acc(imp.tradeAcc)) || "")}</span>` : `<select class="imp-cat" data-i="${i}" style="margin-top:4px;padding:4px 6px;font-size:.82rem;width:auto;max-width:100%">${impCatOptions(x.type, x.cat)}</select>`}</div>
        <div class="amt ${x.amount > 0 ? "pos" : "neg"}" style="font-size:.92rem;text-align:right">${x.amount > 0 ? "+" : "−"}${fmtAsset(x.amt, IC)}${IC !== "TRY" ? `<div class="muted" style="font-size:.74rem;font-weight:400">${x.tl ? money(x.tl) : "≈ " + money(x.amt * (rateOf(IC) || 0))}${x.est ? " · kurla" : ""}</div>` : ""}</div></div>`).join("")}
    </div>${items.length > 600 ? `<p class="small-note">İlk 600 satır gösteriliyor; hepsi eklenecek.</p>` : ""}` : ""}
    <div class="foot"><button type="button" class="btn" data-act="import-stmt">Başka dosya</button><div class="r"><button type="button" class="btn" data-close>Vazgeç</button>
      <button type="button" class="btn primary" data-act="imp-commit" ${sel.length || imp.fixOpening ? "" : "disabled"}>${sel.length} işlemi ekle</button></div></div>
  </div>`;
  if ($("#impPanel")) { const sc = $("#impPanel .list")?.scrollTop; $("#impPanel").outerHTML = body; if (sc && $("#impPanel .list")) $("#impPanel .list").scrollTop = sc; }
  else openSheet("Ekstreyi kontrol et", body);
}
function impAnalysis(sel) {
  if (accAsset(acc(imp.accountId)) !== "TRY") return "";
  const ex = sel.filter(x => x.amount < 0); if (ex.length < 2) return "";
  const tot = sum(ex, x => x.amt), by = {}, merch = {};
  ex.forEach(x => { const c = x.cat.split("|")[0]; by[c] = (by[c] || 0) + x.amt; const k = IMP.learnKey(x.desc) || x.desc; (merch[k] = merch[k] || { n: 0, v: 0, d: x.desc }).n++; merch[k].v += x.amt; });
  const cats = Object.entries(by).sort((a, b) => b[1] - a[1]), mx = cats[0][1];
  const top = Object.values(merch).sort((a, b) => b.v - a.v).slice(0, 5);
  const unk = by["Diğer gider"] || 0;
  return `<details class="panel" style="padding:12px" ${ui.impAnalysisOpen === false ? "" : "open"} id="impAn"><summary style="cursor:pointer;font-weight:600">Harcama analizi · ${money(tot)} · ${ex.length} harcama</summary>
    <div class="bars" style="margin-top:10px">${cats.map(([c, v]) => `<div class="bar"><span>${esc(c)}</span><div class="track"><div class="fill" style="width:${(v / mx * 100).toFixed(1)}%;background:var(--neg)"></div></div><span class="num">${money0(v)} <span class="muted">%${Math.round(v / tot * 100)}</span></span></div>`).join("")}</div>
    <div class="dhead" style="padding-left:0"><span>En çok harcanan yerler</span></div>
    <div style="display:grid;gap:4px;font-size:.86rem">${top.map(m => `<div style="display:flex;justify-content:space-between;gap:10px"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.d)}${m.n > 1 ? ` <span class="muted">×${m.n}</span>` : ""}</span><span class="num neg">${money0(m.v)}</span></div>`).join("")}</div>
    ${unk ? `<p class="small-note" style="margin:8px 0 0">${money0(unk)} tutarındaki harcama tanınamadı ("Diğer gider"). Aşağıdan kategorisini seçersen uygulama sonraki ekstrelerde hatırlar.</p>` : ""}
  </details>`;
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
async function commitImport(silent) {
  const sel = imp.items.filter(x => x.sel), bi = impBalanceInfo();
  const code = accAsset(acc(imp.accountId)), batchId = uid8(), batchAt = new Date().toISOString();
  const txs = sel.map(x => { const [category, sub] = x.cat.split("|"); const t = { id: uid8(), type: x.type, amount: x.amt, date: x.date, category, sub: sub || "", accountId: imp.accountId, contactId: x.contactId || "", note: x.desc.slice(0, 140), importKey: x.key, importId: batchId, importFile: (imp.fileName || "").slice(0, 80), importAt: batchAt }; if (x.inst) t.inst = x.inst; if (code !== "TRY") { t.rate = x.price || rateOf(code); if (x.tl) t.tlAmount = x.tl; }
    if (x.trade && imp.tradeAcc && acc(imp.tradeAcc)) { // alış: TL hesabından → bu hesaba; satış: bu hesaptan → TL hesabına
      Object.assign(t, { type: "transfer", category: "Transfer", sub: "", importAcc: imp.accountId }); delete t.rate;
      if (x.amount > 0) Object.assign(t, { accountId: imp.tradeAcc, toAccountId: imp.accountId, amount: x.tl, toAmount: x.amt });
      else Object.assign(t, { accountId: imp.accountId, toAccountId: imp.tradeAcc, amount: x.amt, toAmount: x.tl });
    }
    return t; });
  const a = acc(imp.accountId), fix = imp.fixOpening && bi && Math.abs(bi.diff) >= 0.01 ? Math.round(((+a.opening || 0) + bi.diff) * 100) / 100 : null;
  if (fix != null) txs.forEach(t => { t.importPrevOpening = +a.opening || 0; });
  let accUpd = null;
  if (isCredit(a)) {
    const L = parseAmt($("#imp-limit")?.value), A = parseAmt($("#imp-avail")?.value);
    if (L > 0 || ($("#imp-avail")?.value && A >= 0)) {
      accUpd = { ...a, limit: L > 0 ? L : (+a.limit || 0) };
      if ($("#imp-avail")?.value && A >= 0 && accUpd.limit > 0) Object.assign(accUpd, creditAnchor(a.id, accUpd.limit, A));
    }
    const SP = parseAmt($("#imp-spent")?.value), CD = parseInt($("#imp-cut")?.value, 10);
    if (($("#imp-spent")?.value && SP >= 0) || (CD >= 1 && CD <= 31)) {
      accUpd = accUpd || { ...a };
      if (CD >= 1 && CD <= 31) accUpd.cutDay = CD;
      if ($("#imp-spent")?.value && SP >= 0) Object.assign(accUpd, spentAnchor(a.id), { syncSpent: SP });
    }
  }
  ls.set("kd-map:" + imp.sig, JSON.stringify(imp.map)); ls.set("kd-imp-acc", imp.accountId);
  const idOps = [];
  if (imp.ids && imp.ids.length) { // ekstre kimliklerini bu hesaba öğret, başka hesapta varsa oradan kaldır
    const have = accUpd ? accUpd.ids || a.ids || [] : a.ids || [], merged = [...new Set([...have, ...imp.ids])];
    if (merged.length !== have.length) accUpd = { ...(accUpd || a), ids: merged };
    S.accounts.filter(o => o.id !== a.id && (o.ids || []).some(i => imp.ids.includes(i))).forEach(o => { const { id, ...d } = { ...o, ids: o.ids.filter(i => !imp.ids.includes(i)) }; idOps.push({ type: "set", col: "accounts", id, data: clean(d) }); });
  }
  if (imp.gmailKey) { const d = gmailDone(); d[imp.gmailKey] = Date.now(); ls.set("kd-gmail-done", JSON.stringify(d)); }
  if (live()) {
    const ops = txs.map(t => { const { id, ...d } = t; return { type: "set", col: "txns", id, data: d }; });
    sel.filter(x => x.replaceId).forEach(x => ops.push({ type: "delete", col: "txns", id: x.replaceId }));
    ops.push(...idOps);
    if (fix != null) { const { id, ...d } = { ...a, opening: fix }; ops.push({ type: "set", col: "accounts", id, data: d }); }
    if (accUpd) { const { id, ...d } = accUpd; ops.push({ type: "set", col: "accounts", id, data: clean(d) }); }
    const ok = await safe(() => batchWrite(ops), `${txs.length} işlem eklendi${accUpd && accUpd.syncDate ? " · kalan limit sabitlendi" : ""}`);
    if (!ok) return; Drive.dirty();
  } else {
    const rm = new Set(sel.map(x => x.replaceId).filter(Boolean)); S.txns = S.txns.filter(t => !rm.has(t.id));
    idOps.forEach(o => { const x = acc(o.id); if (x) x.ids = o.data.ids; });
    S.txns.push(...txs); if (fix != null) a.opening = fix; if (accUpd) Object.assign(a, accUpd); saveDemo(); render(); toast(`${txs.length} işlem eklendi${accUpd && accUpd.syncDate ? " · kalan limit sabitlendi" : ""}`);
  }
  if (silent) { imp = null; render(); return true; }
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
    const code = accAsset(acc(o.accountId));
    if (type === "transfer") {
      o.toAccountId = v("#f-to"); o.category = "Transfer"; o.contactId = ""; if (o.toAccountId === o.accountId) { toast("Çıkış ve giriş hesabı farklı olmalı."); return; }
      const c2 = accAsset(acc(o.toAccountId));
      if (c2 !== code) { const r1 = rateOf(code), r2 = rateOf(c2); const ta = parseAmt(v("#f-toamt")) || (r1 && r2 ? Math.round(o.amount * r1 / r2 * 1000) / 1000 : null); if (!(ta > 0)) { toast("Giriş miktarını yaz."); return; } o.toAmount = ta; }
    } else {
      const c = resolveCat(f, type); if (!c) { toast("Yeni kategorinin adını yaz."); return; }
      o.category = c.category; o.sub = c.sub; o.contactId = v("#f-con");
      if (code !== "TRY") o.rate = parseAmt(v("#f-rate")) || rateOf(code) || null;
      const n = type === "gider" && isCredit(acc(o.accountId)) ? +v("#f-inst") || 1 : 1; if (n > 1) o.inst = n;
    }
    ls.set("kd-last-acc", o.accountId);
    const old = S.txns.find(x => x.id === id); if (old && old.planId) o.planId = old.planId;
    if (old) for (const k of ["importKey", "importId", "importFile", "importAt", "importAcc", "tlAmount"]) if (old[k] != null && o[k] == null) o[k] = old[k]; // ekstre bağlantısı korunur
    put("txns", o); toast(id ? "İşlem güncellendi" : "İşlem kaydedildi"); closeSheet();
    if (old && o.type !== "transfer" && (old.category !== o.category || (old.sub || "") !== (o.sub || ""))) setTimeout(() => offerBulk(o, old.category), 60);
  } else if (kind === "plan") {
    const old = S.plans.find(x => x.id === id);
    const c = resolveCat(f, v("#f-dir")); if (!c) { toast("Yeni kategorinin adını yaz."); return; }
    const o = { ...(old || {}), id: id || uid8(), dir: v("#f-dir"), amount: parseAmt(v("#f-amount")), due: v("#f-due"), contactId: v("#f-con"), category: c.category, sub: c.sub, repeat: v("#f-rep"), note: v("#f-note"), status: old?.status || "bekliyor" };
    put("plans", o); toast(id ? "Vade güncellendi" : "Vade eklendi"); closeSheet();
  } else if (kind === "gmacc") {
    const P = ui.gmailPending; if (!P) return; const accId = v("#gm-acc");
    try { const m = JSON.parse(ls.get("kd-gmail-acc") || "{}"); m[P.pat] = accId; ls.set("kd-gmail-acc", JSON.stringify(m)); } catch (e) { }
    imp = { accountId: accId, gmailKey: P.key }; ui.gmailPending = null; closeSheet(); readStatement(P.file); return;
  } else if (kind === "account") {
    const limit = parseAmt(v("#f-limit")), avail = parseAmt(v("#f-avail"));
    const o = { id: id || uid8(), ids: idsFromInput(v("#f-ids")), excl: !!$("#f-excl")?.checked, hide: !!$("#f-hide")?.checked, name: v("#f-name"), group: v("#f-group") || inferGroup(v("#f-name")) || (v("#f-kind") === "nakit" ? "Nakit" : ""), kind: v("#f-kind"), asset: v("#f-asset") || "TRY", opening: parseAmt(v("#f-open")) || 0 };
    if (isCredit(o)) {
      const old = old0(o.id) || {};
      o.limit = limit > 0 ? limit : 0;
      for (const k of ["syncBal", "syncDate", "syncIds", "limitSyncAt", "syncSpent", "spentDate", "spentIds"]) if (old[k] != null) o[k] = old[k];
      const cd = parseInt(v("#f-cut"), 10); o.cutDay = cd >= 1 && cd <= 31 ? cd : 0;
      const sp = parseAmt(v("#f-spent")); if (v("#f-spent") !== "" && sp >= 0) Object.assign(o, spentAnchor(o.id), { syncSpent: sp });
      if (limit > 0 && avail >= 0 && v("#f-avail") !== "") {
        Object.assign(o, creditAnchor(o.id, limit, avail));
        setTimeout(() => toast(`Kart borcu ${money(limit - avail)}, kalan limit ${money(avail)} olarak eşitlendi`), 50);
      }
    }
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
    const accId = v("#f-acc"), code = accAsset(acc(accId)), r = rateOf(code) || 1;
    const tx = { id: uid8(), type: p.dir === "tahsilat" ? "gelir" : "gider", amount: code === "TRY" ? amount : Math.round(amount / r * 1000) / 1000, date, category: p.category || "Diğer", sub: p.sub || "", accountId: accId, contactId: p.contactId || "", note: p.note || "", planId: p.id };
    if (code !== "TRY") tx.rate = r;
    put("txns", tx);
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
  const el = e.target.closest("button,[data-edit-txn],[data-edit-plan],[data-edit-account],[data-show-contact],[data-batch],.overlay");
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
  if (d.pdir) { $("#f-dir").value = d.pdir; el.parentNode.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b === el)); const w = $("#f-catwrap"); if (w) w.innerHTML = catFields(d.pdir); return; }
  if (d.pv) { ui.planView = d.pv; return render(); }
  if (d.period) { ui.period = d.period; return render(); }
  if (d.complete) { const p = S.plans.find(x => x.id === d.complete); if (p) completeForm(p); return; }
  if (d.editTxn) { const t = S.txns.find(x => x.id === d.editTxn); if (t) txnForm(t); return; }
  if (d.editPlan) { const p = S.plans.find(x => x.id === d.editPlan); if (p) planForm(p); return; }
  if (d.editAccount) { const a = acc(d.editAccount); if (a) accountForm(a); return; }
  if (d.editContact) { const c = con(d.editContact); if (c) contactForm(c); return; }
  if (d.showContact) { const c = con(d.showContact); if (c) contactDetail(c); return; }
  if (d.batch) return batchPanel(d.batch);
  if (d.an) { ui.anPeriod = d.an; return render(); }
  if (d.cmType) { CM.type = d.cmType; CM.edit = null; return catManager(); }
  if (d.cmAddsub != null) { CM.edit = { i: +d.cmAddsub, k: "sub" }; return catManager(); }
  if (d.cmRen != null) { CM.edit = { i: +d.cmRen, k: "ren" }; return catManager(); }
  if (el.hasAttribute("data-cm-cancel")) { CM.edit = null; return catManager(); }
  if (d.cmDel != null) {
    if (el.dataset.armed !== "1") { el.dataset.armed = "1"; el.textContent = "Emin misin?"; return; }
    const o = JSON.parse(JSON.stringify(catsObj())); const n = o[CM.type][+d.cmDel].n; o[CM.type].splice(+d.cmDel, 1); saveCats(o); toast(`"${n}" listeden kaldırıldı`); return catManager();
  }
  if (d.cmDelsub) { const [i, j] = d.cmDelsub.split("|").map(Number); const o = JSON.parse(JSON.stringify(catsObj())); o[CM.type][i].s.splice(j, 1); saveCats(o); return catManager(); }
  if (d.toggleGroup) { let c = {}; try { c = JSON.parse(ls.get("kd-collapsed") || "{}"); } catch (e) { } c[d.toggleGroup] = !c[d.toggleGroup]; ls.set("kd-collapsed", JSON.stringify(c)); return render(); }
  if (d.newInGroup) { ui.newGroup = d.newInGroup; const gl = accountGroups().find(g => g.name === d.newInGroup); if (gl && gl.list.every(isCash)) ui.newKind = "nakit"; return accountForm(); }
  if (d.renameGroup) return renameGroup(d.renameGroup);
  if (d.groupExcl != null || d.groupHide != null) {
    const name = d.groupExcl ?? d.groupHide, k = d.groupExcl != null ? "excl" : "hide", g = accountGroups().find(x => x.name === name); if (!g) return;
    const val = k === "excl" ? !g.allEx : !g.allHide;
    const ops = g.list.map(a => { const { id, ...dd } = { ...a, [k]: val }; return { type: "set", col: "accounts", id, data: clean(dd) }; });
    if (live()) { if (!(await safe(() => batchWrite(ops)))) return; Drive.dirty(); } else { g.list.forEach(a => { a[k] = val; }); saveDemo(); render(); }
    toast(k === "excl" ? (val ? `${name}: toplamlara dahil edilmiyor` : `${name}: toplamlara dahil`) : (val ? `${name}: Özet'te gizlendi` : `${name}: Özet'te gösteriliyor`)); return;
  }
  if (d.gmailMsg) return gmailOpen(d.gmailMsg, d.gmailAtt, d.gmailName);
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
  if (a === "new-account") { ui.newKind = ""; ui.newGroup = ""; return accountForm(); }
  if (a === "new-cash") { ui.newKind = "nakit"; ui.newGroup = (accountGroups().find(g => g.list.every(isCash)) || {}).name || "Nakit"; return accountForm(); }
  if (a === "new-contact") return contactForm();
  if (a === "csv") return exportCsv();
  if (a === "imports") return importsPanel();
  if (a === "recat") { el.disabled = true; el.textContent = "Kategoriler tahmin ediliyor…"; await recategorize(); closeSheet(); return; }
  if (a === "bulk-apply") return bulkApply();
  if (a === "batch-del") return batchApply("del", el);
  if (a === "batch-move") return batchApply("move", el);
  if (a === "batch-unit") return batchApply("unit", el);
  if (a === "cats") { CM.edit = null; return catManager(); }
  if (a === "rates") return ratesPanel();
  if (a === "rates-save") return saveManualRates();
  if (a === "rates-refresh") { el.disabled = true; return fetchRates(true); }
  if (a === "rates-all") { ui.ratesAll = !ui.ratesAll; return ratesPanel(); }
  if (a === "import-stmt") return openImport(imp && imp.accountId);
  if (a === "data-check") return dataCheckPanel();
  if (a === "dc-apply") return dataCheckApply(false);
  if (a === "dc-ignore") return dataCheckApply(true);
  if (a === "gmail") { Gmail.load(); gmailPanel(); if (Gmail.valid() && !Gmail.list && !Gmail.busy) Gmail.search(ls.get("kd-gmail-q") || GMAIL_Q); return; }
  if (a === "gmail-reauth") { if (await Gmail.authorize()) { GAuto.need = false; gmailAutoImport(true); } return; }
  if (a === "gmail-auth") { if (await Gmail.authorize()) { gmailPanel(); Gmail.search(ls.get("kd-gmail-q") || GMAIL_Q); } return; }
  if (a === "gmail-search") { const q = $("#gm-q").value.trim() || GMAIL_Q; ls.set("kd-gmail-q", q); return Gmail.search(q); }
  if (a === "gmail-reset-q") { ls.del("kd-gmail-q"); $("#gm-q").value = GMAIL_Q; return Gmail.search(GMAIL_Q); }
  if (a === "imp-switch") { imp.accountId = el.dataset.acc; imp.unitFor = null; buildImpItems(); renderImport(); toast(`Hesap: ${accName(acc(imp.accountId))}`); return; }
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
  if (/^cm-/.test(e.target.dataset.kind || "")) return cmSubmit(e.target);
  if (e.target.dataset.kind === "pdfpw") { const pw = $("#pdf-pw").value; if (imp && imp.file) { closeSheet(); readStatement(imp.file, pw); } return; }
  submitForm(e.target);
});
document.addEventListener("input", e => {
  if (["f-amount", "f-rate", "f-toamt", "f-inst"].includes(e.target.id) && $("#frm")?.dataset.kind === "txn") updateTxnUnits();
  if (e.target.id === "f-open") updateOpenConv();
  if (["f-limit", "f-avail"].includes(e.target.id)) { const L = parseAmt($("#f-limit").value), A = parseAmt($("#f-avail").value), h = $("#f-avail-hint"); if (L > 0 && A >= 0 && $("#f-avail").value) h.innerHTML = `Kaydedince kart borcu <b>${money(L - A)}</b> olarak ayarlanacak (limitin %${Math.round((L - A) / L * 100)} kadarı kullanılmış).`; }
  if (e.target.id === "fq") { ui.q = e.target.value; ui._focusQ = true; render(); } });
document.addEventListener("change", async e => {
  if (e.target.classList && e.target.classList.contains("an-uncat") && e.target.value) {
    const key = e.target.dataset.key, [c, sb = ""] = e.target.value.split("|");
    const list = S.txns.filter(t => t.type === "gider" && t.category === "Diğer gider" && (IMP.learnKey(t.note || "") || "(açıklamasız)") === key);
    const ops = list.map(t => { const { id, ...d } = { ...t, category: c, sub: sb }; return { type: "set", col: "txns", id, data: d }; });
    if (live()) { if (!(await safe(() => batchWrite(ops)))) return; Drive.dirty(); }
    else { list.forEach(t => { t.category = c; t.sub = sb; }); saveDemo(); render(); }
    toast(`${list.length} kayıt "${c}${sb ? " › " + sb : ""}" yapıldı`); return;
  }
  if (e.target.id === "ftype") { ui.ftype = e.target.value; render(); }
  else if (e.target.id === "facc") { ui.facc = e.target.value; render(); }
  else if (e.target.id === "b-all") { document.querySelectorAll(".b-sel").forEach(i => { i.checked = e.target.checked; }); }
  else if (e.target.id === "f-cat") {
    const nw = e.target.value === "__new", ni = $("#f-cat-new"); ni.hidden = !nw; if (nw) ni.focus();
    const sub = $("#f-sub"); if (sub) { sub.innerHTML = subOptions(e.target.dataset.ctype, nw ? "" : e.target.value, ""); $("#f-sub-new").hidden = true; }
  }
  else if (e.target.id === "f-sub") { const nw = e.target.value === "__new", ni = $("#f-sub-new"); ni.hidden = !nw; if (nw) ni.focus(); }
  else if (["f-acc", "f-to"].includes(e.target.id) && $("#frm")?.dataset.kind === "txn") updateTxnUnits();
  else if (e.target.id === "f-kind" && $("#f-limit-box")) {
    const k = e.target.value, g = $("#f-group"); $("#f-limit-box").hidden = !isCredit({ kind: k });
    $("#f-group-lbl").textContent = k === "nakit" ? "Grup" : "Banka / Grup"; g.placeholder = k === "nakit" ? "Nakit" : "Örn. Ziraat";
    if (k === "nakit" && !g.value) g.value = "Nakit"; else if (k !== "nakit" && g.value === "Nakit") g.value = "";
    if (k === "nakit" && !$("#f-name").value) $("#f-name").placeholder = "Örn. Cüzdan, Kasa, Evdeki dolar";
  }
  else if (e.target.id === "f-asset") { const code = e.target.value; $("#f-open-lbl").textContent = `Açılış bakiyesi (${amtUnit({ asset: code })})`; updateOpenConv(); }
  else if (e.target.id === "stmtFile") { const fs = [...(e.target.files || [])]; if (fs.length) readStatement(fs.length > 1 ? fs.filter(f => IMP.isImage(f)).length === fs.length ? fs : fs[0] : fs[0]); }
  else if (e.target.id === "imp-acc" && imp) { imp.accountId = e.target.value; }
  else if (e.target.id === "gm-auto") { const on = e.target.checked; ls.set("kd-gmail-auto", on ? "1" : "0"); toast(on ? "Otomatik içe aktarma açık" : "Otomatik içe aktarma kapalı"); renderChips(); if (on) setTimeout(() => { closeSheet(); gmailAutoImport(true); }, 400); }
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
    else if (t.id === "imp-limit" || t.id === "imp-avail") { imp[t.id === "imp-limit" ? "limit" : "avail"] = parseAmt(t.value); }
    else if (t.id === "imp-spent") { imp.spent = parseAmt(t.value); }
    else if (t.id === "imp-unit") { imp.unitMode = t.value; buildImpItems(); renderImport(); }
    else if (t.id === "imp-trade") { imp.tradeAcc = t.value; renderImport(); }
    else if (t.id === "imp-cut") { imp.cut = parseInt(t.value, 10) || ""; }
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
fetchRates(); setInterval(() => { if (!document.hidden) fetchRates(); }, 15 * 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { fetchRates(); setTimeout(() => gmailAutoImport(), 1500); } });
setInterval(() => { if (!document.hidden) gmailAutoImport(); }, 5 * 60e3);
if (configured) renderLogin(); // Firebase yüklenirken giriş kartı (düğme pasif) görünür
boot();
