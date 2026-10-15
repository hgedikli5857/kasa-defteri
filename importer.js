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
  let prevLine = null, prevIsTx = false, contN = 0, pre = [];
  const body = rows.slice(hIdx + 1);
  const isTx = r => parseDate(r[m.date]) != null && r.some((v, i) => i !== m.desc && v && /\d,\d{2}\b|\d\.\d{2}\b/.test(v) && parseAmount(v) != null);
  body.forEach((r, k) => {
    const L = meta[k], prev = out[out.length - 1];
    const hasDate = parseDate(r[m.date]) != null;
    const hasAmt = r.some((v, i) => i !== m.desc && v && /\d,\d{2}\b|\d\.\d{2}\b/.test(v) && parseAmount(v) != null);
    const txt = r.filter(Boolean).join(" "), N = norm(txt);
    if (!hasDate && !hasAmt && /TARIH/.test(N) && /TUTAR|BAKIYE|ACIKLAMA/.test(N)) { pre = []; prevIsTx = false; prevLine = L; return; } // sayfa başı tekrar eden başlık
    if (!hasDate && !hasAmt && m.desc >= 0 && txt) {
      // açıklama satırı: hareket satırının üstünde mi (ör. Kuveyt Türk: uzun açıklama tarih satırının üstüne taşar) altında mı?
      const nx = body[k + 1], NL = meta[k + 1];
      const dPrev = prevLine && L.page === prevLine.page ? prevLine.y - L.y : Infinity;
      const dNext = nx && NL && NL.page === L.page && isTx(nx) ? L.y - NL.y : Infinity;
      if (dNext < Math.max(L.h, NL ? NL.h : 0) * 2.4 && dNext < dPrev) { pre.push(txt); prevLine = L; return; }
      if (prevIsTx && dPrev < Math.max(L.h, prevLine.h) * 2.4 && contN < 3) { prev[m.desc] = (prev[m.desc] + " " + txt).trim(); contN++; prevLine = L; return; }
    }
    if (hasDate && hasAmt && pre.length) { r[m.desc] = (pre.join(" ") + " " + (r[m.desc] || "")).trim(); }
    pre = [];
    out.push(r); prevIsTx = hasDate && hasAmt; contN = 0;
    prevLine = L;
  });
  return out;
}
// Başlık bulunamazsa: "tarih ... açıklama ... tutar [bakiye]" satırlarını yakala
const MONEY = /[-+]?\(?\d{1,3}(?:\.\d{3})*,\d{2,4}\)?(?:\s*(?:TL|TRY|B|A|\+|-))?|[-+]?\d+,\d{2,4}(?:\s*(?:TL|TRY))?/g;
function linesToRegexRows(lines) {
  const rows = [["Tarih", "Açıklama", "Tutar", "Bakiye"]];
  let lastL = null, pre = [];
  const DRX = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\s+(.*)$/, txt = l => l.cells.map(c => c.s).join("  ");
  lines.forEach((l, i) => {
    const t = txt(l);
    const dm = t.match(DRX);
    if (!dm) {
      const N = norm(t);
      if (!t || (t.match(MONEY) || []).length || t.length >= 160 || (/TARIH/.test(N) && /TUTAR|BAKIYE|ACIKLAMA/.test(N))) { lastL = null; pre = []; return; }
      // satır bir sonraki hareketin üstüne mi taşmış (Kuveyt Türk) yoksa öncekinin devamı mı?
      const nx = lines[i + 1], dNext = nx && nx.page === l.page && DRX.test(txt(nx)) ? l.y - nx.y : Infinity;
      const dPrev = lastL && l.page === lastL.page ? lastL.y - l.y : Infinity, lim = h => Math.max(l.h, h) * 2.4;
      if (dNext < dPrev && dNext < lim(nx.h)) { pre.push(t); return; }
      if (rows.length > 1 && lastL && dPrev < lim(lastL.h) && t.length < 120) rows[rows.length - 1][1] = (rows[rows.length - 1][1] + " " + t).trim();
      lastL = null; return;
    }
    lastL = l;
    const rest = dm[2]; const ms = [...rest.matchAll(MONEY)];
    if (!ms.length) { pre = []; return; }
    const tailStart = ms.length >= 2 && rest.slice(ms[ms.length - 2].index + ms[ms.length - 2][0].length, ms[ms.length - 1].index).trim() === "" ? ms.length - 2 : ms.length - 1;
    const amt = ms[tailStart][0], bal = tailStart < ms.length - 1 ? ms[ms.length - 1][0] : "";
    const desc = (pre.join(" ") + " " + rest.slice(0, ms[tailStart].index)).replace(/\s+/g, " ").trim(); pre = [];
    rows.push([dm[1], desc, amt, bal]);
  });
  return rows.length > 1 ? rows : null;
}
/* ---------- görsel (ekran görüntüsü / fotoğraf) → OCR ---------- */
const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js";
const TESS_LANG = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/tur@1.0.0/4.0.0_best_int";
let tessPromise = null, tessWorker = null;
function loadTess() {
  if (!tessPromise) tessPromise = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = TESS;
    s.onload = () => res(window.Tesseract); s.onerror = () => { tessPromise = null; rej(new Error("Görsel okuyucu yüklenemedi. İnternet bağlantını kontrol et.")); };
    document.head.appendChild(s);
  });
  return tessPromise;
}
export const isImage = (file, head) => /^image\//.test(file.type || "") || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name || "") ||
  (head && ((head[0] === 0x89 && head[1] === 0x50) || (head[0] === 0xff && head[1] === 0xd8)));
