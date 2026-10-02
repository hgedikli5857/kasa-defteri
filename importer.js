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
/* ---------- PDF (metin tabanlı) ---------- */
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
let pdfPromise = null;
function loadPDF() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfPromise) pdfPromise = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror = () => { pdfPromise = null; rej(new Error("PDF okuyucu yüklenemedi. İnternet bağlantını kontrol et.")); };
    document.head.appendChild(s);
  });
  return pdfPromise;
}
export class PdfPasswordError extends Error { constructor(wrong) { super(wrong ? "PDF şifresi yanlış." : "Bu PDF şifreli."); this.wrong = wrong; } }

// Sayfadaki metin parçalarını satırlara (y) ve hücrelere (x boşlukları) ayırır
async function pdfLines(buf, password) {
  const pdfjs = await loadPDF();
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(buf), password: password || undefined, isEvalSupported: false }).promise; }
  catch (e) { if (e && e.name === "PasswordException") throw new PdfPasswordError(e.code === 2); throw new Error("PDF açılamadı: " + (e && e.message || "bilinmeyen hata")); }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent(), vp = page.getViewport({ scale: 1 });
    // görüntü koordinatlarına çevir: döndürülmüş / ters basılmış sayfalar (ör. Albaraka) de soldan sağa, yukarıdan aşağı okunur
    const items = tc.items.filter(it => it.str && it.str.trim()).map(it => {
      const t = pdfjs.Util.transform(vp.transform, it.transform), h = Math.hypot(t[2], t[3]) || 8;
      return { s: it.str, x: t[4], y: -t[5], w: it.width || it.str.length * 4, h };
    });
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const pageLines = [];
    for (const it of items) {
      const L = pageLines.find(l => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35));
      if (L) L.items.push(it); else pageLines.push({ y: it.y, items: [it] });
    }
    pageLines.sort((a, b) => b.y - a.y);
    for (const l of pageLines) {
      l.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const it of l.items) {
        const c = cells[cells.length - 1];
        const gap = c ? it.x - (c.x1) : 99;
        if (c && gap < Math.max(4, it.h * 0.9)) { c.s += (gap > it.h * 0.15 ? " " : "") + it.s; c.x1 = it.x + it.w; }
        else cells.push({ s: it.s, x0: it.x, x1: it.x + it.w });
      }
      cells.forEach(c => { c.s = c.s.replace(/\s+/g, " ").trim(); });
      lines.push({ page: p, y: l.y, h: Math.max(...l.items.map(i => i.h)), cells: cells.filter(c => c.s) });
    }
  }
  if (!lines.some(l => l.cells.length)) throw new Error("Bu PDF'te okunabilir metin yok (taranmış görüntü olabilir). Bankadan Excel ya da e-ekstre PDF'i indir.");
  return lines;
}
// Başlık satırındaki sütun konumlarına göre tablo kurar
function linesToTable(lines) {
  const texts = lines.map(l => l.cells.map(c => c.s));
  const hIdx = detectHeader(texts);
  if (hIdx < 0) return null;
  const head = lines[hIdx].cells;
  const anchors = head.map(c => ({ x0: c.x0, x1: c.x1, cx: (c.x0 + c.x1) / 2 }));
  const pick = c => { // hücreyi en çok örtüşen / en yakın başlığa ata
    let best = 0, bestScore = -Infinity;
    anchors.forEach((a, i) => { const ov = Math.min(a.x1, c.x1) - Math.max(a.x0, c.x0); const sc = ov > 0 ? ov : -Math.abs((c.x0 + c.x1) / 2 - a.cx); if (sc > bestScore) { bestScore = sc; best = i; } });
    return best;
  };
  const rows = texts.slice(0, hIdx).map(t => t);
  rows.push(head.map(c => c.s));
  const meta = [];
  for (const l of lines.slice(hIdx + 1)) {
    const r = new Array(anchors.length).fill("");
    for (const c of l.cells) { const i = pick(c); r[i] = r[i] ? r[i] + " " + c.s : c.s; }
    rows.push(r); meta.push(l);
  }
  // çok satırlı açıklamaları önceki harekete ekle
  const m = guessMapping(rows[hIdx], rows.slice(hIdx + 1));
  const out = rows.slice(0, hIdx + 1);
  let prevLine = null, prevIsTx = false, contN = 0;
  rows.slice(hIdx + 1).forEach((r, k) => {
    const L = meta[k], prev = out[out.length - 1];
    const hasDate = parseDate(r[m.date]) != null;
    const hasAmt = r.some((v, i) => i !== m.desc && v && /\d,\d{2}\b|\d\.\d{2}\b/.test(v) && parseAmount(v) != null);
    // devam satırı: tarih/tutar yok, aynı sayfada ve bir önceki satırın hemen altında
    const near = prevLine && L.page === prevLine.page && (prevLine.y - L.y) < Math.max(L.h, prevLine.h) * 2.4;
    if (!hasDate && !hasAmt && prevIsTx && near && contN < 3 && m.desc >= 0) {
      const txt = r.filter(Boolean).join(" "); if (txt) prev[m.desc] = (prev[m.desc] + " " + txt).trim(); contN++;
    } else { out.push(r); prevIsTx = hasDate && hasAmt; contN = 0; }
    prevLine = L;
  });
  return out;
}
// Başlık bulunamazsa: "tarih ... açıklama ... tutar [bakiye]" satırlarını yakala
const MONEY = /[-+]?\(?\d{1,3}(?:\.\d{3})*,\d{2,4}\)?(?:\s*(?:TL|TRY|B|A|\+|-))?|[-+]?\d+,\d{2,4}(?:\s*(?:TL|TRY))?/g;
function linesToRegexRows(lines) {
  const rows = [["Tarih", "Açıklama", "Tutar", "Bakiye"]];
  let lastL = null;
  for (const l of lines) {
    const t = l.cells.map(c => c.s).join("  ");
    const dm = t.match(/^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.*)$/);
    if (!dm) { const prev = rows[rows.length - 1]; const near = lastL && l.page === lastL.page && (lastL.y - l.y) < Math.max(l.h, lastL.h) * 2.4; if (rows.length > 1 && near && t && !(t.match(MONEY) || []).length && t.length < 120) prev[1] = (prev[1] + " " + t).trim(); lastL = null; continue; }
    lastL = l;
    const rest = dm[2]; const ms = [...rest.matchAll(MONEY)];
    if (!ms.length) continue;
    const tailStart = ms.length >= 2 && rest.slice(ms[ms.length - 2].index + ms[ms.length - 2][0].length, ms[ms.length - 1].index).trim() === "" ? ms.length - 2 : ms.length - 1;
    const amt = ms[tailStart][0], bal = tailStart < ms.length - 1 ? ms[ms.length - 1][0] : "";
    const desc = rest.slice(0, ms[tailStart].index).replace(/\s+/g, " ").trim();
    rows.push([dm[1], desc, amt, bal]);
  }
  return rows.length > 1 ? rows : null;
}
// Kart ekstresi özet bilgileri: kart limiti, hesap kesim günü, dönem borcu
export function statementMeta(text) {
  const T = norm(text), num = re => { const m = T.match(re); return m ? parseAmount(m[1]) : null; };
  const meta = { limit: num(/KART LIMITI\s*(?:\(TL\))?\s*:?\s*([\d.,]+)/), debt: num(/DONEM BORCU\s*(?:\(TL\))?\s*:?\s*([\d.,]+)/) };
  const c = T.match(/(?<!SONRAKI )HESAP KESIM TARIHI\s*:?\s*(\d{1,2})[\s./-]/); if (c && +c[1] >= 1 && +c[1] <= 31) meta.cutDay = +c[1];
  return meta.limit || meta.cutDay || meta.debt ? meta : null;
}
async function pdfToRows(buf, password) {
  const lines = await pdfLines(buf, password);
  const meta = statementMeta(lines.map(l => l.cells.map(c => c.s).join(" ")).join("\n"));
  const withMeta = r => { if (meta) r.meta = meta; return r; };
  const table = linesToTable(lines);
  if (table) {
    const h = detectHeader(table), m = guessMapping(table[h], table.slice(h + 1));
    if (extract(table, h, m).length) return withMeta(table);
  }
  const rx = linesToRegexRows(lines);
  if (rx) return withMeta(rx);
  throw new Error("PDF'te hesap hareketi tablosu bulunamadı. Bu bankanın PDF biçimini Claude'a gönder, okuyucuyu uyarlasın.");
}

