// Kasa Defteri — banka ekstresi okuyucu (Excel / CSV)
// Saf fonksiyonlar: dosyayı satırlara çevirir, sütunları bulur, tarih/tutar ayrıştırır, kategori tahmin eder.

const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = XLSX_URL; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxPromise = null; rej(new Error("Excel okuyucu yüklenemedi. İnternet bağlantını kontrol et.")); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

export const up = s => String(s ?? "").toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();
const norm = s => up(s).replace(/[İI]/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C");

/* ---------- dosya → satırlar ---------- */
function decodeText(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { try { return new TextDecoder("windows-1254").decode(buf); } catch (_) { return new TextDecoder("iso-8859-9").decode(buf); } }
}
export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const sample = text.split(/\r?\n/).slice(0, 30).join("\n");
  const cnt = d => (sample.match(new RegExp(d === "\t" ? "\t" : "\\" + d, "g")) || []).length;
  const delim = [";", "\t", ",", "|"].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export async function fileToRows(file) {
  const name = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // xlsx
  const isOle = head[0] === 0xd0 && head[1] === 0xcf; // eski xls
  if (isZip || isOle || /\.(xlsx|xls|ods)$/.test(name)) {
    const text = !isZip && !isOle ? decodeText(buf) : "";
    if (text && /<table|<html/i.test(text)) return htmlToRows(text); // bazı bankalar HTML'i .xls diye verir
    if (text && !isZip && !isOle) return parseCSV(text);
    const XLSX = await loadXLSX();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    let best = [];
    for (const sn of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: "", blankrows: false });
      if (rows.length > best.length) best = rows;
    }
    return best;
  }
  const text = decodeText(buf);
  if (/<table/i.test(text)) return htmlToRows(text);
  return parseCSV(text);
}
function htmlToRows(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("tr")].map(tr => [...tr.querySelectorAll("td,th")].map(td => td.textContent.trim()));
}

/* ---------- sütun tespiti ---------- */
const KW = {
  date: ["ISLEM TARIHI", "TARIH", "VALOR", "DATE"],
  desc: ["ACIKLAMA", "ISLEM ACIKLAMASI", "DETAY", "ISLEM", "DESCRIPTION", "AÇIKLAMA"],
  amount: ["ISLEM TUTARI", "TUTAR", "MIKTAR", "AMOUNT"],
  debit: ["BORC", "CIKAN", "GIDEN", "HARCAMA", "CEKILEN"],
  credit: ["ALACAK", "GIREN", "GELEN", "YATAN"],
  dir: ["B/A", "BORC/ALACAK", "ISLEM TIPI", "YON"],
  balance: ["BAKIYE", "BALANCE"]
};
const has = (h, list) => list.some(k => h.includes(k));
export function detectHeader(rows) {
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const hs = (rows[i] || []).map(norm);
    let sc = 0;
    if (hs.some(h => has(h, KW.date))) sc += 2;
    if (hs.some(h => has(h, KW.amount) || has(h, KW.debit) || has(h, KW.credit))) sc += 2;
    if (hs.some(h => has(h, KW.desc))) sc += 1;
    if (hs.some(h => has(h, KW.balance))) sc += 1;
    if (sc > best.score) best = { idx: i, score: sc };
  }
  return best.score >= 4 ? best.idx : -1;
}
export function guessMapping(headers, rows) {
  const hs = headers.map(norm), m = { date: -1, desc: -1, mode: "signed", amount: -1, debit: -1, credit: -1, dir: -1, balance: -1 };
  const find = (list, not = []) => hs.findIndex(h => h && has(h, list) && !has(h, not));
  m.date = find(["ISLEM TARIHI"]); if (m.date < 0) m.date = find(KW.date, ["VALOR"]); if (m.date < 0) m.date = find(KW.date);
  m.desc = find(["ACIKLAMA", "DESCRIPTION", "DETAY"]); if (m.desc < 0) m.desc = find(["ISLEM"], ["TARIH", "TUTAR", "TIPI", "NO"]);
  m.balance = find(KW.balance);
  m.dir = hs.findIndex(h => h === "B/A" || h === "BORC/ALACAK" || h === "ISLEM TIPI" || h === "YON");
  const debit = find(KW.debit, ["ALACAK", "/"]), credit = find(KW.credit, ["BORC", "/"]);
  const amount = find(KW.amount, ["BAKIYE"]);
  if (debit >= 0 && credit >= 0) { m.mode = "split"; m.debit = debit; m.credit = credit; }
  else if (amount >= 0) { m.amount = amount; m.mode = m.dir >= 0 ? "dir" : "signed"; }
  if (m.desc < 0) { // en uzun metin sütunu
    let bestLen = 0; headers.forEach((_, c) => { if ([m.date, m.amount, m.debit, m.credit, m.balance, m.dir].includes(c)) return; const L = rows.slice(0, 20).reduce((t, r) => t + String(r[c] ?? "").length, 0); if (L > bestLen) { bestLen = L; m.desc = c; } });
  }
  return m;
}

