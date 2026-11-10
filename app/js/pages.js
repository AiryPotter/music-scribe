// Drawn exports: PDF (printable pages), PNG images (whole page, square post, 9:16 story) and SVG.
// Pages are composed on a canvas (title, music, footer) and the PDF file is written by hand,
// so exporting works offline with no extra libraries.

import { renderScore } from './score.js';

export const PAPER = {
  a4: { name: 'A4', w: 595.28, h: 841.89 },
  letter: { name: 'US Letter', w: 612, h: 792 },
};
/** Letter in the US, Canada, Mexico and the Philippines; A4 everywhere else. */
export function defaultPaper() {
  return /-(US|CA|MX|PH)$/i.test(navigator.language || '') || navigator.language === 'en' ? 'letter' : 'a4';
}

export const LOOKS = {
  white: { bg: '#ffffff', ink: '#1c1410', chord: '#7a1f2b', title: '#2b1d14', soft: '#6a5a4a', rule: '#c9b48a' },
  parchment: { bg: '#f3e3bf', ink: '#2b1d14', chord: '#7a1f2b', title: '#7a1f2b', soft: '#6a4f35', rule: '#b8892b' },
};

const DISPLAY = '"IM Fell English", "Cormorant Garamond", Georgia, "Times New Roman", serif';
const BODY = '"Cormorant Garamond", Georgia, "Times New Roman", serif';

async function fontsReady() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`40px ${DISPLAY}`), document.fonts.load(`italic 20px ${BODY}`), document.fonts.load(`600 20px ${BODY}`)]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* fall back to system serif */ }
}