export async function fileToRows(file, password) {
  const name = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  if ((head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) || name.endsWith(".pdf")) return pdfToRows(buf, password);
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
  // döviz/altın ekstreleri: miktar (gr/adet) ve TL tutar sütunları ayrı olabilir
  m.qtyCol = hs.findIndex(h => h && /\b(GR|GRAM|ADET|MIKTAR|ONS)\b|\(GR\)/.test(h) && !/BAKIYE/.test(h));
  m.tlCol = hs.findIndex((h, i) => h && i !== m.qtyCol && /\b(TL|TRY)\b|TL KARSILIGI|TUTAR/.test(h) && !/BAKIYE|KUR|FIYAT/.test(h));
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
// qty=true: altın/döviz miktarı. Tek virgül her zaman ondalıktır (3,000 gr = 3 gr), 3 basamak korunur.
export function parseAmount(v, qty) {
  if (v == null || v === "") return null;
  const R = qty ? 1000 : 100;
  if (typeof v === "number") return isFinite(v) ? Math.round(v * R) / R : null;
  let s = String(v).trim(); if (!s) return null;
  let neg = /^\(.*\)$/.test(s) || /^-|-\s*$|\s-$/.test(s.replace(/\s*(TL|TRY|₺)\s*$/i, ""));
  if (/\b(B|BORC|BORÇ)\s*$/i.test(s)) neg = true;
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = !qty && /^\d{1,3}(,\d{3})+$/.test(s) && !/,\d{2}$/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s); if (!isFinite(n)) return null;
  return Math.round((neg ? -n : n) * R) / R;
}
// Açıklamadaki miktar: "ALTIN ALIS 3,00 GR", "2 ADET CEYREK"
export function qtyFromDesc(d) {
  const m = up(d).match(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(GR|GRAM|GRM|ADET|AD\.?)(?![A-Z])/);
  if (!m) return null; const n = parseAmount(m[1], true); return n > 0 ? n : null;
}