// Görseli OCR'a hazırla: büyüt (~2000 px genişlik), gri tona çevir, kontrastı aç, karanlık temayı ters çevir.
// Renkli kopya da saklanır: tutarın rengi (kırmızı/yeşil) işaretini belirlemekte kullanılır.
async function prepImage(file, heavy) {
  if (!heavy) return prepLight(file);
  try {
    const bmp = await createImageBitmap(file), th = textHeight(bmp), k = th ? Math.min(3, Math.max(0.6, 40 / th)) : Math.min(3, 2000 / bmp.width); // yazı ~40 px; ölçülemezse 2000 px genişlik
    const ang = skewAngle(bmp); // eğik çekilmiş fotoğrafı düzelt
    const c = document.createElement("canvas"), W = c.width = Math.round(bmp.width * k), H = c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high";
    if (Math.abs(ang) >= 0.4) { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.translate(W / 2, H / 2); g.rotate(ang * Math.PI / 180); g.translate(-W / 2, -H / 2); }
    g.drawImage(bmp, 0, 0, W, H); g.setTransform(1, 0, 0, 1, 0, 0);
    const im = g.getImageData(0, 0, W, H), d = im.data, color = new Uint8ClampedArray(d), Y = new Float32Array(W * H);
    for (let p = 0, i = 0; p < Y.length; p++, i += 4) Y[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // karanlık tema mı? (kenarlardaki monitör çerçevesi yanıltmasın diye ortadaki bölgenin ortancası)
    const cen = []; for (let y = H * 0.2 | 0; y < H * 0.8; y += 7) for (let x = W * 0.2 | 0; x < W * 0.8; x += 7) cen.push(Y[y * W + x]);
    cen.sort((a, b) => a - b); const dark = cen[cen.length >> 1] < 110;
    if (dark) for (let p = 0; p < Y.length; p++) Y[p] = 255 - Y[p];
    // ışık düzeltme (ekran/kâğıt fotoğrafında parlama, gölge, kenar kararması): arka plan = bloklardaki en açık ton, metin ona bölünür
    const B = Math.max(16, Math.round(Math.min(W, H) / 40)), bw = Math.ceil(W / B), bh = Math.ceil(H / B), bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const vals = []; for (let y = by * B; y < Math.min(H, by * B + B); y += 2) for (let x = bx * B; x < Math.min(W, bx * B + B); x += 2) vals.push(Y[y * W + x]);
      vals.sort((a, b) => a - b); bg[by * bw + bx] = vals[Math.floor(vals.length * 0.9)] || 255;
    }
    const bg2 = new Float32Array(bg.length); // komşu bloklarla yumuşat
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.min(bh - 1, Math.max(0, by + dy)), xx = Math.min(bw - 1, Math.max(0, bx + dx)); m = Math.max(m, bg[yy * bw + xx]); } bg2[by * bw + bx] = m; }
    const bgAt = (x, y) => { const fx = Math.min(bw - 1.001, Math.max(0, x / B - 0.5)), fy = Math.min(bh - 1.001, Math.max(0, y / B - 0.5)), x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
      const v = (xx, yy) => bg2[Math.min(bh - 1, yy) * bw + Math.min(bw - 1, xx)]; return (v(x0, y0) * (1 - ax) + v(x0 + 1, y0) * ax) * (1 - ay) + (v(x0, y0 + 1) * (1 - ax) + v(x0 + 1, y0 + 1) * ax) * ay; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, b0 = bgAt(x, y), b = Math.max(40, b0); let v = b0 < 70 ? 255 : Y[p] / b * 255; v = v > 255 ? 255 : v; const i = p * 4; d[i] = d[i + 1] = d[i + 2] = v; }
    // kontrast: en koyu %1 → siyah
    const hist = new Uint32Array(256); for (let i = 0; i < d.length; i += 4) hist[d[i] | 0]++;
    let acc = 0, lo = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < Y.length * 0.01) lo = v; }
    const sc = 255 / Math.max(60, 250 - lo);
    // gri (soluk) yazıları koyulaştır: tarih/saat satırları genelde açık gri
    for (let i = 0; i < d.length; i += 4) { let v = (d[i] - lo) * sc; v = v < 0 ? 0 : v > 255 ? 255 : v; v = 255 * Math.pow(v / 255, 1.8); d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(im, 0, 0);
    return { img: c, color, w: W, h: H, dark };
  } catch (e) { return { img: file, color: null }; }
}
// Hafif hazırlık (ekran görüntüleri için en iyisi): büyüt, gri ton, kontrast, karanlık temayı çevir
async function prepLight(file) {
  try {
    const bmp = await createImageBitmap(file), th = textHeight(bmp), k = (typeof window !== "undefined" && window.__K) ? (window.__K > 5 ? window.__K / bmp.width : window.__K) : th ? Math.min(3, Math.max(1, 40 / th)) : Math.min(3, Math.max(1, 2000 / bmp.width)); // yazı ~40 px olacak şekilde büyüt
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, c.width, c.height);
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data, color = new Uint8ClampedArray(d), hist = new Uint32Array(256), n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = y; hist[y]++; }
    let acc = 0, lo = 0, hi = 255, mean = 0; for (let v = 0; v < 256; v++) mean += v * hist[v]; mean /= n;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc < n * 0.01) lo = v; if (acc < n * 0.99) hi = v; }
    if (hi - lo < 40) { lo = 0; hi = 255; }
    const dark = mean < 110, sc = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { let v = (d[i] - lo) * sc; v = v < 0 ? 0 : v > 255 ? 255 : v; if (dark) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(im, 0, 0);
    return { img: c, color, w: c.width, h: c.height, dark };
  } catch (e) { return { img: file, color: null }; }
}
// Tipik yazı yüksekliği (px): satır satır "mürekkep" sayısı, ardışık dolu satır gruplarının ortanca uzunluğu
function textHeight(bmp) {
  try {
    const sc = Math.min(1, 1600 / bmp.width), w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc), c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, row = new Uint32Array(h);
    for (let y = 0; y < h; y++) for (let x = 2; x < w - 2; x += 1) { const i = (y * w + x) * 4, j = i - 8, k2 = i + 8; const v = d[i] + d[i + 1] + d[i + 2], a = d[j] + d[j + 1] + d[j + 2], b = d[k2] + d[k2 + 1] + d[k2 + 2]; if (Math.abs(v - a) > 120 || Math.abs(v - b) > 120) row[y]++; }
    const runs = []; let r = 0; for (let y = 0; y < h; y++) { if (row[y] >= 3) r++; else { if (r >= 4) runs.push(r); r = 0; } }
    if (runs.length < 5) return 0; runs.sort((a, b) => a - b);
    return runs[Math.floor(runs.length * 0.25)] / sc; // alt çeyrek: bitişik satırlar birleşip büyük görünmesin
  } catch (e) { return 0; }
}
// Eğiklik açısı (derece): küçük gri kopyada koyu pikselleri farklı açılarla satırlara izdüşürüp en keskin satır yapısını veren açı
function skewAngle(bmp) {
  try {
    const w = 500, h = Math.round(bmp.height * w / bmp.width), c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, Y = new Float32Array(w * h); for (let p = 0, i = 0; p < Y.length; p++, i += 4) Y[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // yerel arka plandan belirgin farklı pikseller = yazı (açık ve koyu temada çalışır)
    const pts = [], R = 6;
    for (let y = R; y < h - R; y += 1) for (let x = R; x < w - R; x += 1) { const v = Y[y * w + x], m = (Y[(y - R) * w + x] + Y[(y + R) * w + x] + Y[y * w + x - R] + Y[y * w + x + R]) / 4; if (Math.abs(v - m) > 45) pts.push(x - w / 2, y - h / 2); }
    if (pts.length < 200) return 0;
    let best = 0, bestS = -1;
    for (let a = -8; a <= 8.001; a += 0.25) {
      const t = a * Math.PI / 180, sn = Math.sin(t), cs = Math.cos(t), bins = new Float32Array(h * 2);
      for (let i = 0; i < pts.length; i += 2) { const r = Math.round(pts[i] * sn + pts[i + 1] * cs + h); if (r >= 0 && r < bins.length) bins[r]++; }
      let sc = 0; for (let i = 1; i < bins.length; i++) { const df = bins[i] - bins[i - 1]; sc += df * df; }
      if (sc > bestS) { bestS = sc; best = a; }
    }
    return best;
  } catch (e) { return 0; }
}
// Bir kelimenin yazı rengi: arka plandan farklı piksellerin ortalaması → "r" (kırmızı), "g" (yeşil) ya da ""
function wordColor(P, b) {
  if (!P || !P.color) return "";
  const { color, w } = P; let r = 0, gg = 0, bl = 0, cnt = 0;
  const x0 = Math.max(0, b.x0 | 0), x1 = Math.min(w - 1, b.x1 | 0), y0 = Math.max(0, b.y0 | 0), y1 = Math.min(P.h - 1, b.y1 | 0);
  const bgI = (y0 * w + x0) * 4, br = color[bgI], bgg = color[bgI + 1], bb = color[bgI + 2];
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
    const i = (y * w + x) * 4, dr = color[i] - br, dg = color[i + 1] - bgg, db = color[i + 2] - bb;
    if (dr * dr + dg * dg + db * db < 60 * 60) continue; r += color[i]; gg += color[i + 1]; bl += color[i + 2]; cnt++;
  }
  if (cnt < 6) return ""; r /= cnt; gg /= cnt; bl /= cnt;
  if (r > gg + 45 && r > bl + 35) return "r";
  if (gg > r + 30 && gg > bl + 5) return "g";
  return "";
}
// OCR'ın rakamlarda yaptığı tipik hatalar: O→0, l/I/|→1, S→5; "1.250.00" / "1,250,00" → "1.250,00"
export function fixOcrNum(t) {
  t = String(t || "");
  for (let k = 0; k < 4; k++) { const u = t.replace(/(?<=\d)[Oo](?=[\d.,Oo])|(?<=[\d.,])[Oo](?=[\dOo]|$|\s)/g, "0").replace(/(?<=\d)[Il|](?=[\d.,])|(?<=[\d.,])[Il|](?=\d)|(?<![A-Za-zÇĞİÖŞÜçğıöşü\d])[Il|](?=[.,]\d{3})/g, "1").replace(/(?<=\d)S(?=\d)/g, "5"); if (u === t) break; t = u; }
  t = t
    .replace(/(\d),\s(\d{2})(?!\d)/g, "$1,$2").replace(/(^|[\s+\-−–(])[HhtbŁ£€¥](?=\d{1,3}(?:[.,]\d{3})*[.,]\d{2}(?!\d))/g, "$1₺").replace(/[–—]\s?(?=₺?\s?\d)/g, "-");
  return t.replace(/(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+)[.,](\d{2})(?![\d.,])/g, (m, a, b) => a.replace(/[.,]/g, ".") + "," + b)
    .replace(/(?<![\d.,])(\d+)\.(\d{2})(?=\s?(?:TL|TRY|₺)\b)/g, "$1,$2");
}
export async function imageLines(file, onProgress, page = 1, heavy = false) {
  const T = await loadTess();
  if (!tessWorker) tessWorker = await T.createWorker("tur", 1, { langPath: TESS_LANG, logger: m => { if (onProgress && m.status === "recognizing text") onProgress(m.progress); } });
  try { await tessWorker.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: "300" }); } catch (e) { }
  const P = await prepImage(file, heavy);
  const { data } = await tessWorker.recognize(P.img, {}, { blocks: true, text: true });
  const lines = [], words = [];
  for (const b of data.blocks || []) for (const pa of b.paragraphs || []) for (const ln of pa.lines || []) {
    // tutar gibi görünen kelimeler düşük güvenle okunsa da tutulur (₺ işareti OCR'ı şaşırtıyor)
    const ws = (ln.words || []).filter(w => w.text && w.text.trim() && (w.confidence > 20 || /\d[.,]\d{2}/.test(w.text))).sort((a, b) => a.bbox.x0 - b.bbox.x0);
    if (!ws.length) continue;
    const h = Math.max(...ws.map(w => w.bbox.y1 - w.bbox.y0)) || 10, cells = [];
    for (const w of ws) {
      let tx = fixOcrNum(w.text);
      // işaretsiz tutar: kırmızı yazılmışsa çıkan (−), yeşilse giren (+) para
      if (/\d[.,]\d{2}(?!\d)/.test(tx) && !/^[-+−(]/.test(tx.trim())) { const col = wordColor(P, w.bbox); if (col) tx = (col === "r" ? "-" : "+") + tx.replace(/^\s+/, ""); }
      words.push({ t: tx, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, c: w.confidence });
      const c = cells[cells.length - 1]; if (c && w.bbox.x0 - c.x1 < h * 1.2) { c.s += " " + tx; c.x1 = w.bbox.x1; } else cells.push({ s: tx, x0: w.bbox.x0, x1: w.bbox.x1 });
    }
    // aynı hücrede ayrı okunmuş tutar parçaları: "- 1.250,00" / "1.250, 00"
    cells.forEach(c => { c.s = fixOcrNum(c.s.replace(/([-+−])\s+(?=₺?\s?\d)/g, "$1")); });
    lines.push({ page, y: -ln.bbox.y0, h, cells });
  }
  lines.sort((a, b) => b.y - a.y);
  return { lines, words, text: fixOcrNum(data.text || "") };
}
// Gevşek tarih: "10 Haziran 2026", "10 Haz", "10.06.2026 14:32", "Bugün", "Dün"
const AYK = { OCA: 1, SUB: 2, MAR: 3, NIS: 4, MAY: 5, HAZ: 6, TEM: 7, AGU: 8, EYL: 9, EKI: 10, KAS: 11, ARA: 12 };
export function findDate(t, today = new Date()) {
  const T = norm(t), iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  let m = T.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${y}-${p2(m[2])}-${p2(m[1])}`; }
  m = T.match(/\b(\d{1,2})\s+(OCA|SUB|MAR|NIS|MAY|HAZ|TEM|AGU|EYL|EKI|KAS|ARA)[A-Z]*\.?(?:\s+(\d{4}))?/);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    let y = m[3] ? +m[3] : today.getFullYear(); const mo = AYK[m[2]];
    if (!m[3] && new Date(y, mo - 1, +m[1]) > today) y--;
    return `${y}-${p2(mo)}-${p2(m[1])}`;
  }
  if (/\bBUGUN\b/.test(T)) return iso(today);
  if (/\bDUN\b/.test(T)) { const d = new Date(today); d.setDate(d.getDate() - 1); return iso(d); }
  return null;
}
const AMT_RX = /[-+−–]?\s?(?:₺\s?)?\d{1,3}(?:[.\s]\d{3})*,\d{2}(?:\s?(?:TL|TRY|₺))?/g;
// Mobil uygulama listeleri: her harekette açıklama + tutar aynı satırda, tarih aynı / alt / üst satırda ya da gün başlığında
function linesToAppRows(lines) {
  const rows = [["Tarih", "Açıklama", "Tutar"]], txt = lines.map(l => l.cells.map(c => c.s).join(" ").replace(/\s+/g, " ").trim());
  const hasAmt = t => (t.match(AMT_RX) || []).length > 0;
  let cur = null;
  txt.forEach((t, i) => {
    const am = [...t.matchAll(AMT_RX)].filter(x => t[x.index - 1] !== "/" && !/^[-+−]?\s?0,00/.test(x[0].trim())).map(x => x[0]);
    if (!am.length) { const d = findDate(t); if (d && t.replace(/[\d.:/\-\s]/g, "").length < 25) cur = d; return; }
    const raw = am[am.length - 1], amount = raw.replace(/−/g, "-").replace(/\s(?=\d{3})/g, ".").replace(/[₺\s]|TL|TRY/g, "");
    let desc = t.replace(raw, "").replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/g, " ")
      .replace(/\b\d{1,2}\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)[a-zçğıöşü]*\.?(\s+\d{4})?\b/gi, " ")
      .replace(/^[\s—–\-|:]+|[\s—–\-|:]+$/g, "").replace(/\s+/g, " ").trim();
    const prev = txt[i - 1] || "", next = txt[i + 1] || "";
    let date = findDate(t) || (!hasAmt(next) && findDate(next)) || (!hasAmt(prev) && findDate(prev) && prev.replace(/[\d.:/\-\s]/g, "").length < 25 ? findDate(prev) : null) || cur;
    desc = desc.replace(/(\s+[^A-Za-zÇĞİÖŞÜçğıöşü\s]{1,3})+$/, "").trim();
    if (findDate(desc) && desc.replace(/[\d.:/\-\s]/g, "").length < 12) desc = "";
    if (desc.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "").length < 3 && prev && !hasAmt(prev) && !findDate(prev)) desc = prev;
    if (!date || /BAKIYE|LIMIT|TOPLAM|BORC|PUAN|ASGARI|ORANI|KESIM|SON ODEME TARIHI/.test(norm(desc))) return;
    rows.push([date, desc, amount]);
  });
  // bazı tutarlar açıkça "+" (gelen) ise işaretsiz olanlar çıkan paradır (uygulamalar gideri çoğu zaman işaretsiz gösterir)
  const sg = rows.slice(1).map(r => /^[+]/.test(r[2]) ? 1 : /^[-−]/.test(r[2]) ? -1 : 0);
  if (sg.includes(1) && !sg.includes(-1) && sg.includes(0)) rows.forEach((r, k) => { if (k && sg[k - 1] === 0) r[2] = "-" + r[2]; });
  return rows.length > 1 ? rows : null;
}
// Konumlu okuma: her hareketin tarihi sol sütunda (aynı hizada) durur; o tarihten bir sonrakine kadarki bölgede
// sağdaki tutar o harekete, tarihin altındaki yazı açıklamaya aittir. Soldaki menü ve üstteki tarayıcı yazıları dışarıda kalır.
const DATE_W = /^\(?(\d{2})[./-]?(\d{2})[./-]?(20\d{2})\b/;
const AMT_W = /([-+−]?)\s?₺?\s?(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,6},\d{2})(?!\d)/;
function wordsToAnchorRows(words, today = new Date()) {
  if (!words || words.length < 6) return null;
  const yc = w => (w.y0 + w.y1) / 2, hh = w => w.y1 - w.y0;
  let ds = words.map(w => { const m = w.t.replace(/\s/g, "").match(DATE_W); if (!m) return null; const mo = +m[2], da = +m[1]; if (mo < 1 || mo > 12 || da < 1 || da > 31) return null; return { w, d: [+m[3], mo, da] }; }).filter(Boolean);
  if (ds.length < 3) return null;
  // aynı sütunda hizalı tarihler (açıklamanın içindeki tarihleri ele)
  const xs = ds.map(x => x.w.x0).sort((a, b) => a - b), mx = xs[xs.length >> 1], h = ds.map(x => hh(x.w)).sort((a, b) => a - b)[ds.length >> 1] || 12;
  ds = ds.filter(x => Math.abs(x.w.x0 - mx) < h * 5).sort((a, b) => yc(a.w) - yc(b.w));
  ds = ds.filter((x, i) => i === 0 || yc(x.w) - yc(ds[i - 1].w) > h * 1.2);
  if (ds.length < 3) return null;
  const pad = n => String(n).padStart(2, "0"), iso = ([y, m, d]) => `${y}-${pad(m)}-${pad(d)}`, ty = today.getFullYear();
  // yanlış okunan yıl/gün: liste sıralı, komşularla uyuşmayanı komşuya eşitle
  ds.forEach(x => { if (Math.abs(x.d[0] - ty) > 1) x.d[0] = ty; x.s = iso(x.d); });
  ds.forEach((x, i) => { const p = ds[i - 1], n = ds[i + 1]; if (p && n && p.s === n.s && x.s !== p.s) x.s = p.s; else if (p && n) { const lo = p.s < n.s ? p.s : n.s, hi = p.s < n.s ? n.s : p.s; if (x.s < lo || x.s > hi) x.s = p.s; } });
  const colX = Math.min(...ds.map(x => x.w.x0)) - h * 2.5;
  // "TL" bazen "7L" okunur (3.190,207L), virgül bazen "4" (296448TL → 296,48)
  const amtOf = w => { let t = w.t.replace(/\s+(?=[\d,.])/g, "").replace(/(,\d{2})[7T][Ll1I|]$/, "$1TL");
    let m = t.match(AMT_W);
    if (!m) { const g = t.match(/^([-+−]?)\D{0,2}(\d[\d.]{3,11})(?:TL|7L|11)$/); if (g) {
      // virgül ya düşmüş (2.70944 → 2.709,44) ya da rakam sanılmış (296448 → 296,48): binlik nokta varsa düşmüş, yoksa tam kısım 3 haneyi geçemez
      const raw = g[2], d = raw.replace(/\./g, ""), dropped = /\./.test(raw) || d.length - 2 <= 3, ip = dropped ? d.slice(0, -2) : d.slice(0, -3);
      m = [null, g[1], ip.replace(/\B(?=(\d{3})+$)/g, ".") + "," + d.slice(-2)]; m.index = 0; } }
    if (!m) return null; const pre = m.index != null ? t.slice(0, m.index) : ""; const sg = (pre.match(/[-+−]/) || [m[1] || ""])[0].replace("−", "-");
    return { w, sign: sg, v: m[2] }; };
  const amts = words.filter(w => w.x0 > colX).map(amtOf).filter(Boolean);
  const rightX = amts.length ? amts.map(a => a.w.x1).sort((a, b) => a - b)[amts.length >> 1] : Infinity;
  const rows = [["Tarih", "Açıklama", "Tutar"]];
  ds.forEach((x, i) => {
    // bölge: komşu tarihlerle aranın yarısı (açıklama tarihin üstünde ya da altında olabilir)
    const gaps = ds.slice(1).map((z, j) => yc(z.w) - yc(ds[j].w)).sort((p, q) => p - q), gap = gaps[gaps.length >> 1] || h * 6;
    const top = i > 0 ? (yc(ds[i - 1].w) + yc(x.w)) / 2 : yc(x.w) - gap / 2, bot = i + 1 < ds.length ? (yc(x.w) + yc(ds[i + 1].w)) / 2 : yc(x.w) + gap / 2;
    const inR = w => yc(w) >= top && yc(w) < bot;
    const cand = amts.filter(a => inR(a.w) && Math.abs(a.w.x1 - rightX) < h * 8).sort((a, b) => b.w.x1 - a.w.x1);
    if (!cand.length) return;
    const a = cand[0], ax0 = Math.min(...cand.map(c => c.w.x0));
    const dl = words.filter(w => inR(w) && w !== x.w && w.x0 >= colX && w.x1 < ax0 - h * 0.5 && !cand.some(c => c.w === w));
    let below = dl.filter(w => Math.abs(yc(w) - yc(x.w)) > h * 0.6), same = dl.filter(w => Math.abs(yc(w) - yc(x.w)) <= h * 0.6);
    const txt = ws => ws.sort((p, q) => Math.abs(yc(p) - yc(q)) > h * 0.6 ? yc(p) - yc(q) : p.x0 - q.x0).map(w => w.t).join(" ");
    let desc = txt(below.length ? below : same).replace(/^[-–—]?\s*\d{1,2}[:.]\d{2}\b/, "");
    // ikon/çöp karakterleri at
    const tk = desc.split(/\s+/).filter(t => /[A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,}|^[*/&-]$/.test(t));
    while (tk.length > 1 && tk[0].length <= 2 && !/^[A-ZÇĞİÖŞÜ0-9]+$/.test(tk[0])) tk.shift(); // ikondan gelen "le", "Kö"
    desc = tk.join(" ").replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü0-9*]+/, "").replace(/\s+/g, " ").trim();
    rows.push([x.s, desc, (a.sign || "") + a.v]);
  });
  while (rows.length > 4 && !rows[rows.length - 1][1]) rows.pop(); // en alttaki yarım (kesilmiş) hareket
  if (rows.length < 4) return null;
  rows.anchors = ds.length; // bulunan tarih sayısı: tutarı okunamayan hareket var mı anlamak için
  const sg = rows.slice(1).map(r => /^\+/.test(r[2]) ? 1 : /^-/.test(r[2]) ? -1 : 0);
  if (sg.includes(1) && sg.includes(0) && sg.filter(v => v === 1).length < sg.length / 2) rows.forEach((r, k) => { if (k && sg[k - 1] === 0) r[2] = "-" + r[2]; });
  return rows;
}
// İki okumanın (hafif + güçlü) hareket listelerini sırayı koruyarak birleştir: aynı tarih+tutar bir kez, birinde eksik olan diğerinden eklenir
function mergeRows(A, B) {
  // asıl liste: daha çok hareket bulan okuma; diğerinden sadece asılda karşılığı olmayan hareketler eklenir
  if ((B.length || 0) > (A.length || 0)) [A, B] = [B, A];
  const a = A.slice(1), b = B.slice(1), n = a.length, m = b.length;
  const w1 = r => (norm(String(r[1] || "")).replace(/II/g, "I").match(/[A-Z0-9]{2,}/) || [""])[0], key = r => r[0] + "|" + w1(r);
  const S = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) S[i][j] = key(a[i]) === key(b[j]) ? S[i + 1][j + 1] + 1 : Math.max(S[i + 1][j], S[i][j + 1]);
  const out = [A[0]]; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && key(a[i]) === key(b[j])) { out.push(a[i]); i++; j++; }
    else if (j >= m || (i < n && S[i + 1][j] >= S[i][j + 1])) { out.push(a[i]); i++; }
    else { if (w1(b[j])) out.push(b[j]); j++; }
  }
  out.anchors = Math.max(A.anchors || 0, B.anchors || 0);
  return out;
}
// "₺" işareti her tutarda aynı rakam sanılmışsa (₺249,89 → 4249,89): tutarların çoğu aynı rakamla başlıyor ve
// en az biri binlik ayırıcısız 4+ haneli (biçim bozuk) ise o baştaki rakamı at
function fixCurrencyGlyph(rows) {
  if (!rows || rows.length < 5) return rows;
  const body = rows.slice(1), num = r => String(r[2]).replace(/^[-+−]/, ""), ok = t => /^(\d{1,3}(\.\d{3})*|\d{1,3}),\d{2}$/.test(t);
  const cnt = {}; body.forEach(r => { const d = num(r)[0]; if (/\d/.test(d)) cnt[d] = (cnt[d] || 0) + 1; });
  const [d, n] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [];
  if (!d || n < 3 || n < body.length * 0.35) return rows;
  const bad = body.filter(r => num(r)[0] === d && /^\d{4,},/.test(num(r)));
  if (!bad.length) return rows;
  const strong = bad.length >= 2; // birden çok bozuk tutar varsa aynı rakamla başlayan geçerli görünenler de (41.045,80 → 1.045,80) düzeltilir
  body.forEach(r => { const t = num(r); if (t[0] === d && ok(t.slice(1)) && (strong || !ok(t) || /^\d{4,},/.test(t))) r[2] = String(r[2]).replace(t, t.slice(1)); });
  return rows;
}
export async function imagesToRows(files, onProgress) {
  let all = [], meta = null;
  for (let i = 0; i < files.length; i++) {
    const rowsOf = (lines, words) => { const an = wordsToAnchorRows(words || []); let rows = null; const table = lines.length ? linesToTable(lines) : null;
      if (table) { const h = detectHeader(table), m = guessMapping(table[h], table.slice(h + 1)); const ex = extract(table, h, m); if (ex.length) rows = [["Tarih", "Açıklama", "Tutar"], ...ex.map(x => [x.date, x.desc, (+x.amount).toFixed(2).replace(".", ",")])]; }
      if (!rows) rows = linesToAppRows(lines);
      if (!rows) { const rx = linesToRegexRows(lines); if (rx) rows = rx.map(r => r.slice(0, 3)); }
      // tarihe göre konumlu okuma (tarih üstte, açıklama altta, tutar sağda ortada) daha çok hareket bulduysa onu kullan
      if (an && an.length - 1 >= 3 && an.length >= (rows ? rows.length : 0) * 0.7) { const A = an.anchors; rows = fixCurrencyGlyph(an); rows.anchors = A; return rows; }
      return fixCurrencyGlyph(rows); };
    const prog = (k, n) => p => onProgress && onProgress((i + (k + p) / n) / files.length);
    let { lines, words, text } = await imageLines(files[i], prog(0, 1), i + 1, false);
    let rows = rowsOf(lines, words);
    // az satır çıktıysa (fotoğraf: eğik, parlama, gölge) güçlü ön işlemeyle tekrar oku, iyi olanı al
    const amtLines = lines.filter(l => /\d[.,]\d{2}(?!\d)/.test(l.cells.map(c => c.s).join(" "))).length, got = rows ? rows.length - 1 : 0;
    if (got < 3 || got < amtLines * 0.6 || (rows && rows.anchors && got < rows.anchors)) {
      const r2 = await imageLines(files[i], prog(0.5, 1), i + 1, true), rows2 = rowsOf(r2.lines, r2.words);
      if (rows && rows.anchors && rows2 && rows2.anchors) { rows = mergeRows(rows, rows2); }
      else if (rows2 && rows2.length - 1 > got) {
        // güçlü okumada "₺" bazen rakam sanılır (₺67,25 → 167,25): hafif okumadaki tutarla başı fazla rakam farkı varsa onu al
        const dig = v => String(v).replace(/[^\d]/g, ""), light = new Set(lines.flatMap(l => (l.cells.map(c => c.s).join(" ").match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || []).map(dig)));
        rows2.slice(1).forEach(r => { const d0 = dig(r[2]); if (d0.length > 3 && !light.has(d0) && light.has(d0.slice(1))) { const t = d0.slice(1); r[2] = (/^\s*[-−]/.test(r[2]) ? "-" : /^\s*\+/.test(r[2]) ? "+" : "") + t.slice(0, -2) + "," + t.slice(-2); } });
        rows = rows2; text = r2.text;
      }
    }
    meta = meta || statementMeta(text);
    if (rows) all = all.length ? all.concat(rows.slice(1)) : rows;
  }
  if (!all.length) throw new Error("Görselde hesap hareketi okunamadı. Ekran görüntüsü net ve tarih + tutar görünür olmalı.");
  if (meta) all.meta = meta;
  return all;
}

// Kart ekstresi özet bilgileri: kart limiti, hesap kesim günü, dönem borcu
export function statementMeta(text) {
  const T = norm(text), num = re => { const m = T.match(re); return m ? parseAmount(m[1]) : null; };
  const meta = { limit: num(/KART LIMITI\s*(?:\(TL\))?\s*:?\s*([\d.,]+)/), debt: num(/(?:DONEM|TOPLAM) BORCU?\s*(?:\(TL\))?\s*:?\s*([\d.,]+)/) };
  const c = T.match(/(?<!SONRAKI )HESAP KESIM TARIHI\s*:?\s*(\d{1,2})[\s./-]/); if (c && +c[1] >= 1 && +c[1] <= 31) meta.cutDay = +c[1];
  meta.minPay = num(/ASGARI ODEME(?: TUTARI)?\s*(?:\(TL\))?\s*:?\s*([\d.,]+)/);
  const DT = "(\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}|\\d{1,2}\\s+[A-Z]+\\s+\\d{4})";
  const dd = T.match(new RegExp("(?<!SONRAKI )SON ODEME TARIHI\\s*:?\\s*" + DT)); if (dd) meta.dueDate = parseDate(dd[1]);
  const cd = T.match(new RegExp("(?<!SONRAKI )HESAP KESIM TARIHI\\s*:?\\s*" + DT)); if (cd) meta.stmtDate = parseDate(cd[1]);
  return meta.limit || meta.cutDay || meta.debt || meta.minPay ? meta : null;
}
// Ekstrenin hangi hesaba/karta ait olduğunu gösteren kimlikler: IBAN, hesap no-ek no, kartın son 4 hanesi
export function statementIds(text, fileName) {
  const ids = new Set(), T = norm(text || "");
  for (const m of T.matchAll(/TR\s?\d{2}(?:\s?\d{4}){5}\s?\d{2}/g)) ids.add("IBAN:" + m[0].replace(/\s/g, ""));
  for (const m of T.matchAll(/HESAP[^\n]{0,30}?\b(\d{6,10})\s*[-/]\s*(\d{1,3})\b/g)) ids.add(`HESAP:${m[1]}-${m[2]}`);
  for (const m of T.matchAll(/\b\d{4}[\s*X]*\*{4,}[\s*X]*(\d{4})\b|\*{4,}\s?(\d{4})\b|\b(\d{4})\s+ILE BITEN/g)) ids.add("KART:" + (m[1] || m[2] || m[3]));
  const f = String(fileName || "").match(/MUSTERI\s*NO[_ -]?(\d{5,10}).*?EK\s*NO[_ -]?(\d{1,3})/i); if (f) ids.add(`HESAP:${f[1]}-${f[2]}`);
  return [...ids];
}
async function pdfToRows(buf, password) {
  const lines = await pdfLines(buf, password);
  const meta = statementMeta(lines.map(l => l.cells.map(c => c.s).join(" ")).join("\n"));
  const head = lines.filter(l => l.page === 1).slice(0, 40).map(l => l.cells.map(c => c.s).join(" ")).filter(t => !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|^\d{1,2}\s+[A-ZÇĞİÖŞÜa-zçğıöşü]+\s+\d{4}\b/.test(t)).join("\n");
  const ids = statementIds(head);
  const withMeta = r => { if (meta) r.meta = meta; r.ids = ids; return r; };
  const table = linesToTable(lines);
  if (table) {
    const h = detectHeader(table), m = guessMapping(table[h], table.slice(h + 1));
    if (extract(table, h, m).length) return withMeta(table);
  }
  const rx = linesToRegexRows(lines);
  if (rx) return withMeta(rx);
  throw new Error("PDF'te hesap hareketi tablosu bulunamadı. Bu bankanın PDF biçimini Claude'a gönder, okuyucuyu uyarlasın.");
}

export async function fileToRows(file, password, onProgress) {
  const name = (file.name || "").toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  if (isImage(file, head)) return imagesToRows([file], onProgress);
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
  // bir hücrede iki tutar (ör. yurt dışı harcama: "799,99 799,99" ya da "19,99 USD 799,99 TL") → sondaki (TL) tutar
  const toks = s.match(/[-+]?\d{1,3}(?:\.\d{3})*,\d{2,4}|[-+]?\d+\.\d{2}(?!\d)/g);
  if (toks && toks.length > 1 && /\d[,.]\d{2,4}\D+[-+]?\d/.test(s)) s = s.slice(s.lastIndexOf(toks[toks.length - 1]));
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
// Kendi hesapları arası para hareketi mi? (gelir/gider sayılmamalı)
export function ownMove(desc, surname) {
  const n = norm(desc || "");
  const m = n.match(/GONDEREN HESAP NO\s*:?\s*(\d+).*ALICI HESAP NO\s*:?\s*(\d+)/); if (m && m[1] === m[2]) return "kendi alt hesapların arası";
  if (/^\s*KREDI KARTI BORC\s*$|KREDI KARTI BORC ODEME|KREDI KARTI NO\s*:|\bK\.\s?KART\b|KART BORCU? ODEME/.test(n)) return "kredi kartı ödemesi";
  if (/YATIRIM HESABI(NDAN|NA)|PORTFOY NOLU/.test(n)) return "yatırım hesabı aktarımı";
  if (/KATEM BES|BES KATKI|BIREYSEL EMEKLILIK|EMEKLILIK KATKI|\bBES\b.{0,12}(KATKI|ODEME|TAHSILAT)/.test(n)) return "BES katkı payı (birikim)";
  if (/ATM.{0,25}(NAKIT YATIRMA|PARA CEKME)|(NAKIT YATIRMA|PARA CEKME).{0,25}ATM/.test(n)) return "ATM (nakit ↔ banka)";
  const sn = norm(surname || ""); if (sn.length >= 3 && n.split(/[,\-]/).filter(p => p.includes(sn)).length >= 2) return "kendi adına havale";
  return null;
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
  ["Faturalar", ["TURK NET", "TURK.NET", "BASKENT GAZ", "FAT.TAHS", "FATURA TAHS", "AVEA", "KONTOR", "ELEKTRIK", "ENERJISA", "CK ENERJI", "AYEDAS", "BEDAS", "IGDAS", "DOGALGAZ", "DOGAL GAZ", "ISKI", "ASKI", "IZSU", "SU IDARESI", "TURKCELL", "VODAFONE", "TURK TELEKOM", "TT MOBIL", "SUPERONLINE", "TURKNET", "D-SMART", "DIGITURK", "FATURA"]],
  ["Banka masrafı", ["MASRAF", "BSMV", "KKDF", "VADE FARKI", "GECIKME", "FAIZ", "KART AIDATI", "HESAP ISLETIM", "EFT UCRETI", "HAVALE UCRETI", "KOMISYON"]],
  ["Lojistik", ["KARGO", "YURTICI", "ARAS ", "MNG", "PTT", "SURAT", "HEPSIJET", "TRENDYOL EXPRESS"]],
  ["Market / Gıda", ["PIDE", "KEBAP", "KAHVALTI", "MUTFAG", "LEZZET", "USTANIN", "DONER", "PIZZA", "DONDURMA", "CEREZ", "KURUYEMIS", " SU ", "LOKANTA", "RESTORAN", "CAFE", "KAFE", "KAHVE", "GIDA", "EKMEK", "UNLU MAMUL", "SUT ", "MANDIRA", "SARKUTERI", "BAKKAL", "TEKEL", "POPEYES", "BURGER KING", "MCDONALDS", "KFC", "DOMINOS", "LITTLE CAESARS", "SUBWAY", "SBARRO", "ARBYS", "USTA DONERCI", "KOFTECI", "BALIK", "TATLI", "BAKLAVA", "MIGROS", "A101", "BIM ", "SOK MARKET", "SOK ", "CARREFOUR", "MACROCENTER", "FILE ", "METRO ", "HAKMAR", "GETIR", "YEMEKSEPETI", "TRENDYOL YEMEK", "TRENDYOL GO", "RESTORAN", "LOKANTA", "CAFE", "KAFE", "STARBUCKS", "KAHVE", "BURGER", "PIZZA", "DONER", "FIRIN", "PASTANE", "SIMIT", "KASAP", "MANAV"]],
  ["Ulaşım", ["EGO KART", "EGO ", "TCDD", "OBILET", "OTOGAR", "PETROL", "AKARYAKIT", "SHELL", "OPET", "PETROL OFISI", " PO ", "BP ", "TOTAL", "AYTEMIZ", "HGS", "OGS", "ISTANBULKART", "UBER", "BITAKSI", "TAKSI", "OTOPARK", "ISPARK", "MARTI", "THY", "PEGASUS", "AJET", "OTOBUS", "METRO TURIZM", "PAMUKKALE", "KAMIL KOC", "LASTIK", "OTO SERVIS"]],
  ["Giyim", ["LC WAIKIKI", "LCW", "DEFACTO", "KOTON", "ZARA", "H&M", "H M ", "MAVI", "COLINS", "COLIN S", "BOYNER", "FLO ", "INSTREET", "SKECHERS", "NIKE", "ADIDAS", "PUMA", "MANGO", "PULL&BEAR", "PULL AND BEAR", "BERSHKA", "STRADIVARIUS", "US POLO", "U.S. POLO", "NETWORK", "VAKKO", "BEYMEN", "DERIMOD", "PENTI", "SUWEN", "MARKS SPENCER", "LTB", "JACK JONES", "DECATHLON", "SPORTIVE", "AYAKKABI", "GIYIM", "TEKSTIL", "SOSYETE PAZARI"]],
  ["Yapı market / Ev", ["FAVORAHOME", "HOME ", "YALITIM", "KOCTAS", "BAUHAUS", "IKEA", "TEKZEN", "PRAKTIKER", "ENGLISH HOME", "MADAME COCO", "KARACA", "EVIDEA", "PASABAHCE", "YAPI MARKET", "HIRDAVAT", "BOYA", "MOBILYA", "ISTIKBAL", "BELLONA", "DOGTAS", "ENZA", "CILEK", "KELEBEK"]],
  ["Elektronik", ["MEDIAMARKT", "MEDIA MARKT", "TEKNOSA", "VATAN BILGISAYAR", "APPLE STORE", "SAMSUNG", "XIAOMI", "ARCELIK", "BEKO", "VESTEL", "BOSCH", "ITOPYA"]],
  ["Sağlık", ["ECZANE", "ECZ.", "HASTANE", "HASTANESI", "KLINIK", "POLIKLINIK", "DIS HEKIMI", "TIP MERKEZI", "LABORATUVAR", "OPTIK", "ACIBADEM", "MEDICAL PARK", "MEMORIAL", "LIV HOSPITAL"]],
  ["Kişisel bakım", ["GRATIS", "WATSONS", "ROSSMANN", "EVE SHOP", "SEPHORA", "MAC COSMETICS", "FLORMAR", "KUAFOR", "BERBER", "GUZELLIK"]],
  ["Eğlence / Abonelik", ["NETFLIX", "SPOTIFY", "YOUTUBE", "DISNEY", "EXXEN", "BLUTV", "BLU TV", "AMAZON PRIME", "PRIME VIDEO", "TABII", "GAIN", "SINEMA", "CINEMAXIMUM", "PARIBU CINEMA", "BILETIX", "PASSO", "STEAM", "PLAYSTATION", "XBOX"]],
  ["Eğitim", ["KIRTASIYE", "OLCME SECME", "OSYM", "YAYINCILIK", "YAY.LTD", "SINAV", "OKUL", "KOLEJ", "UNIVERSITE", "DERSHANE", "KURS", "UDEMY", "COURSERA", "D&R", "D R ", "KITAP", "KITABEVI", "IDEFIX"]],
  ["Pazarlama", ["FACEBK", "FACEBOOK", "META ", "GOOGLE ADS", "INSTAGRAM", "TIKTOK ADS", "LINKEDIN"]],
  ["Yazılım", ["POE.COM", "GOOGLE", "APPLE.COM", "ITUNES", "MICROSOFT", "ADOBE", "CANVA", "ANTHROPIC", "CLAUDE", "OPENAI", "CHATGPT", "GITHUB", "ZOOM", "NOTION", "DROPBOX"]],
  ["Online alışveriş", ["TRENDYOL", "HEPSIBURADA", "HEPSIBURAD", "HEPSIPAY", "AMAZON", "N11", "CICEKSEPETI", "TEMU", "ALIEXPRESS", "SHEIN", "PTTAVM", "MORHIPO", "IYZICO", "PAYTR"]],
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
  t = t.replace(/^(?!A101\b)(?=[A-Z0-9]{4,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}\s+/i, "");           // baştaki referans kodu (A00QU, 123456)
  t = t.replace(/\b(firma ad[ıi]|i[şs]yeri( ad[ıi])?|al[ıi]c[ıi]|g[öo]nderen|a[çc][ıi]klama)\s*:\s*/gi, "");
  t = t.replace(/\b(ODEAL|IYZICO|IYZ|PAYTR|PARAM|PAPARA|SIPAY|MOKA|ESNEKPOS|PAYU|STRIPE|PAYPAL)\s*(\/\/|\*|\/)\s*/gi, "");
  t = t.replace(/[,;\s]+(harcama|al[ıi]şveri[şs]|i[şs]lem|[öo]deme|provizyon|pe[şs]in|taksitli)\s*$/i, "");
  t = t.replace(/^(pos|sanal pos|internet|e-ticaret|kart)\s*[-:]?\s+(?=\S)/i, "");
  t = t.replace(/(^|\s)A(?=[A-Z0-9]{4}\b)(?=[A-Z]*\d)[A-Z0-9]{4}(?=\s|$)/g, " "); // Kuveyt Türk referans kodları (A00Q3, AS73E)
  t = t.replace(/\s*\*{2,}\d+\s*/g, " ").replace(/\s+/g, " ").replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim();
  return t || String(d ?? "").trim();
}
export const learnKey = d => norm(cleanDesc(d)).replace(/[0-9*#:/\\.,-]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
export function guessCategory(desc, amount, learned) {
  desc = cleanDesc(desc);
  const k = learnKey(desc); if (k && learned[k]) return learned[k];
  const d = " " + norm(desc).replace(/\bTAKSIT\w*/g, " ") + " "; // "TAKSİT" kelimesi TAKSİ (Ulaşım) sanılmasın
  for (const [cat, keys] of amount > 0 ? RULES_IN : RULES) if (keys.some(x => d.includes(x))) return cat;
  return amount > 0 ? "Diğer gelir" : "Diğer gider";
}
const SUBRULES = [
  ["Elektrik", ["ELEKTRIK", "ENERJISA", "CK ENERJI", "AYEDAS", "BEDAS"]], ["Doğalgaz", ["BASKENT GAZ", "IGDAS", "DOGALGAZ", "DOGAL GAZ", "BASKENTGAZ", "IZMIRGAZ"]], ["Su", ["ISKI", "ASKI", "IZSU", "SU IDARESI"]],
  ["Telefon", ["AVEA", "KONTOR", "TURKCELL", "VODAFONE", "TT MOBIL"]], ["İnternet", ["TURK.NET", "SUPERONLINE", "TURKNET", "TURK TELEKOM", "TTNET"]],
  ["Akaryakıt", ["AKARYAKIT", "SHELL", "OPET", "PETROL OFISI", " PO ", "BP ", "TOTAL", "AYTEMIZ"]], ["Otopark / HGS", ["HGS", "OGS", "OTOPARK", "ISPARK"]], ["Toplu taşıma", ["ISTANBULKART", "METRO", "MARMARAY", "EGO ", "TCDD", "OBILET", "OTOGAR"]], ["Araç bakım", ["LASTIK", "OTO SERVIS"]],
  ["Restoran / Kafe", ["PIDE", "KEBAP", "KAHVALTI", "MUTFAG", "LEZZET", "USTANIN", "DONDURMA", "LOKANTA", "YEMEKSEPETI", "TRENDYOL YEMEK", "RESTORAN", "LOKANTA", "CAFE", "KAFE", "STARBUCKS", "KAHVE", "BURGER", "PIZZA", "DONER"]], ["Market", ["MIGROS", "A101", "BIM ", "SOK ", "CARREFOUR", "MACROCENTER", "FILE ", "METRO ", "HAKMAR", "GETIR"]],
  ["SGK", ["SGK", "BAG-KUR", "BAGKUR"]], ["Vergi", ["VERGI", "GIB ", "GELIR IDARESI", "KDV", "MTV", "STOPAJ"]], ["Kart aidatı", ["KART AIDATI"]], ["EFT / havale", ["EFT UCRETI", "HAVALE UCRETI"]]
];
export function guessSub(desc) { const d = " " + norm(desc) + " "; for (const [s, keys] of SUBRULES) if (keys.some(x => d.includes(x))) return s; return ""; }
export function headerSignature(headers) { return headers.map(norm).filter(Boolean).join("|").slice(0, 300); }
export const _dbg = { fixCurrencyGlyph: (...a) => fixCurrencyGlyph(...a), mergeRows: (...a) => mergeRows(...a), textHeight: (...a) => textHeight(...a), wordsToAnchorRows: (...a) => wordsToAnchorRows(...a), skewAngle: (...a) => skewAngle(...a), prepImage: (...a) => prepImage(...a), linesToAppRows: (...a) => linesToAppRows(...a), pdfLines: (...a) => pdfLines(...a), linesToTable: (...a) => linesToTable(...a), linesToRegexRows: (...a) => linesToRegexRows(...a) };
export const normText = s => norm(s);
// Taksitli alışverişin ücret satırı: "Vade Farki - FAVORAHOME ANKARA TR" → "FAVORAHOME ANKARA TR"
export function feeBase(desc) { const m = String(desc || "").match(/^\s*(VADE FARK[Iİı]|KKDF|BSMV)\s*-\s*(.+)$/i); return m ? m[2].trim() : ""; }
