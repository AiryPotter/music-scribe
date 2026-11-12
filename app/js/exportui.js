// The "Seal & send" export sheet: pick a format, then Share / Download / Save to Dropbox.

import { fileName, toMusicXML, toMIDI, toTextTab, toProject, readProject } from './exporters.js';
import { toPDF, toImage, toSVG, defaultPaper } from './pages.js';
import { toGuitarPro } from './gp.js';
import { dropboxReady, dropboxConnected, beginConnect, openSignInWindow, uploadToDropbox, disconnectDropbox } from './dropbox.js';
import { folderSupported, loadFolder, folderName, ensureFolder, saveToFolder } from './dropfolder.js';

export const FORMATS = [
  { id: 'pdf', name: 'PDF', what: 'Sheet music to print or send', ext: 'pdf', type: 'application/pdf', opts: ['layout', 'paper', 'look'] },
  { id: 'image', name: 'Image', what: 'PNG for Instagram, TikTok, messages', ext: 'png', type: 'image/png', opts: ['size', 'layout', 'look'] },
  { id: 'musicxml', name: 'MusicXML', what: 'MuseScore, Sibelius, Finale, Dorico', ext: 'musicxml', type: 'application/vnd.recordare.musicxml+xml' },
  { id: 'gp', name: 'Guitar Pro', what: 'Guitar Pro 7 / 8 (.gp)', ext: 'gp', type: 'application/x-guitar-pro' },
  { id: 'midi', name: 'MIDI', what: 'GarageBand, FL Studio, any DAW', ext: 'mid', type: 'audio/midi' },
  { id: 'txt', name: 'Text tab', what: 'Paste into forums, notes, chats', ext: 'txt', type: 'text/plain' },
  { id: 'svg', name: 'SVG', what: 'Sharp at any size: slides, design apps', ext: 'svg', type: 'image/svg+xml', opts: ['layout', 'look'] },
  { id: 'project', name: 'Project', what: 'Reopen and keep editing later', ext: 'musicscribe.json', type: 'application/json' },
];

const OPTIONS = {
  layout: { label: 'Show', choices: [['both', 'Notes + tab'], ['notation', 'Notes'], ['tab', 'Tab']] },
  paper: { label: 'Paper', choices: [['a4', 'A4'], ['letter', 'Letter']] },
  size: { label: 'Size', choices: [['square', 'Square post'], ['story', 'Story 9:16'], ['page', 'Whole page']] },
  look: { label: 'Look', choices: [['white', 'Clean white'], ['parchment', 'Parchment']] },
};

/**
 * ctx = { store, getSong(), getModel(), hasTake(), setTitle(t), getTitle(),
 *         onDone(what), onOpenProject(data), pasteMode }
 */