/* ---------- değer ayrıştırma ---------- */
const p2 = n => String(n).padStart(2, "0");
export function parseDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) { // Excel seri tarih
    const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const d = +m[1], mo = +m[2]; if (mo > 12 || d > 31) return null; return `${y}-${p2(mo)}-${p2(d)}`; }
  const AY = { OCAK: 1, SUBAT: 2, MART: 3, NISAN: 4, MAYIS: 5, HAZIRAN: 6, TEMMUZ: 7, AGUSTOS: 8, EYLUL: 9, EKIM: 10, KASIM: 11, ARALIK: 12 };
  m = norm(s).match(/^(\d{1,2})\s+([A-Z]+)\s+(\d{4})/);
  if (m && AY[m[2]]) return `${m[3]}-${p2(AY[m[2]])}-${p2(m[1])}`;
  return null;
}
export function parseAmount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? Math.round(v * 100) / 100 : null;
  let s = String(v).trim(); if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /^-|-\s*$|\s-$/.test(s.replace(/\s*(TL|TRY|₺)\s*$/i, ""));
  if (/\b(B|BORC|BORÇ)\s*$/i.test(s)) neg = true;
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) && !/,\d{2}$/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s); if (!isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

/* ---------- satırları işlemlere çevir ---------- */
export function extract(rows, headerIdx, m) {
  const out = [], body = rows.slice(headerIdx + 1);
  for (let i = 0; i < body.length; i++) {
    const r = body[i] || [];
    const date = parseDate(r[m.date]); if (!date) continue;
    let amt = null;
    if (m.mode === "split") {
      const d = parseAmount(r[m.debit]), c = parseAmount(r[m.credit]);
      if (c && Math.abs(c) > 0) amt = Math.abs(c); else if (d && Math.abs(d) > 0) amt = -Math.abs(d);
    } else {
      amt = parseAmount(r[m.amount]);
      if (amt != null && m.mode === "dir") { const dv = norm(r[m.dir]); if (/^(B|BORC|-|CIKIS|GIDER|HARCAMA)/.test(dv)) amt = -Math.abs(amt); else if (/^(A|ALACAK|\+|GIRIS|GELIR)/.test(dv)) amt = Math.abs(amt); }
    }
    if (!amt) continue;
    const desc = String(r[m.desc] ?? "").replace(/\s+/g, " ").trim();
    const bal = m.balance >= 0 ? parseAmount(r[m.balance]) : null;
    out.push({ row: i, date, amount: amt, desc, balance: bal });
  }
  return out;
}

/* ---------- kategori tahmini ---------- */
const RULES = [
  ["Kira", ["KIRA"]],
  ["Faturalar", ["ELEKTRIK", "ENERJISA", "CK ENERJI", "AYEDAS", "BEDAS", "IGDAS", "DOGALGAZ", "DOGAL GAZ", "ISKI", "ASKI", "IZSU", "SU IDARESI", "TURKCELL", "VODAFONE", "TURK TELEKOM", "TT MOBIL", "SUPERONLINE", "TURKNET", "D-SMART", "DIGITURK", "FATURA"]],
  ["Vergi / SGK", ["SGK", "VERGI", "GIB ", "GELIR IDARESI", "KDV", "MTV", "STOPAJ", "BAG-KUR", "BAGKUR"]],
  ["Banka masrafı", ["MASRAF", "KOMISYON", "BSMV", "KART AIDATI", "HESAP ISLETIM", "EFT UCRETI", "HAVALE UCRETI", "UCRET"]],
  ["Ulaşım", ["AKARYAKIT", "SHELL", "OPET", "PETROL OFISI", " PO ", "BP ", "TOTAL", "AYTEMIZ", "HGS", "OGS", "ISTANBULKART", "UBER", "BITAKSI", "TAKSI", "OTOPARK", "ISPARK", "MARTI", "THY", "PEGASUS", "AJET"]],
  ["Pazarlama", ["FACEBK", "FACEBOOK", "META ", "GOOGLE ADS", "INSTAGRAM", "TIKTOK ADS", "LINKEDIN"]],
  ["Yazılım", ["GOOGLE", "APPLE.COM", "ITUNES", "MICROSOFT", "ADOBE", "CANVA", "ANTHROPIC", "CLAUDE", "OPENAI", "CHATGPT", "GITHUB", "ZOOM", "NOTION", "DROPBOX"]],
  ["Lojistik", ["KARGO", "YURTICI", "ARAS ", "MNG", "PTT", "SURAT", "HEPSIJET", "TRENDYOL EXPRESS"]],
  ["Market / Gıda", ["MIGROS", "A101", "BIM ", "SOK MARKET", "SOK ", "CARREFOUR", "MACROCENTER", "FILE ", "METRO ", "GETIR", "YEMEKSEPETI", "TRENDYOL YEMEK", "RESTORAN", "CAFE", "KAFE", "STARBUCKS", "BURGER", "PIZZA"]],
  ["Ofis", ["KIRTASIYE", "OFIS", "OFFICE", "IKEA", "KOCTAS", "BAUHAUS"]]
];
const RULES_IN = [
  ["Faiz geliri", ["FAIZ", "GETIRI"]],
  ["Komisyon", ["PRIM", "KOMISYON", "BONUS"]],
  ["Satış", ["SATIS", "TAHSILAT", "POS"]]
];
export const learnKey = d => norm(d).replace(/[0-9*#:/\\.,-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
export function guessCategory(desc, amount, learned) {
  const k = learnKey(desc); if (k && learned[k]) return learned[k];
  const d = " " + norm(desc) + " ";
  for (const [cat, keys] of amount > 0 ? RULES_IN : RULES) if (keys.some(x => d.includes(x))) return cat;
  return amount > 0 ? "Diğer gelir" : "Diğer gider";
}
export function headerSignature(headers) { return headers.map(norm).filter(Boolean).join("|").slice(0, 300); }