/* ---------- satırları işlemlere çevir ---------- */
export function extract(rows, headerIdx, m, opt = {}) {
  const out = [], body = rows.slice(headerIdx + 1);
  for (let i = 0; i < body.length; i++) {
    const r = body[i] || [];
    const date = parseDate(r[m.date]); if (!date) continue;
    let amt = null;
    if (m.mode === "split") {
      const d = parseAmount(r[m.debit], opt.qty), c = parseAmount(r[m.credit], opt.qty);
      if (c && Math.abs(c) > 0) amt = Math.abs(c); else if (d && Math.abs(d) > 0) amt = -Math.abs(d);
    } else {
      amt = parseAmount(r[m.amount], opt.qty);
      if (amt != null && m.mode === "dir") { const dv = norm(r[m.dir]); if (/^(B|BORC|-|CIKIS|GIDER|HARCAMA)/.test(dv)) amt = -Math.abs(amt); else if (/^(A|ALACAK|\+|GIRIS|GELIR)/.test(dv)) amt = Math.abs(amt); }
    }
    if (!amt) continue;
    const rawA = String((m.mode === "split" ? "" : r[m.amount]) ?? "").trim();
    if (m.invert) amt = /^\+/.test(rawA) ? Math.abs(amt) : -amt; // kart ekstresinde "+4.080,78" = ödeme (alacak)
    const desc = cleanDesc(String(r[m.desc] ?? ""));
    const bal = m.balance >= 0 ? parseAmount(r[m.balance], opt.qty) : null;
    const q = opt.qtyCol >= 0 ? parseAmount(r[opt.qtyCol], true) : null, tl = opt.tlCol >= 0 ? parseAmount(r[opt.tlCol]) : null;
    out.push({ row: i, date, amount: amt, desc, balance: bal, rawDesc: String(r[m.desc] ?? ""), q: q != null ? Math.abs(q) : null, tl: tl != null ? Math.abs(tl) : null });
  }
  return out;
}