export function createExportSheet(ctx) {
  const $ = (id) => document.getElementById(id);
  const el = {
    sheet: $('exportSheet'), close: $('exClose'), title: $('exTitle'), by: $('exBy'),
    formats: $('exFormats'), options: $('exOptions'), share: $('exShare'), download: $('exDownload'),
    dropbox: $('exDropbox'), status: $('exStatus'), paste: $('exPaste'), code: $('exCode'), codeGo: $('exCodeGo'),
    link: $('exLink'), open: $('exOpen'), file: $('exFile'), dbOff: $('exDbOff'), dbFolder: $('exDbFolder'),
  };
  const st = {
    fmt: ctx.store.get('exFormat', 'pdf'),
    layout: ctx.store.get('exLayout', 'both'),
    paper: ctx.store.get('exPaper', defaultPaper()),
    size: ctx.store.get('exSize', 'square'),
    look: ctx.store.get('exLook', 'white'),
    imageLook: ctx.store.get('exImageLook', 'parchment'),
  };
  let cache = null;       // { key, file }
  let busy = false;
  let pending = null;     // Dropbox paste-mode sign-in waiting for a code

  // ---------- build the format cards and option rows ----------
  FORMATS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ex-format';
    b.dataset.fmt = f.id;
    b.setAttribute('role', 'radio');
    b.innerHTML = `<strong>${f.name}</strong><small>${f.what}</small>`;
    el.formats.appendChild(b);
  });
  Object.entries(OPTIONS).forEach(([key, o]) => {
    const row = document.createElement('div');
    row.className = 'ex-opt';
    row.dataset.opt = key;
    row.innerHTML = `<span class="ed-label">${o.label}</span>` + o.choices
      .map(([v, label]) => `<button type="button" class="ed-btn seg" data-opt="${key}" data-val="${v}">${label}</button>`).join('');
    el.options.appendChild(row);
  });

  const fmt = () => FORMATS.find((f) => f.id === st.fmt) || FORMATS[0];
  const look = () => (st.fmt === 'image' ? st.imageLook : st.look);

  function say(text, kind = '') {
    el.status.textContent = text;
    el.status.className = `ex-status ${kind}`;
  }

  function refresh() {
    const f = fmt();
    el.formats.querySelectorAll('.ex-format').forEach((b) => {
      const ff = FORMATS.find((x) => x.id === b.dataset.fmt);
      b.classList.toggle('on', ff.id === f.id);
      b.setAttribute('aria-checked', String(ff.id === f.id));
    });
    el.options.querySelectorAll('.ex-opt').forEach((row) => { row.hidden = !(f.opts || []).includes(row.dataset.opt); });
    el.options.querySelectorAll('[data-opt]').forEach((b) => {
      if (!b.dataset.val) return;
      const cur = b.dataset.opt === 'look' ? look() : st[b.dataset.opt];
      b.classList.toggle('on', cur === b.dataset.val);
    });
    el.share.hidden = !navigator.share;
    const pc = folderSupported();
    const linked = pc ? !!folderName() : dropboxConnected();
    el.dropbox.classList.toggle('connected', linked);
    el.dropbox.querySelector('span').textContent = linked ? 'Save to Dropbox' : 'Dropbox';
    el.dropbox.title = pc
      ? (linked ? `Saves into your “${folderName()}” folder; the Dropbox desktop app syncs it` : 'Pick your Dropbox folder once (e.g. C:\\Users\\you\\Dropbox)')
      : 'Save straight into Dropbox › Apps › Music Scribe';
    el.dbOff.hidden = pc || !dropboxConnected();
    el.dbFolder.hidden = !pc || !folderName();
    el.dbFolder.textContent = `Dropbox folder: ${folderName()} · change`;
  }

  // ---------- make the file ----------
  async function makeFile() {
    const f = fmt();
    const song = ctx.getSong();
    const key = JSON.stringify([f.id, st.layout, st.paper, st.size, look(), song.title, song.composer, ctx.version()]);
    if (cache?.key === key) return cache.file;
    const model = ctx.getModel();
    const o = { layout: st.layout, paper: st.paper, size: st.size, look: look() };
    let blob;
    switch (f.id) {
      case 'pdf': blob = await toPDF(song, model, o, (p) => say(`Writing the PDF… ${Math.round(p * 100)}%`, 'busy')); break;
      case 'image': blob = await toImage(song, model, o); break;
      case 'svg': blob = await toSVG(song, model, o); break;
      case 'musicxml': blob = toMusicXML(song); break;
      case 'gp': say('Fetching the Guitar Pro writer…', 'busy'); blob = await toGuitarPro(toMusicXML(song), song); break;
      case 'midi': blob = toMIDI(song); break;
      case 'txt': blob = toTextTab(song); break;
      case 'project': blob = toProject(song); break;
      default: throw new Error('Unknown format');
    }
    const name = f.id === 'image' && st.size !== 'page'
      ? fileName(song, `${st.size}.png`)
      : fileName(song, f.ext);
    const file = new File([blob], name, { type: f.type });
    cache = { key, file };
    return file;
  }

  async function run(label, fn) {
    if (busy) return;
    busy = true;
    el.sheet.classList.add('working');
    say(`${label}…`, 'busy');
    try {
      await fn();
    } catch (err) {
      if (err?.name === 'AbortError') say('');
      else { say(err?.message || String(err), 'err'); console.warn(err); }
    } finally {
      busy = false;
      el.sheet.classList.remove('working');
    }
  }

  const sizeText = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);

  // ---------- Share (phone share sheet: Instagram, WhatsApp, Messages, Files, Dropbox app…) ----------
  el.share.addEventListener('click', () => run('Getting it ready', async () => {
    const file = await makeFile(); // instant on a second tap: it's cached
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      say(`This phone can’t share ${fmt().name} files directly. Use Download or Dropbox instead.`, 'err');
      return;
    }
    try {
      await navigator.share({ files: [file], title: file.name });
      say(`Shared ${file.name}`, 'ok');
      ctx.onDone('shared');
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        // took too long after the tap for the phone's liking: the file is ready now, so one more tap shares it
        say('Ready! Tap Share again to send it.', 'ok');
      } else throw err;
    }
  }));

  // ---------- Download ----------
  el.download.addEventListener('click', () => run('Writing the file', async () => {
    const file = await makeFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    say(`Downloaded ${file.name} (${sizeText(file.size)})`, 'ok');
    ctx.onDone('downloaded');
  }));

  // ---------- Dropbox ----------
  async function uploadNow() {
    const file = await makeFile();
    say(`Saving to Dropbox… (${sizeText(file.size)})`, 'busy');
    const path = await uploadToDropbox(file.name, file);
    say(`Saved to Dropbox › Apps › Music Scribe${path}`, 'ok');
    ctx.onDone('dropbox');
    refresh();
  }
  // PC: write into the synced Dropbox folder (picker / permission must open during this click)
  function saveIntoFolder(pickNew = false) {
    run(pickNew || !folderName() ? 'Choose your Dropbox folder' : 'Saving to your Dropbox folder', async () => {
      let dir;
      try {
        dir = await ensureFolder({ pickNew });
      } catch (err) {
        if (err?.name === 'AbortError') { say('No folder chosen.'); return; }
        throw err;
      }
      refresh();
      const file = await makeFile();
      say(`Saving into ${dir.name}… (${sizeText(file.size)})`, 'busy');
      const saved = await saveToFolder(dir, file.name, file);
      say(`Saved to ${dir.name} › ${saved}. The Dropbox app will sync it.`, 'ok');
      ctx.onDone('dropbox');
    });
  }
  el.dbFolder.addEventListener('click', () => { if (!busy) saveIntoFolder(true); });

  el.dropbox.addEventListener('click', () => {
    if (busy) return;
    if (folderSupported()) { saveIntoFolder(false); return; }
    if (!dropboxReady()) {
      say('Dropbox needs a one-time setup before this button works (an app key from dropbox.com/developers).', 'err');
      return;
    }
    if (dropboxConnected()) { run('Saving to Dropbox', uploadNow); return; }
    // not signed in yet: open the sign-in window during this tap (iPhone home-screen apps use copy & paste)
    const win = ctx.pasteMode ? null : openSignInWindow();
    run('Connecting to Dropbox', async () => {
      const r = await beginConnect({ mode: win ? 'popup' : 'paste', win });
      if (r.mode === 'paste') {
        pending = r;
        el.link.href = r.url;
        el.paste.hidden = false;
        say('Tap “Open Dropbox”, allow access, then copy the code it shows and paste it here.', '');
        return;
      }
      await uploadNow();
    });
  });
  el.codeGo.addEventListener('click', () => {
    if (!pending) return;
    const code = el.code.value.trim();
    if (!code) { say('Paste the code from Dropbox first.', 'err'); return; }
    run('Connecting to Dropbox', async () => {
      await pending.finish(code);
      pending = null;
      el.paste.hidden = true;
      el.code.value = '';
      await uploadNow();
    });
  });
  el.dbOff.addEventListener('click', async () => {
    await disconnectDropbox();
    say('Disconnected from Dropbox.', '');
    refresh();
  });

  // ---------- open a saved project ----------
  el.open.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async () => {
    const f = el.file.files?.[0];
    el.file.value = '';
    if (!f) return;
    try {
      const data = await readProject(f);
      ctx.onOpenProject(data);
      close();
    } catch (err) {
      say(err.message, 'err');
    }
  });

  // ---------- choices ----------
  el.formats.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fmt]');
    if (!b || b.disabled) return;
    st.fmt = b.dataset.fmt;
    ctx.store.set('exFormat', st.fmt);
    say('');
    refresh();
  });
  el.options.addEventListener('click', (e) => {
    const b = e.target.closest('[data-val]');
    if (!b) return;
    const key = b.dataset.opt;
    if (key === 'look' && st.fmt === 'image') { st.imageLook = b.dataset.val; ctx.store.set('exImageLook', st.imageLook); }
    else { st[key] = b.dataset.val; ctx.store.set(`ex${key[0].toUpperCase()}${key.slice(1)}`, st[key]); }
    refresh();
  });
  el.title.addEventListener('input', () => ctx.setTitle(el.title.value.trim()));
  el.by.addEventListener('input', () => ctx.store.set('composer', el.by.value.trim()));
  el.close.addEventListener('click', () => close());

  function open() {
    if (!ctx.hasTake()) return;
    el.title.value = ctx.getTitle() || '';
    el.by.value = ctx.store.get('composer', '');
    cache = null;
    say('');
    refresh();
    loadFolder().then(refresh);
    el.sheet.hidden = false;
    document.body.classList.add('editing');
    requestAnimationFrame(() => document.body.style.setProperty('--tray-h', `${el.sheet.offsetHeight}px`));
  }
  function close() {
    el.sheet.hidden = true;
    el.paste.hidden = true;
    pending = null;
    document.body.classList.remove('editing');
  }
  return { open, close, get isOpen() { return !el.sheet.hidden; } };
}
