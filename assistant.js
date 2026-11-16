// Kasa Asistanı — yerleşik (kural tabanlı) Türkçe çözümleyici.
// Saf fonksiyonlar: veriye dokunmaz; uygulama sonucu onay kartına çevirir.
// parse(text, ctx) → { intent: "add" | "plan" | "query" | "delete-last" | "edit-last" | "help" | "unknown", ... , conf }

const TRL = s => String(s || "").toLocaleLowerCase("tr");
export const fold = s => TRL(s).replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ü/g, "u").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
const words = s => fold(s).replace(/['’`]/g, "").split(/[^a-z0-9₺$€£.,]+/).filter(Boolean);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };

const MONTHS = ["ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik"];
const DAYS = ["pazar", "pazartesi", "sali", "carsamba", "persembe", "cuma", "cumartesi"];
const CUR = [[/^(tl|try|lira|liralik|tllik|₺)$/, "TRY"], [/^(dolar|dolarlik|usd|\$)$/, "USD"], [/^(euro|euroluk|avro|eur|€)$/, "EUR"], [/^(sterlin|gbp|£|pound)$/, "GBP"]];
const NUMW = { sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90, yuz: 100, bin: 1000, milyon: 1e6, bucuk: 0.5 };

// "1.250,50" "1250.5" "200" "1,5" → sayı
export function num(s) {
  s = String(s).replace(/[₺$€£\s]/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return +s.replace(/\./g, "").replace(",", ".");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return +s.replace(/,/g, "");
  if (/^\d+,\d+$/.test(s)) return +s.replace(",", ".");
  if (/^\d+\.\d{1,2}$/.test(s)) return +s;
  if (/^\d+\.\d{3}$/.test(s)) return +s.replace(".", "");
  return /^\d+$/.test(s) ? +s : NaN;
}

// metindeki tutar(lar): [{v, cur, i (kelime sırası), strong}]
function amounts(text) {
  const t = fold(text).replace(/(\d)\s*(tl|₺|\$|€|£)(?=$|[^a-z])/g, "$1 $2").replace(/([₺$€£])\s*(\d)/g, "$1 $2").replace(/(\d)['’]?(lik|lık|luk|lük|lik|tl|lira)\b/g, "$1 $2");
  const w = t.replace(/['’`]/g, " ").split(/[^a-z0-9₺$€£.,]+/).filter(Boolean).map(x => x.replace(/[.,]+$/, ""));
  const out = [];
  for (let i = 0; i < w.length; i++) {
    let v = num(w[i]), j = i;
    if (isNaN(v)) { // yazıyla sayılar: "iki yüz elli", "bin", "1,5 bin"
      if (!(w[i] in NUMW) || w[i] === "bir" && !(w[i + 1] in NUMW) || w[i] === "on" && !(w[i + 1] in NUMW) && !CUR.some(([r]) => r.test(w[i + 1] || ""))) continue;
      let tot = 0, cur = 0; j = i;
      while (j < w.length && w[j] in NUMW) { const n = NUMW[w[j]]; if (n === 0.5) cur += 0.5; else if (n >= 1000) { tot += (cur || 1) * n; cur = 0; } else if (n === 100) cur = (cur || 1) * 100; else cur += n; j++; }
      v = tot + cur; j--; if (!v) continue;
    } else {
      // "1,5 bin", "2 milyon"
      if (w[j + 1] === "bin" || w[j + 1] === "milyon") { v *= w[j + 1] === "bin" ? 1000 : 1e6; j++; }
      // tarih/sayı bağlamı: "15 kasım", "ayın 20", "3 gün", "6 taksit", "15.11"
      const nx = w[j + 1] || "", pv = w[i - 1] || "";
      if (MONTHS.some(m => nx.startsWith(m)) || /^(gun|hafta|ay|yil|taksit|adet|tane|kisi|kg|gr|litre|lt|saat|dakika)/.test(nx) && !/^(tl|lira)/.test(nx) || pv === "ayin" || /^\d{1,2}[./]\d{1,2}([./]\d{2,4})?$/.test(w[i]) && !/^\d+\.\d{3}$/.test(w[i]) && !/^\d+[.,]\d{2}$/.test(w[i])) continue;
    }
    let cur = null, k = j + 1;
    for (const [r, c] of CUR) { if (r.test(w[k] || "")) cur = c; if (!cur && r.test(w[i - 1] || "")) cur = c; }
    out.push({ v: Math.round(v * 100) / 100, cur, i, strong: !!cur || j > i });
    i = j;
  }
  return out;
}

// tarih: geçmiş (işlem) veya gelecek (vade)
function findDate(text, today, future) {
  const t = fold(text);
  if (/\bevvelsi gun|\bonceki gun|\bdunden onceki/.test(t)) return addDays(today, -2);
  if (/\bdun\b|\bdunku\b/.test(t)) return addDays(today, -1);
  if (/\byarin\b/.test(t)) return addDays(today, 1);
  if (/\bobur gun\b|\bobürgün\b/.test(t)) return addDays(today, 2);
  if (/\bbugun\b|\bsimdi\b|\baz once\b/.test(t)) return today;
  let m = t.match(/(\d+)\s*gun (once|evvel)/); if (m) return addDays(today, -m[1]);
  m = t.match(/(\d+)\s*gun sonra/); if (m) return addDays(today, +m[1]);
  m = t.match(/\b(\d{1,2})\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\w*(?:\s+(20\d{2})(?!\s*(?:tl|lira|₺|\$|dolar|euro)))?/);
  if (m) { const y = m[3] ? +m[3] : +today.slice(0, 4), d = iso(new Date(y, MONTHS.indexOf(m[2]), +m[1])); return !m[3] && !future && d > today ? iso(new Date(y - 1, MONTHS.indexOf(m[2]), +m[1])) : !m[3] && future && d < today ? iso(new Date(y + 1, MONTHS.indexOf(m[2]), +m[1])) : d; }
  m = t.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m && +m[2] <= 12 && +m[1] <= 31) { let y = m[3] ? +m[3] : +today.slice(0, 4); if (y < 100) y += 2000; return iso(new Date(y, m[2] - 1, +m[1])); }
  m = t.match(/\bayin (\d{1,2})/) || t.match(/\b(\d{1,2})\s*(?:'|’)?\s*(?:si|sı|sinde|sında|inde|unda|ünde|nde|de|da)\b(?=[^0-9]*(ode|tahsil|vade|hatirlat|gelecek|yatacak))/);
  if (m) { const d0 = pd(today), d = iso(new Date(d0.getFullYear(), d0.getMonth(), +m[1])); return future && d < today ? iso(new Date(d0.getFullYear(), d0.getMonth() + 1, +m[1])) : d; }
  m = t.match(/\b(gecen )?(pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)\b/);
  if (m) { const want = DAYS.indexOf(m[2]), d = pd(today); let diff = (d.getDay() - want + 7) % 7; if (future) { diff = (want - d.getDay() + 7) % 7 || 7; return addDays(today, diff); } if (m[1] && diff === 0) diff = 7; return addDays(today, -diff); }
  return null;
}

// dönem (sorular için)
export function findPeriod(text, today) {
  const t = fold(text), d = pd(today), y = d.getFullYear(), mo = d.getMonth();
  const rng = (a, b, label) => ({ from: iso(a), to: iso(b), label });
  if (/\bbugun\b/.test(t)) return rng(d, d, "bugün");
  if (/\bdun\b/.test(t)) { const x = pd(addDays(today, -1)); return rng(x, x, "dün"); }
  if (/bu hafta/.test(t)) { const s = pd(addDays(today, -((d.getDay() + 6) % 7))); return rng(s, d, "bu hafta"); }
  if (/gecen hafta/.test(t)) { const s = pd(addDays(today, -((d.getDay() + 6) % 7) - 7)); return rng(s, pd(addDays(iso(s), 6)), "geçen hafta"); }
  if (/gecen ay/.test(t)) return rng(new Date(y, mo - 1, 1), new Date(y, mo, 0), "geçen ay");
  if (/bu yil|bu sene/.test(t)) return rng(new Date(y, 0, 1), d, "bu yıl");
  if (/gecen yil|gecen sene/.test(t)) return rng(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31), "geçen yıl");
  let m = t.match(/son (\d+) (gun|ay)/); if (m) return m[2] === "gun" ? rng(pd(addDays(today, -m[1] + 1)), d, `son ${m[1]} gün`) : rng(new Date(y, mo - m[1] + 1, 1), d, `son ${m[1]} ay`);
  m = t.match(/\b(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\w*/);
  if (m) { const k = MONTHS.indexOf(m[1]), yy = k > mo ? y - 1 : y; return rng(new Date(yy, k, 1), new Date(yy, k + 1, 0), m[0]); }
  return rng(new Date(y, mo, 1), d, "bu ay");
}

// kelime → kategori|alt kategori (konuşma dili). Uygulamadaki listede yoksa atlanır.
const KW = [
  ["Market / Gıda|Restoran / Kafe", ["restoran", "lokanta", "yemek", "yemeg", "kahve", "kafe", "cafe", "doner", "kebap", "pide", "pizza", "burger", "hamburger", "kahvalti", "yemeksepeti", "starbucks", "tatli", "dondurma", "simit", "lahmacun", "cigkofte", "baklava", "pastane"]],
  ["Market / Gıda|Market", ["market", "bakkal", "manav", "kasap", "firin", "ekmek", "ekmeg", "migros", "bim", "a101", "sok", "carrefour", "file", "hakmar", "gida", "sut", "meyve", "sebze", "et", "tavuk", "pazar", "pazardan", "macro", "metro market", "getir", "erzak"]],
  ["Ulaşım|Akaryakıt", ["benzin", "mazot", "motorin", "dizel", "yakit", "akaryakit", "lpg", "shell", "opet", "petrol", "aytemiz"]],
  ["Ulaşım|Otopark / HGS", ["otopark", "hgs", "ogs", "kopru", "otoyol", "ispark"]],
  ["Ulaşım|Toplu taşıma", ["otobus", "metro", "minibus", "dolmus", "marmaray", "istanbulkart", "tren", "vapur", "ucak", "bilet"]],
  ["Ulaşım|Araç bakım", ["lastik", "oto yikama", "yag degisim", "sanayi", "tamirci", "kaporta"]],
  ["Ulaşım", ["taksi", "uber", "bitaksi", "yol parasi"]],
  ["Faturalar|Elektrik", ["elektrik"]], ["Faturalar|Doğalgaz", ["dogalgaz", "dogal gaz", "kombi"]], ["Faturalar|Su", ["su faturasi", "su parasi", "suyu"]],
  ["Faturalar|İnternet", ["internet", "turknet", "superonline", "ttnet", "fiber"]], ["Faturalar|Telefon", ["telefon faturasi", "fatura telefon", "hat", "kontor", "turkcell", "vodafone"]], ["Faturalar", ["fatura"]],
  ["Kira", ["kira", "aidat"]],
  ["Sağlık|Eczane", ["eczane", "ilac", "vitamin"]], ["Sağlık|Hastane / doktor", ["doktor", "hastane", "muayene", "dis", "dishekimi", "tahlil"]], ["Sağlık", ["saglik", "gozluk"]],
  ["Kişisel bakım", ["berber", "kuafor", "kozmetik", "parfum", "sampuan", "tiras", "manikur"]],
  ["Giyim|Ayakkabı", ["ayakkabi", "bot", "terlik", "sneaker"]], ["Giyim", ["kiyafet", "elbise", "gomlek", "pantolon", "ceket", "mont", "tisort", "kazak", "lcw", "defacto", "zara", "koton", "mavi", "giyim", "corap"]],
  ["Yazılım|Abonelik", ["chatgpt", "openai", "claude", "anthropic", "github", "google one", "icloud", "adobe", "canva", "domain", "hosting", "natro", "yazilim", "uygulama"]],
  ["Eğlence / Abonelik|Dijital abonelik", ["netflix", "spotify", "youtube", "disney", "exxen", "blutv", "prime", "abonelik", "tod", "gain"]], ["Eğlence / Abonelik|Sinema / etkinlik", ["sinema", "konser", "tiyatro", "mac bileti", "etkinlik"]], ["Eğlence / Abonelik", ["oyun", "eglence", "playstation", "steam"]],
  ["Online alışveriş", ["trendyol", "hepsiburada", "amazon", "n11", "temu", "aliexpress", "internetten", "online"]],
  ["Elektronik|Telefon / bilgisayar", ["bilgisayar", "laptop", "telefon", "kulaklik", "sarj", "tablet", "kilif"]], ["Elektronik|Beyaz eşya", ["buzdolabi", "camasir makinesi", "bulasik makinesi", "firin aldim", "beyaz esya"]],
  ["Eğitim", ["kurs", "kitap", "okul", "egitim", "kirtasiye", "ders"]],
  ["Yapı market / Ev|Mobilya / dekorasyon", ["mobilya", "ikea", "koltuk", "masa", "dekorasyon"]], ["Yapı market / Ev", ["koctas", "bauhaus", "hirdavat", "boya", "nalbur", "tamirat", "ev esyasi", "deterjan", "temizlik"]],
  ["Vergi / SGK|SGK", ["sgk", "bagkur", "prim borcu"]], ["Vergi / SGK|Vergi", ["vergi", "mtv", "kdv", "stopaj"]], ["Vergi / SGK", ["ceza"]],
  ["Pazarlama|Reklam", ["reklam", "sponsorlu", "boost"]], ["Pazarlama", ["pazarlama", "brosur", "kartvizit"]],
  ["Ofis", ["ofis", "toner", "kagit"]], ["Personel|Maaş", ["maas odedim", "maasini odedim", "yevmiye", "personel"]],
  ["Banka masrafı|Kart aidatı", ["kart aidati"]], ["Banka masrafı|EFT / havale", ["eft ucreti", "havale ucreti"]], ["Banka masrafı", ["banka masrafi", "masraf"]],
  ["Lojistik", ["kargo", "nakliye", "kurye"]],
];
const KW_IN = [
  ["Komisyon", ["komisyon", "prim", "kazanc", "bonus", "kar payi"]], ["Faiz geliri", ["faiz", "getiri", "temettu", "kar payi"]],
  ["Satış", ["satis", "sattim", "satildi", "urun", "siparis"]], ["Danışmanlık", ["danismanlik"]], ["Hizmet geliri", ["hizmet", "is yaptim", "proje"]],
  ["Maaş", ["maas"]], ["Kira geliri", ["kira"]], ["Diğer gelir", ["iade", "hediye", "harclik", "borc odedi", "geri odedi"]],
];
const STOP = new Set("ve ile icin bir bu su o da de ki mi ben sen tl lira try usd dolar euro avro sterlin lik lık luk luk tllik yaptim aldim odedim harcadim verdim ettim oldu yapildi alisveris alisverisi alisverisinde harcama odeme sey seye seyi falan filan bugun dun yarin simdi az once gecen hafta ay yil kartla kartimla nakit elden pesin hesaptan hesabimdan biraz tane adet kadar olarak ise lazim gerek ama icin hem".split(" "));
// Türkçe ekler (katlanmış harflerle): -den/-ten/-e/-ye/-i/-in/-le/-ler/-im/-ci/-lik/-si…
const SUF = "(?:y?[aeiou]|n?[dt][ae]n?|n?[iu]n|y?l[ae]|l[ae]r[a-z]*|[iu]m[a-z]*|s[iu]n?[a-z]{0,3}|c[iu][a-z]*|l[iu]k?[a-z]{0,3}|n[ae]|n[dt][ae]n?)?";
const kwHit = (t, k) => new RegExp("(^|[^a-z0-9])" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + SUF + "($|[^a-z0-9])").test(t);
const sufOk = rest => new RegExp("^" + SUF + "$").test(rest);

function pickCat(ctx, type, list, t) {
  const cats = (ctx.cats && ctx.cats[type === "gelir" ? "gelir" : "gider"]) || [];
  const has = n => cats.some(c => c.n === n), subOk = (n, s) => (cats.find(c => c.n === n) || { s: [] }).s.includes(s);
  for (const [cs, keys] of list) {
    const k = keys.find(k => kwHit(t, k)); if (!k) continue;
    const [c, s] = cs.split("|"); if (!has(c)) continue;
    return { category: c, sub: s && subOk(c, s) ? s : "", hit: k };
  }
  return null;
}

// öğrenilmiş kelimeler: asistanla girilmiş (sonradan düzeltilmiş olabilir) işlemlerden
export function learnFrom(txns) {
  const cat = {}, acc = {};
  for (const t of txns.slice().sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1)) {
    if (t.src !== "asst" || !t.note || t.type === "transfer") continue;
    for (const w of keyWords(t.note)) { cat[w] = t.category + (t.sub ? "|" + t.sub : ""); acc[w] = t.accountId; }
  }
  return { cat, acc };
}
export const keyWords = s => words(s).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w) && !/^[₺$€£]/.test(w)).map(w => w.replace(/(dan|den|tan|ten|nin|nın|in|ye|ya|a|e|i)$/, "")).filter(w => w.length >= 3 && !STOP.has(w));

// hesap eşleştirme: [{id, score, pos, abl, dat}]
function matchAccounts(text, ctx) {
  const W = words(text).map(w => w.replace(/[.,]+$/, "")), out = [];
  for (const a of ctx.accounts) {
    let score = 0, pos = 99, abl = false, dat = false, ins = false;
    const toks = [...new Set(words(a.name).filter(x => x.length >= 3 && !/^(hesap|hesabi|hesabim|vadesiz|tl|kart|karti)$/.test(x)))];
    const gt = words(a.group || "").filter(x => x.length >= 3 && !toks.includes(x));
    W.forEach((w, i) => {
      for (const k of toks) if (w.startsWith(k) && (k.length >= 5 || sufOk(w.slice(k.length)))) { score += 2; pos = Math.min(pos, i); const suf = w.slice(k.length); if (/^(n?dan|n?den|n?tan|n?ten|dn)$/.test(suf)) abl = true; if (/^(y?a|y?e|na|ne)$/.test(suf)) dat = true; if (/^(y?la|y?le)$/.test(suf)) ins = true; }
      for (const k of gt) if (w.startsWith(k) && (k.length >= 5 || sufOk(w.slice(k.length)))) { score += 0.8; pos = Math.min(pos, i); }
    });
    // tür kelimeleri
    const tt = fold(text);
    if (a.credit && /\b(kredi kart\w*|kart(a|i|in|la|tan|ima|imi|imla|imdan|imin|imiz)?)\b/.test(tt)) { score += 1; const m = tt.match(/\b(kredi kartina|kartima|karta)\b/); if (m) dat = true; if (/\b(kartla|kartimla|kart ile)\b/.test(tt)) ins = true; }
    if (/nakit/.test(a.kind) && /\b(nakit|elden|cuzdan|pesin)\w*/.test(tt)) score += 1.5;
    if (score > 0) out.push({ id: a.id, a, score: score + (a.fav ? 0.1 : 0), pos, abl, dat, ins });
  }
  return out.sort((x, y) => y.score - x.score || x.pos - y.pos);
}

function matchContact(text, ctx) {
  const W = words(text);
  let best = null;
  for (const c of ctx.contacts || []) {
    const toks = words(c.name).filter(x => x.length >= 3); let sc = 0, abl = false, dat = false;
    W.forEach(w => toks.forEach((k, i) => { if (w.startsWith(k) && sufOk(w.slice(k.length))) { sc += i === 0 ? 2 : 1; if (/^(n?dan|n?den|n?tan|n?ten)$/.test(w.slice(k.length))) abl = true; if (/^(y?a|y?e|na|ne)$/.test(w.slice(k.length))) dat = true; } }));
    if (sc && (!best || sc > best.sc)) best = { id: c.id, c, sc, abl, dat };
  }
  return best;
}

const NW = "(?:sıfır|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan|yüz|bin|milyon|buçuk)";
function cleanNote(text) {
  const B = "(?<![\\p{L}\\d])", E = "(?![\\p{L}\\d])", rx = (s, f = "giu") => new RegExp(s, f);
  let s = String(text).trim()
    .replace(rx(B + "ayın\\s*\\d{1,2}\\s*['’]?\\p{L}*"), " ")
    .replace(rx(B + "\\d{1,2}\\s*(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\\p{L}*(\\s+20\\d\\d)?" ), " ")
    .replace(rx("[₺$€£]\\s*\\d[\\d.,]*|" + B + "\\d[\\d.,]*\\s*(bin|milyon)?\\s*(tl|₺|lira|try|usd|dolar|euro|avro|eur|€|\\$|£)?(\\s*['’]?\\s*(lik|lık|luk|lük|ydi|di|ti))?" + E + "|[$€£₺]"), " ")
    .replace(rx(B + "(" + NW + "\\s+)*" + NW + "\\s+(tl|lira|dolar|euro)" + E), " ")
    .replace(rx(B + "\\d+\\s*(gün önce|taksit\\p{L}*)" + E), " ")
    .replace(rx(B + "(bugün|dün|yarın|evvelsi gün|şimdi|az önce|şeye|şeyi|şey|falan|filan|kaydet|ekle|yaz|lütfen|lik|lık|luk|lük|tl|lira)" + E), " ")
    .replace(/\s['’]\S*/g, " ")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/^[,.\s]+|[,.\s]+$/g, "");
  if (s.length > 70) s = s.slice(0, 67) + "…";
  return s ? s[0].toLocaleUpperCase("tr") + s.slice(1) : "";
}

const RX = {
  q: /\?|\bne kadar\b|\bkac (para|tl|lira)\b|\btoplam\w*\b|\bbakiye\w*\b|\bborcum\b|\bborcu ne\b|\bkalan\b|\bne harcadim\b|\bnereye harcadim\b|\ben cok\b|\bozet\w*\b|\blistele\b|\bgoster\b|\byaklasan\b|\bnet durum\w*\b|\bharcadim mi\b|\bdurum\w* ne\b|\bne durumda/,
  del: /\b(sil|silin|kaldir|iptal et|geri al|vazgec)\w*\b/,
  income: /\b(maas\w*|tahsil\w*|geldi|gelen|yatti|yatirildi|kazandim|kazanc\w*|sattim|satis\w*|odeme aldim|para aldim|iade\w*|prim\w*|komisyon\w*|gelir\w*|harclik|hediye geldi|faiz\w*|temettu|ciro|hasilat)\b/,
  incomeVerbs: /\b(geldi|yatti|yatirildi|aldim|tahsil ettim|odedi|verdi|gonderdi)\b/,
  transfer: /\b(aktar\w*|transfer\w*|virman\w*|gecirdim|cektim|yatirdim)\b/,
  cardPay: /\b(kart(i|imi|in|imin)? borc\w*|karti odedim|kartimi odedim|karta odeme|kart(a|ima) (yatirdim|odedim|attim|aktardim)|kart odemesi|ekstre(yi|mi)? odedim|asgari\w*)\b/,
  plan: /\b(odeyecegim|odeyecek|odenecek|odemem var|odemesi var|tahsil edecegim|alacagim|alacagim var|alacak|vadesi|vade\w*|hatirlat\w*|borcum var|gelecek|yatacak|verecek|verecegim)\b/,
  help: /^(yardim|merhaba|selam|ne yapabilirsin|neler yapabilirsin|nasil kullan\w*|help|\?)\s*[?!.]*$/,
};

export function parse(text, ctx) {
  const today = ctx.today, t = fold(text).trim();
  if (!t) return { intent: "unknown" };
  if (RX.help.test(t)) return { intent: "help" };
  const am = amounts(text), strong = am.filter(x => x.strong), main = strong[0] || am.sort((a, b) => b.v - a.v)[0];

  // düzeltme / silme (son kayıt)
  if (RX.del.test(t) && !(main && main.strong) && /\b(son|sonuncu|en son|bu|onu|kaydi|islemi|az onceki|demin)\b/.test(t)) return { intent: "delete-last", conf: 0.9 };
  let m = t.match(/(\d[\d.,]*)\s*(tl|lira)?\s*degil\s*(\d[\d.,]*)/) || t.match(/\b(?:tutar\w*|rakam\w*|fiyat\w*)\s*(?:yanlis\w*,?\s*)?(\d[\d.,]*)\s*(?:tl|lira)?\s*(?:olacak|olsun|yap|olmali|idi)/) || t.match(/^(\d[\d.,]*)\s*(?:tl|lira)?\s*['’]?\s*(?:ydi|idi|di|ti|tu|du|olacakti|olmaliydi)\b/);
  if (m) { const v = num(m[3] || m[1]); if (v > 0) return { intent: "edit-last", field: "amount", value: v, conf: 0.9 }; }
  m = t.match(/\bkategori\w*\s+(.+?)\s*(olsun|olacak|yap|olmali)\b/) || t.match(/^(.+?)\s+kategorisine\s+(al|tasi|koy|ekle)\b/);
  if (m) { const c = pickCat(ctx, "gider", KW, " " + m[1] + " ") || pickCat(ctx, "gelir", KW_IN, " " + m[1] + " "); const all = [...(ctx.cats?.gider || []), ...(ctx.cats?.gelir || [])]; const ex = all.find(x => fold(x.n).includes(fold(m[1]).trim())); return { intent: "edit-last", field: "category", value: ex ? { category: ex.n, sub: "" } : c ? { category: c.category, sub: c.sub } : null, raw: m[1], conf: 0.8 }; }
  m = t.match(/\bhesab\w*\s+(.+?)\s*(olsun|olacak|yap|olmali)\b/);
  if (m) { const a = matchAccounts(m[1], ctx)[0]; return { intent: "edit-last", field: "account", value: a?.id || null, raw: m[1], conf: 0.8 }; }
  m = t.match(/\btarih\w*\s+(.+?)\s*(olsun|olacak|yap|olmali)\b/);
  if (m) { const d = findDate(m[1], today, false); return { intent: "edit-last", field: "date", value: d, conf: d ? 0.8 : 0.3 }; }

  // soru
  if (RX.q.test(t) && !(main && main.strong && !/\?/.test(t))) {
    const per = findPeriod(text, today), accs = matchAccounts(text, ctx), con = matchContact(text, ctx);
    const inc = /\b(gelir\w*|kazan\w*|kazandim|tahsil\w*|ne geldi|gelen)\b/.test(t);
    let q = "spend";
    if (/\b(bakiye\w*|ne kadar param|param ne kadar|hesab\w* ne kadar|hesapta ne kadar|kac param)\b/.test(t)) q = "balance";
    else if (/\b(kart\w* borc\w*|borcum ne|borclarim|kartta ne kadar|ekstre\w*|asgari)\b/.test(t)) q = "debt";
    else if (/\b(yaklasan|vade\w*|odemelerim|bekleyen|hangi odeme)\b/.test(t)) q = "upcoming";
    else if (/\b(net|kar|zarar|durum\w*|ozet\w*)\b/.test(t) && !/\bharca/.test(t)) q = "net";
    else if (/\b(en cok|nereye|neye|kategori\w*)\b/.test(t)) q = "top";
    else if (inc) q = "income";
    const c = q === "spend" ? pickCat(ctx, "gider", KW, " " + t + " ") : q === "income" ? pickCat(ctx, "gelir", KW_IN, " " + t + " ") : null;
    return { intent: "query", q, period: per, category: c?.category || "", sub: c?.sub || "", accountId: accs[0]?.score >= 2 ? accs[0].id : "", contactId: con?.id || "", conf: 0.8 };
  }

  if (!main) {
    return { intent: RX.del.test(t) ? "delete-last" : "unknown", conf: 0.1 };
  }

  const accs = matchAccounts(text, ctx), con = matchContact(text, ctx), learned = ctx.learned || { cat: {}, acc: {} };
  const amount = main.v, cur = main.cur || "TRY";
  const futureDate = findDate(text, today, true), pastDate = findDate(text, today, false);

  // vade (gelecek ödeme / tahsilat)
  if (RX.plan.test(t) && (!pastDate || futureDate > today || /\b(ayin|yarin|gelecek|haftaya|vade)\b/.test(t))) {
    const due = futureDate && futureDate >= today ? futureDate : null;
    const dir = /\b(tahsil\w*|alacag\w*|alacak\w*|bana (odeyecek|verecek)|gelecek|yatacak)\b/.test(t) || con?.abl || con && /\b(odeyecek|verecek|gonderecek|yatiracak|odemesi var)\b/.test(t) ? "tahsilat" : "ödeme";
    const c = dir === "tahsilat" ? pickCat(ctx, "gelir", KW_IN, " " + t + " ") : pickCat(ctx, "gider", KW, " " + t + " ");
    return { intent: "plan", dir, amount: cur === "TRY" ? amount : amount, cur, due, contactId: con?.id || "", category: c?.category || (dir === "tahsilat" ? "Diğer gelir" : "Diğer gider"), sub: c?.sub || "", note: cleanNote(text), conf: due ? 0.85 : 0.5, missing: due ? [] : ["due"] };
  }

  const date = pastDate && pastDate <= today ? pastDate : today;
  // kart borcu ödemesi → transfer (banka → kart)
  const card = accs.find(x => x.a.credit), bank = accs.find(x => !x.a.credit);
  if (card && RX.cardPay.test(t) && !card.ins) {
    const from = bank?.id || card.a.payFrom || ctx.lastBank || "";
    return { intent: "add", type: "transfer", amount, cur, date, accountId: from, toAccountId: card.id, category: "Transfer", note: "Kart borcu ödemesi", conf: 0.85, missing: from ? [] : ["account"] };
  }
  // hesaplar arası transfer
  if (RX.transfer.test(t) && accs.length >= 2 || accs.length >= 2 && accs.some(x => x.abl) && accs.some(x => x.dat) && !/\b(harca|alisveris|odedim)\b/.test(t)) {
    const fromA = accs.find(x => x.abl) || accs.slice(0, 2).sort((a, b) => a.pos - b.pos)[0], toA = accs.find(x => x.id !== fromA.id && x.dat) || accs.find(x => x.id !== fromA.id);
    return { intent: "add", type: "transfer", amount, cur, date, accountId: fromA.id, toAccountId: toA.id, category: "Transfer", note: cleanNote(text), conf: 0.85, missing: [] };
  }

  // gelir mi gider mi
  let type = "gider";
  if (RX.income.test(t) && !/\b(maas\w* odedim|maasini odedim|prim\w* odedim|komisyon\w* odedim|faiz\w* odedim|kesildi)\b/.test(t)) type = "gelir";
  if (con && con.abl && RX.incomeVerbs.test(t)) type = "gelir"; // "Ali'den 3000 aldım"
  if (/\b(harcadim|odedim|verdim|aldim|harcama|alisveris|satin)\b/.test(t) && !RX.income.test(t)) type = "gider";

  // kategori: öğrenilmiş kelimeler > anahtar kelimeler > banka açıklama kuralları
  let category = "", sub = "", src = "";
  const kws = keyWords(text);
  const votes = {}; kws.forEach(w => { const v = learned.cat[w]; if (v) votes[v] = (votes[v] || 0) + 1; });
  const lv = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const okType = cs => { const [c] = cs.split("|"); return ((ctx.cats || {})[type] || []).some(x => x.n === c); };
  if (lv && okType(lv[0])) { [category, sub = ""] = lv[0].split("|"); src = "learned"; }
  if (!category) { const c = pickCat(ctx, type, type === "gelir" ? KW_IN : KW, " " + t + " "); if (c) { category = c.category; sub = c.sub; src = "kw"; } }
  if (!category && ctx.guess) { const g = ctx.guess(text, type === "gelir" ? 1 : -1); if (g && !/^Diğer/.test(g) && okType(g)) { [category, sub = ""] = g.split("|"); src = "rules"; } }
  if (!category) category = type === "gelir" ? "Diğer gelir" : "Diğer gider";

  // hesap: açıkça söylendiyse o; yoksa öğrenilmiş kelime → son kullanılan
  let accountId = accs[0] && accs[0].score >= 1 ? accs[0].id : "";
  if (!accountId) { const av = {}; kws.forEach(w => { const v = learned.acc[w]; if (v) av[v] = (av[v] || 0) + 1; }); const best = Object.entries(av).sort((a, b) => b[1] - a[1])[0]; if (best && ctx.accounts.some(a => a.id === best[0])) accountId = best[0]; }
  const accGuessed = !accs.length;
  if (!accountId) accountId = ctx.lastAcc && ctx.accounts.some(a => a.id === ctx.lastAcc) ? ctx.lastAcc : (ctx.accounts[0] || {}).id || "";

  const inst = (() => { const m = t.match(/(\d{1,2})\s*taksit/); return m && +m[1] > 1 ? +m[1] : 0; })();
  let conf = 0.5 + (main.strong ? 0.2 : 0) + (category && !/^Diğer/.test(category) ? 0.2 : 0) + (accGuessed ? 0 : 0.1);
  return { intent: "add", type, amount, cur, date, accountId, accGuessed, category, sub, catSrc: src, contactId: con?.id || "", note: cleanNote(text), inst, conf: Math.min(1, conf), missing: [] };
}

export const _dbg = { amounts, findDate, matchAccounts, matchContact, cleanNote, keyWords };