/** Draw the score off-screen at a fixed size; returns { svg, info, done() }. */
function renderOffscreen(model, opts) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-30000px;top:0;width:${opts.width}px;pointer-events:none;`;
  document.body.appendChild(el);
  const clean = { ...model, measures: model.measures.map((bar) => bar.map((p) => ({ ...p, sel: false, live: false, ref: undefined }))) };
  const info = renderScore(el, clean, opts);
  const svg = el.querySelector('svg');
  if (!svg || !info) { el.remove(); throw new Error('The notation engine didn’t load, so there’s nothing to draw.'); }
  return { svg, info, done: () => el.remove() };
}

/** A horizontal slice of the drawn score (score units y0..y1) as an <img> `outW` pixels wide. */
function sliceImage(svg, info, y0, y1, outW) {
  const W = info.pxWidth / info.scale;
  const h = y1 - y0;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `0 ${y0} ${W} ${h}`);
  clone.setAttribute('width', String(outW));
  clone.setAttribute('height', String(Math.round(outW * h / W)));
  clone.removeAttribute('style');
  const text = new XMLSerializer().serializeToString(clone);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Couldn’t draw the score as an image.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  });
}

function infoLine(song) {
  return [
    song.tuningName && song.tuningName !== 'Standard' ? `Tuning ${song.tuningLetters}` : 'Standard tuning',
    song.capo ? `Capo ${song.capo}` : '',
    `♩ = ${Math.round(song.bpm)}`,
    `${song.meter}/4`,
  ].filter(Boolean).join('   ·   ');
}

/** Title, "by …", and the tuning/tempo line, centred. Returns the y below it. */
function drawHeading(g, song, look, cx, y, sizes) {
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  if (song.title) {
    g.fillStyle = look.title;
    g.font = `${sizes.title}px ${DISPLAY}`;
    y += sizes.title;
    g.fillText(song.title, cx, y, sizes.maxW);
    y += sizes.title * 0.3;
  }
  if (song.composer) {
    g.fillStyle = look.soft;
    g.font = `italic ${sizes.by}px ${BODY}`;
    y += sizes.by * 1.1;
    g.fillText(`by ${song.composer}`, cx, y, sizes.maxW);
  }
  g.fillStyle = look.soft;
  g.font = `600 ${sizes.info}px ${BODY}`;
  y += sizes.info * 1.6;
  g.fillText(infoLine(song), cx, y, sizes.maxW);
  y += sizes.info * 0.9;
  return y;
}

function drawFrame(g, W, H, look, inset) {
  g.fillStyle = look.bg;
  g.fillRect(0, 0, W, H);
  if (look === LOOKS.parchment) {
    g.strokeStyle = look.rule;
    g.lineWidth = Math.max(2, inset * 0.06);
    g.strokeRect(inset * 0.45, inset * 0.45, W - inset * 0.9, H - inset * 0.9);
    g.lineWidth = Math.max(1, inset * 0.02);
    g.strokeRect(inset * 0.58, inset * 0.58, W - inset * 1.16, H - inset * 1.16);
  }
}

// ---------- PDF ----------
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function canvasToPdfImage(canvas) {
  const w = canvas.width, h = canvas.height;
  if (typeof CompressionStream !== 'undefined') {
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
    return { w, h, filter: 'FlateDecode', data: await deflate(rgb) };
  }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  return { w, h, filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()) };
}
function pdfString(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    for (const u of units) hex += u.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}
/** pages: [{ img: { w, h, filter, data }, wPt, hPt }] → PDF Blob */
function writePdf(pages, meta) {
  const te = new TextEncoder();
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = (x) => { const b = typeof x === 'string' ? te.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  const pageNum = (i) => 3 + i * 3; // page, contents, image
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    const pn = pageNum(i);
    obj(pn, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.wPt} ${p.hPt}] /Resources << /XObject << /Im${i} ${pn + 2} 0 R >> >> /Contents ${pn + 1} 0 R >>`));
    const content = `q ${p.wPt} 0 0 ${p.hPt} 0 0 cm /Im${i} Do Q`;
    obj(pn + 1, () => { push(`<< /Length ${content.length} >>\nstream\n`); push(content); push('\nendstream'); });
    obj(pn + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.img.w} /Height ${p.img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${p.img.filter} /Length ${p.img.data.length} >>\nstream\n`);
      push(p.img.data);
      push('\nendstream');
    });
  });
  const infoN = 3 + n * 3;
  const d = new Date();
  const stamp = `D:${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  obj(infoN, () => push(`<< /Title ${pdfString(meta.title || 'Music Scribe')}${meta.author ? ` /Author ${pdfString(meta.author)}` : ''} /Creator (Music Scribe) /Producer (Music Scribe) /CreationDate (${stamp}) >>`));
  const xref = pos;
  push(`xref\n0 ${infoN + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= infoN; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${infoN + 1} /Root 1 0 R /Info ${infoN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

/**
 * Printable PDF. opts: { paper: 'a4'|'letter', look: 'white'|'parchment', layout: 'both'|'notation'|'tab' }
 * onProgress(0..1) is called per page.
 */
export async function toPDF(song, model, opts, onProgress = () => {}) {
  await fontsReady();
  const P = PAPER[opts.paper] || PAPER.a4;
  const look = LOOKS[opts.look] || LOOKS.white;
  const DPI = 200;
  const k = DPI / 72;                       // pixels per point
  const W = Math.round(P.w * k), H = Math.round(P.h * k);
  const margin = 42;                         // pt
  const unit = 0.6;                          // pt per score unit (sets how big the music prints)
  const contentW = P.w - margin * 2;
  const r = renderOffscreen(model, { width: Math.round(contentW / unit), scale: 1, layout: opts.layout, colors: { ink: look.ink, paper: look.bg, chord: look.chord } });
  try {
    const { info } = r;
    const rowPt = info.rowHeight * unit;
    const footPt = 30;
    const headSizes = { title: 34 * k, by: 16 * k, info: 11 * k, maxW: contentW * k };
    // page 1 has the heading: measure it, then work out how many rows fit on each page
    const probe = document.createElement('canvas').getContext('2d');
    const headPt = (drawHeading(probe, song, look, 0, -6 * k, headSizes) + 6 * k) / k;
    const fit1 = Math.max(1, Math.floor((P.h - margin - headPt - footPt - margin * 0.6) / rowPt));
    const fitN = Math.max(1, Math.floor((P.h - margin - footPt - margin * 0.6) / rowPt));
    const ranges = [];
    for (let r0 = 0; r0 < info.rows;) {
      const n = ranges.length === 0 ? fit1 : fitN;
      ranges.push([r0, Math.min(info.rows, r0 + n)]);
      r0 += n;
    }
    const pages = [];
    for (let i = 0; i < ranges.length; i++) {
      const [r0, r1] = ranges[i];
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d');
      drawFrame(g, W, H, look, margin * k);
      let y = margin * k;
      if (i === 0) {
        y = drawHeading(g, song, look, W / 2, y - 6 * k, headSizes) + 6 * k;
      }
      const sy0 = r0 === 0 ? 0 : info.topPad + r0 * info.rowHeight - 14;
      const sy1 = info.topPad + r1 * info.rowHeight + 4;
      const img = await sliceImage(r.svg, info, sy0, sy1, Math.round(contentW * k));
      g.drawImage(img, margin * k, y, contentW * k, (sy1 - sy0) * unit * k);
      // footer
      g.fillStyle = look.soft;
      g.font = `italic ${9.5 * k}px ${BODY}`;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.fillText('Written down with Music Scribe', margin * k, H - margin * 0.75 * k);
      g.textAlign = 'right';
      g.fillText(`${song.title ? `${song.title} · ` : ''}page ${i + 1} of ${ranges.length}`, W - margin * k, H - margin * 0.75 * k, contentW * k * 0.6);
      pages.push({ img: await canvasToPdfImage(canvas), wPt: P.w, hPt: P.h });
      canvas.width = canvas.height = 0; // free memory on phones
      onProgress((i + 1) / ranges.length);
    }
    return writePdf(pages, { title: song.title, author: song.composer });
  } finally {
    r.done();
  }
}

// ---------- images ----------
const MAX_PIXELS = 16_000_000; // iPhone canvas limit is ~16.7M pixels

/**
 * PNG image. opts: { size: 'page' | 'square' | 'story', look, layout }
 * page = the whole score, 1600 px wide; square = 1080×1080 post; story = 1080×1920.
 */
export async function toImage(song, model, opts) {
  await fontsReady();
  const look = LOOKS[opts.look] || LOOKS.parchment;
  const social = opts.size === 'square' || opts.size === 'story';
  const W = social ? 1080 : 1600;
  const fixedH = opts.size === 'square' ? 1080 : opts.size === 'story' ? 1920 : 0;
  const pad = social ? 70 : 80;
  const contentW = W - pad * 2;
  const renderW = opts.size === 'story' ? 560 : social ? 760 : 1100; // stories: bigger notes, more rows
  const k = contentW / renderW;            // pixels per score unit
  const r = renderOffscreen(model, { width: renderW, scale: 1, layout: opts.layout, colors: { ink: look.ink, paper: look.bg, chord: look.chord } });
  try {
    const { info } = r;
    const sizes = social
      ? { title: 64, by: 30, info: 24, maxW: contentW }
      : { title: 56, by: 28, info: 22, maxW: contentW };
    // measure the heading on a scratch canvas
    const probe = document.createElement('canvas').getContext('2d');
    const headH = drawHeading(probe, song, look, 0, 0, sizes) + 24;
    const footH = social ? 90 : 70;
    const rowH = info.rowHeight * k;
    let rows = info.rows;
    let H = fixedH;
    if (!fixedH) {
      H = Math.ceil(pad + headH + (info.topPad + rows * info.rowHeight + 6) * k + footH);
      if (W * H > MAX_PIXELS) { // very long piece: show as much as a phone can draw
        H = Math.floor(MAX_PIXELS / W);
        rows = Math.max(1, Math.floor((H - pad - headH - footH) / rowH));
      }
    } else {
      rows = Math.max(1, Math.min(info.rows, Math.floor((H - pad - headH - footH) / rowH)));
    }
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    drawFrame(g, W, H, look, pad);
    let y = drawHeading(g, song, look, W / 2, pad * 0.8, sizes) + 18;
    const sy1 = info.topPad + rows * info.rowHeight + 4;
    const img = await sliceImage(r.svg, info, 0, sy1, Math.round(contentW * 1.5));
    const drawH = sy1 * k;
    // social posts: centre the music in the space that's left
    if (social) y += Math.max(0, (H - footH - y - drawH) / 2);
    g.drawImage(img, pad, y, contentW, drawH);
    // footer
    g.textAlign = 'center';
    g.fillStyle = look.soft;
    if (rows < info.rows) {
      g.font = `italic ${social ? 26 : 22}px ${BODY}`;
      g.fillText(`… continues (${info.rows - rows} more line${info.rows - rows === 1 ? '' : 's'})`, W / 2, H - footH + 6);
    }
    g.fillStyle = look.title;
    g.font = `${social ? 34 : 26}px ${DISPLAY}`;
    g.fillText('❦ Music Scribe', W / 2, H - pad * 0.55);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Couldn’t make the image (the phone may be low on memory).');
    return blob;
  } finally {
    r.done();
  }
}

// ---------- SVG ----------
/** The whole score as a scalable SVG (opens in browsers, Inkscape, Illustrator, Figma, slides). */
export async function toSVG(song, model, opts) {
  const look = LOOKS[opts.look] || LOOKS.white;
  const head = [song.title, song.composer ? `by ${song.composer}` : '', infoLine(song)].filter(Boolean).join('   —   ');
  const r = renderOffscreen({ ...model, header: head }, { width: 1100, scale: 1, layout: opts.layout, colors: { ink: look.ink, paper: look.bg, chord: look.chord } });
  try {
    const clone = r.svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `0 0 ${r.info.pxWidth} ${r.info.pxHeight}`);
    clone.removeAttribute('style');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', look.bg);
    clone.insertBefore(bg, clone.firstChild);
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    return new Blob([text], { type: 'image/svg+xml' });
  } finally {
    r.done();
  }
}