/* ---------- kategori tahmini ---------- */
const RULES = [
  ["Kira", ["KIRA"]],
  ["Vergi / SGK", ["SGK", "VERGI", "GIB ", "GELIR IDARESI", "KDV", "MTV", "STOPAJ", "BAG-KUR", "BAGKUR", "TAPU HARC", "TRAFIK CEZA", "BELEDIYE EMLAK"]],
  ["Faturalar", ["ELEKTRIK", "ENERJISA", "CK ENERJI", "AYEDAS", "BEDAS", "IGDAS", "DOGALGAZ", "DOGAL GAZ", "ISKI", "ASKI", "IZSU", "SU IDARESI", "TURKCELL", "VODAFONE", "TURK TELEKOM", "TT MOBIL", "SUPERONLINE", "TURKNET", "D-SMART", "DIGITURK", "FATURA"]],
  ["Banka masrafı", ["MASRAF", "BSMV", "KART AIDATI", "HESAP ISLETIM", "EFT UCRETI", "HAVALE UCRETI", "KOMISYON"]],
  ["Lojistik", ["KARGO", "YURTICI", "ARAS ", "MNG", "PTT", "SURAT", "HEPSIJET", "TRENDYOL EXPRESS"]],
  ["Market / Gıda", ["GIDA", "EKMEK", "UNLU MAMUL", "SUT ", "MANDIRA", "SARKUTERI", "BAKKAL", "TEKEL", "POPEYES", "BURGER KING", "MCDONALDS", "KFC", "DOMINOS", "LITTLE CAESARS", "SUBWAY", "SBARRO", "ARBYS", "USTA DONERCI", "KOFTECI", "BALIK", "TATLI", "BAKLAVA", "MIGROS", "A101", "BIM ", "SOK MARKET", "SOK ", "CARREFOUR", "MACROCENTER", "FILE ", "METRO ", "HAKMAR", "GETIR", "YEMEKSEPETI", "TRENDYOL YEMEK", "TRENDYOL GO", "RESTORAN", "LOKANTA", "CAFE", "KAFE", "STARBUCKS", "KAHVE", "BURGER", "PIZZA", "DONER", "FIRIN", "PASTANE", "SIMIT", "KASAP", "MANAV"]],
  ["Ulaşım", ["AKARYAKIT", "SHELL", "OPET", "PETROL OFISI", " PO ", "BP ", "TOTAL", "AYTEMIZ", "HGS", "OGS", "ISTANBULKART", "UBER", "BITAKSI", "TAKSI", "OTOPARK", "ISPARK", "MARTI", "THY", "PEGASUS", "AJET", "OTOBUS", "METRO TURIZM", "PAMUKKALE", "KAMIL KOC", "LASTIK", "OTO SERVIS"]],
  ["Giyim", ["LC WAIKIKI", "LCW", "DEFACTO", "KOTON", "ZARA", "H&M", "H M ", "MAVI", "COLINS", "COLIN S", "BOYNER", "FLO ", "INSTREET", "SKECHERS", "NIKE", "ADIDAS", "PUMA", "MANGO", "PULL&BEAR", "PULL AND BEAR", "BERSHKA", "STRADIVARIUS", "US POLO", "U.S. POLO", "NETWORK", "VAKKO", "BEYMEN", "DERIMOD", "PENTI", "SUWEN", "MARKS SPENCER", "LTB", "JACK JONES", "DECATHLON", "SPORTIVE", "AYAKKABI", "GIYIM", "TEKSTIL"]],
  ["Yapı market / Ev", ["KOCTAS", "BAUHAUS", "IKEA", "TEKZEN", "PRAKTIKER", "ENGLISH HOME", "MADAME COCO", "KARACA", "EVIDEA", "PASABAHCE", "YAPI MARKET", "HIRDAVAT", "BOYA", "MOBILYA", "ISTIKBAL", "BELLONA", "DOGTAS", "ENZA", "CILEK", "KELEBEK"]],
  ["Elektronik", ["MEDIAMARKT", "MEDIA MARKT", "TEKNOSA", "VATAN BILGISAYAR", "APPLE STORE", "SAMSUNG", "XIAOMI", "ARCELIK", "BEKO", "VESTEL", "BOSCH", "ITOPYA"]],
  ["Sağlık", ["ECZANE", "ECZ.", "HASTANE", "HASTANESI", "KLINIK", "POLIKLINIK", "DIS HEKIMI", "TIP MERKEZI", "LABORATUVAR", "OPTIK", "ACIBADEM", "MEDICAL PARK", "MEMORIAL", "LIV HOSPITAL"]],
  ["Kişisel bakım", ["GRATIS", "WATSONS", "ROSSMANN", "EVE SHOP", "SEPHORA", "MAC COSMETICS", "FLORMAR", "KUAFOR", "BERBER", "GUZELLIK"]],
  ["Eğlence / Abonelik", ["NETFLIX", "SPOTIFY", "YOUTUBE", "DISNEY", "EXXEN", "BLUTV", "BLU TV", "AMAZON PRIME", "PRIME VIDEO", "TABII", "GAIN", "SINEMA", "CINEMAXIMUM", "PARIBU CINEMA", "BILETIX", "PASSO", "STEAM", "PLAYSTATION", "XBOX"]],
  ["Eğitim", ["OKUL", "KOLEJ", "UNIVERSITE", "DERSHANE", "KURS", "UDEMY", "COURSERA", "D&R", "D R ", "KITAP", "KITABEVI", "IDEFIX"]],
  ["Pazarlama", ["FACEBK", "FACEBOOK", "META ", "GOOGLE ADS", "INSTAGRAM", "TIKTOK ADS", "LINKEDIN"]],
  ["Yazılım", ["GOOGLE", "APPLE.COM", "ITUNES", "MICROSOFT", "ADOBE", "CANVA", "ANTHROPIC", "CLAUDE", "OPENAI", "CHATGPT", "GITHUB", "ZOOM", "NOTION", "DROPBOX"]],
  ["Online alışveriş", ["TRENDYOL", "HEPSIBURADA", "AMAZON", "N11", "CICEKSEPETI", "TEMU", "ALIEXPRESS", "SHEIN", "PTTAVM", "MORHIPO", "IYZICO", "PAYTR"]],
  ["Ofis", ["KIRTASIYE", "OFIS", "OFFICE"]],
  ["Market / Gıda", ["MARKET", "MARKT", "SUPERMARKET", "HIPERMARKET"]],
  ["Banka masrafı", ["UCRET"]]
];
const RULES_IN = [
  ["Faiz geliri", ["FAIZ", "GETIRI"]],
  ["Komisyon", ["PRIM", "KOMISYON", "BONUS"]],
  ["Satış", ["SATIS", "TAHSILAT", "POS"]]
];
// Banka açıklamalarındaki referans kodlarını ve kalıp sözcükleri temizler:
// "A00QU Firma Adı: ODEAL//UCUZLER MARKET ANKARA,Harcama" -> "UCUZLER MARKET ANKARA"
export function cleanDesc(d) {
  let t = String(d ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?=[A-Z0-9]{4,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}\s+/i, "");           // baştaki referans kodu (A00QU, 123456)
  t = t.replace(/\b(firma ad[ıi]|i[şs]yeri( ad[ıi])?|al[ıi]c[ıi]|g[öo]nderen|a[çc][ıi]klama)\s*:\s*/gi, "");
  t = t.replace(/\b(ODEAL|IYZICO|IYZ|PAYTR|PARAM|PAPARA|SIPAY|MOKA|ESNEKPOS|PAYU|STRIPE|PAYPAL)\s*(\/\/|\*|\/)\s*/gi, "");
  t = t.replace(/[,;\s]+(harcama|al[ıi]şveri[şs]|i[şs]lem|[öo]deme|provizyon|pe[şs]in|taksitli)\s*$/i, "");
  t = t.replace(/^(pos|sanal pos|internet|e-ticaret|kart)\s*[-:]?\s+(?=\S)/i, "");
  t = t.replace(/\s*\*{2,}\d+\s*/g, " ").replace(/\s+/g, " ").replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim();
  return t || String(d ?? "").trim();
}
export const learnKey = d => norm(cleanDesc(d)).replace(/[0-9*#:/\\.,-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
export function guessCategory(desc, amount, learned) {
  desc = cleanDesc(desc);
  const k = learnKey(desc); if (k && learned[k]) return learned[k];
  const d = " " + norm(desc) + " ";
  for (const [cat, keys] of amount > 0 ? RULES_IN : RULES) if (keys.some(x => d.includes(x))) return cat;
  return amount > 0 ? "Diğer gelir" : "Diğer gider";
}
const SUBRULES = [
  ["Elektrik", ["ELEKTRIK", "ENERJISA", "CK ENERJI", "AYEDAS", "BEDAS"]], ["Doğalgaz", ["IGDAS", "DOGALGAZ", "DOGAL GAZ", "BASKENTGAZ", "IZMIRGAZ"]], ["Su", ["ISKI", "ASKI", "IZSU", "SU IDARESI"]],
  ["Telefon", ["TURKCELL", "VODAFONE", "TT MOBIL"]], ["İnternet", ["SUPERONLINE", "TURKNET", "TURK TELEKOM", "TTNET"]],
  ["Akaryakıt", ["AKARYAKIT", "SHELL", "OPET", "PETROL OFISI", " PO ", "BP ", "TOTAL", "AYTEMIZ"]], ["Otopark / HGS", ["HGS", "OGS", "OTOPARK", "ISPARK"]], ["Toplu taşıma", ["ISTANBULKART", "METRO", "MARMARAY"]], ["Araç bakım", ["LASTIK", "OTO SERVIS"]],
  ["Restoran / Kafe", ["YEMEKSEPETI", "TRENDYOL YEMEK", "RESTORAN", "LOKANTA", "CAFE", "KAFE", "STARBUCKS", "KAHVE", "BURGER", "PIZZA", "DONER"]], ["Market", ["MIGROS", "A101", "BIM ", "SOK ", "CARREFOUR", "MACROCENTER", "FILE ", "METRO ", "HAKMAR", "GETIR"]],
  ["SGK", ["SGK", "BAG-KUR", "BAGKUR"]], ["Vergi", ["VERGI", "GIB ", "GELIR IDARESI", "KDV", "MTV", "STOPAJ"]], ["Kart aidatı", ["KART AIDATI"]], ["EFT / havale", ["EFT UCRETI", "HAVALE UCRETI"]]
];
export function guessSub(desc) { const d = " " + norm(desc) + " "; for (const [s, keys] of SUBRULES) if (keys.some(x => d.includes(x))) return s; return ""; }
export function headerSignature(headers) { return headers.map(norm).filter(Boolean).join("|").slice(0, 300); }
export const _dbg = { pdfLines: (...a) => pdfLines(...a), linesToTable: (...a) => linesToTable(...a), linesToRegexRows: (...a) => linesToRegexRows(...a) };
