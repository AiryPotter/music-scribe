// "Report a bug": a description, screenshots, a picture of the manuscript and the app/device
// details, written into ONE PDF on this device. Nothing is sent anywhere: the person downloads or
// shares the file themselves (e.g. to send to whoever is fixing the app).

import { pagesToPdf, defaultPaper, PAPER } from './pages.js';
import { localStamp } from './exporters.js';

const MAX_SHOTS = 8;

/**
 * ctx = { details(): [[label, value]], manuscript(): Promise<Blob|null>, hasTake(): bool, onOpen() }
 */
export function createBugReporter(ctx) {
  const $ = (id) => document.getElementById(id);
  const el = {
    sheet: $('bugSheet'), close: $('bugClose'), what: $('bugWhat'), steps: $('bugSteps'),
    add: $('bugAdd'), file: $('bugFile'), capture: $('bugCapture'), shots: $('bugShots'),
    page: $('bugPage'), info: $('bugInfo'), infoText: $('bugInfoText'),
    save: $('bugSave'), share: $('bugShare'), status: $('bugStatus'),
  };
  const shots = []; // { blob, url, name }
  let busy = false;
  let cache = null; // { key, file }

  const say = (text, kind = '') => { el.status.textContent = text; el.status.className = `hint small ex-status ${kind}`; };
  const draft = () => { try { localStorage.setItem('musicScribe.bugDraft', JSON.stringify({ what: el.what.value, steps: el.steps.value })); } catch { /* private mode */ } };

  function renderShots() {
    el.shots.innerHTML = '';
    shots.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<img alt="Screenshot ${i + 1}"><button type="button" class="mini" aria-label="Remove screenshot ${i + 1}">✕</button>`;
      li.querySelector('img').src = s.url;
      li.querySelector('button').addEventListener('click', () => { URL.revokeObjectURL(s.url); shots.splice(i, 1); cache = null; renderShots(); });
      el.shots.appendChild(li);
    });
    el.add.disabled = shots.length >= MAX_SHOTS;
    el.add.textContent = shots.length ? `+ Add more (${shots.length}/${MAX_SHOTS})` : '+ Add screenshots';
  }
  function addShot(blob, name) {
    if (shots.length >= MAX_SHOTS || !blob?.type?.startsWith('image/')) return;
    shots.push({ blob, url: URL.createObjectURL(blob), name });
    cache = null;
    renderShots();
  }

  el.add.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => {
    for (const f of el.file.files) addShot(f, f.name);
    el.file.value = '';
  });
  // PC: grab one picture of a screen/window/tab (the browser asks which, and records nothing else)
  el.capture.hidden = !navigator.mediaDevices?.getDisplayMedia;
  el.capture.addEventListener('click', async () => {
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      addShot(await new Promise((r) => c.toBlob(r, 'image/png')), 'screen capture');
      say('Screen captured.', 'ok');
    } catch (err) {
      if (err?.name !== 'NotAllowedError') say('Couldn’t capture the screen. Add a screenshot file instead.', 'err');
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  });
  // paste a screenshot straight in (Ctrl+V / long-press Paste)
  el.sheet.addEventListener('paste', (e) => {
    for (const item of e.clipboardData?.items || []) if (item.type.startsWith('image/')) addShot(item.getAsFile(), 'pasted');
  });
  el.what.addEventListener('input', () => { cache = null; draft(); });
  el.steps.addEventListener('input', () => { cache = null; draft(); });
  el.page.addEventListener('change', () => { cache = null; });
  el.info.addEventListener('change', () => { cache = null; el.infoText.hidden = !el.info.checked; });

  // ---------- the PDF ----------
  const loadImg = (blob) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('An image couldn’t be read.')); };
    img.src = url;
  });

  async function makeFile() {
    const key = JSON.stringify([el.what.value, el.steps.value, el.page.checked, el.info.checked, shots.map((s) => s.url)]);
    if (cache?.key === key) return cache.file;
    const paper = PAPER[defaultPaper()] || PAPER.a4;
    const W = 1240, H = Math.round((W * paper.h) / paper.w), M = 90; // ~150 dpi
    const pages = [];
    const newPage = () => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#2b1d14'; g.textBaseline = 'top';
      pages.push(c);
      return g;
    };
    const when = localStamp();
    // page 1: what happened + details
    let g = newPage(), y = M;
    const line = (text, font, color = '#2b1d14', gap = 10) => {
      g.font = font; g.fillStyle = color;
      const size = parseInt(font.match(/(\d+)px/)[1], 10);
      const words = String(text).split(/(\s+)/);
      let cur = '';
      const flush = () => {
        if (y + size > H - M) { g = newPage(); y = M; g.font = font; g.fillStyle = color; }
        g.fillText(cur, M, y); y += size + gap; cur = '';
      };
      for (const para of String(text).split('\n')) {
        cur = '';
        for (const w of para.split(/(\s+)/)) {
          if (g.measureText(cur + w).width > W - 2 * M && cur.trim()) flush();
          cur += cur || w.trim() ? w : '';
        }
        flush();
      }
      void words;
    };
    line('Music Scribe · bug report', 'bold 44px Georgia, serif', '#7a1f2b', 8);
    line(when, 'italic 24px Georgia, serif', '#6a4f35', 26);
    line('What went wrong', 'bold 30px Georgia, serif', '#7a1f2b', 8);
    line(el.what.value.trim() || '(nothing written)', '26px Georgia, serif', '#2b1d14', 8);
    y += 18;
    if (el.steps.value.trim()) {
      line('What I was doing just before', 'bold 30px Georgia, serif', '#7a1f2b', 8);
      line(el.steps.value.trim(), '26px Georgia, serif', '#2b1d14', 8);
      y += 18;
    }
    if (el.info.checked) {
      line('App and device', 'bold 30px Georgia, serif', '#7a1f2b', 8);
      for (const [k, v] of ctx.details()) line(`${k}: ${v}`, '21px Consolas, monospace', '#2b1d14', 5);
      y += 12;
    }
    line(`${shots.length} screenshot${shots.length === 1 ? '' : 's'}${el.page.checked && ctx.hasTake() ? ' · the manuscript as it looked' : ''} on the following page${shots.length + (el.page.checked ? 1 : 0) === 1 ? '' : 's'}.`, 'italic 22px Georgia, serif', '#6a4f35');

    // one page per picture, as big as fits, with a caption
    const pictures = shots.map((s, i) => ({ blob: s.blob, caption: `Screenshot ${i + 1} of ${shots.length}${s.name && !/^image\./.test(s.name) ? ` · ${s.name}` : ''}` }));
    if (el.page.checked && ctx.hasTake()) {
      say('Drawing the manuscript…', 'busy');
      const blob = await ctx.manuscript();
      if (blob) pictures.push({ blob, caption: 'The manuscript as it looked' });
    }
    for (const p of pictures) {
      const img = await loadImg(p.blob);
      const pg = newPage();
      pg.font = 'italic 24px Georgia, serif'; pg.fillStyle = '#6a4f35';
      pg.fillText(p.caption, M, M - 50);
      const maxW = W - 2 * M, maxH = H - 2 * M;
      const s = Math.min(maxW / img.width, maxH / img.height, 3);
      const w = img.width * s, h = img.height * s;
      pg.strokeStyle = '#c9a96a'; pg.lineWidth = 2;
      pg.drawImage(img, (W - w) / 2, M, w, h);
      pg.strokeRect((W - w) / 2, M, w, h);
    }
    const blob = await pagesToPdf(pages, { wPt: paper.w, hPt: paper.h, title: `Music Scribe bug report ${when}` });
    const file = new File([blob], `Music Scribe bug report ${when}.pdf`, { type: 'application/pdf' });
    cache = { key, file };
    return file;
  }

  async function run(label, fn) {
    if (busy) return;
    if (!el.what.value.trim() && !shots.length) { say('Write a line about what went wrong (or add a screenshot) first.', 'err'); el.what.focus(); return; }
    busy = true;
    say(`${label}…`, 'busy');
    try { await fn(); } catch (err) { say(err?.message || 'Something went wrong making the report.', 'err'); } finally { busy = false; }
  }
  el.save.addEventListener('click', () => run('Writing the report', async () => {
    const file = await makeFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    say(`Saved “${file.name}” to your downloads. Send or attach it to whoever is fixing the app.`, 'ok');
  }));
  el.share.hidden = !navigator.share;
  el.share.addEventListener('click', () => run('Getting it ready', async () => {
    const file = await makeFile();
    if (navigator.canShare && !navigator.canShare({ files: [file] })) { say('This device can’t share PDF files directly. Use Save PDF instead.', 'err'); return; }
    try {
      await navigator.share({ files: [file], title: file.name });
      say('Shared.', 'ok');
    } catch (err) {
      if (err?.name === 'NotAllowedError') say('Ready! Tap Share again to send it.', 'ok');
      else if (err?.name !== 'AbortError') throw err;
      else say('');
    }
  }));

  function open() {
    try { const d = JSON.parse(localStorage.getItem('musicScribe.bugDraft') || 'null'); if (d && !el.what.value && !el.steps.value) { el.what.value = d.what || ''; el.steps.value = d.steps || ''; } } catch { /* none */ }
    el.page.checked = ctx.hasTake();
    el.page.disabled = !ctx.hasTake();
    el.infoText.textContent = ctx.details().map(([k, v]) => `${k}: ${v}`).join('\n');
    el.infoText.hidden = !el.info.checked;
    renderShots();
    say('');
    ctx.onOpen?.();
    el.sheet.hidden = false;
    document.body.classList.add('editing');
    requestAnimationFrame(() => { document.body.style.setProperty('--tray-h', `${el.sheet.offsetHeight}px`); el.what.focus({ preventScroll: true }); });
  }
  function close() {
    el.sheet.hidden = true;
    document.body.classList.remove('editing');
  }
  el.close.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.sheet.hidden) close(); });
  /** After it's sent: start a fresh report next time. */
  $('bugClear').addEventListener('click', () => {
    el.what.value = ''; el.steps.value = '';
    shots.splice(0).forEach((s) => URL.revokeObjectURL(s.url));
    cache = null; draft(); renderShots(); say('Cleared. Ready for a new report.', 'ok');
  });
  return { open, close, get isOpen() { return !el.sheet.hidden; } };
}
