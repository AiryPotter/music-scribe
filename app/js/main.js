import { listMics, openMic, looksBluetooth } from './audio.js';
import { detectPitch, rms } from './pitch.js';
import { NoteTracker } from './tracker.js';
import { FretPicker, noteName, stringName } from './guitar.js';
import { renderScore } from './score.js';
import { Mozart } from './mozart.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('musicScribe.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('musicScribe.' + k, v); } catch { /* storage unavailable */ } },
};

const ui = {
  record: $('recordBtn'), recordLabel: $('recordLabel'),
  mic: $('micSelect'), sens: $('sens'), meter: $('meterFill'), gate: $('gateMark'),
  levelStatus: $('levelStatus'), hint: $('micHint'),
  liveNote: $('liveNote'), liveFret: $('liveFret'), liveCents: $('liveCents'), needle: $('tunerNeedle'),
  score: $('score'), count: $('noteCount'), clear: $('clearBtn'),
  tip: $('tipBtn'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomReset: $('zoomReset'), zoomFit: $('zoomFit'),
};
const DEFAULT_HINT = ui.hint.textContent;
const DEMO = new URLSearchParams(location.search).has('demo');

const mozart = new Mozart($('mozart'));
const picker = new FretPicker();
let notes = [];
let session = null;
let tracker = null;
let buf = null;
let raf = 0;
let wakeLock = null;
let lastSound = 0;
let renderTimer = 0;

// ---------- settings ----------
ui.sens.value = store.get('sens', '55');
function gateFromSens(s) {
  // sensitivity 0 → gate 0.05 (needs loud playing); 100 → 0.002 (hears whispers)
  return 0.05 * Math.pow(0.04, s / 100);
}
function levelToPct(level) {
  // map RMS to a 0–100 meter on a dB scale (-60 dB … 0 dB)
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}
function updateGateMark() {
  ui.gate.style.left = levelToPct(gateFromSens(+ui.sens.value)) + '%';
}
ui.sens.addEventListener('input', () => { store.set('sens', ui.sens.value); updateGateMark(); });
updateGateMark();

// ---------- mic list ----------
async function refreshMics() {
  const mics = await listMics().catch(() => []);
  const chosen = session?.deviceId || store.get('mic', '');
  ui.mic.innerHTML = '';
  const def = new Option('Default microphone', '');
  ui.mic.add(def);
  mics.forEach((m, i) => {
    if (m.deviceId === 'default' || m.deviceId === '') return;
    ui.mic.add(new Option(m.label || `Microphone ${i + 1}`, m.deviceId));
  });
  if (DEMO) ui.mic.add(new Option('Demo tones (no mic)', '__demo__'));
  const known = chosen && [...ui.mic.options].some((o) => o.value === chosen);
  ui.mic.value = known ? chosen : (DEMO ? '__demo__' : '');
}
navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);
ui.mic.addEventListener('change', async () => {
  store.set('mic', ui.mic.value);
  if (session) { stop(); await start(); }
});

function showMicHint(label) {
  if (looksBluetooth(label)) {
    ui.hint.textContent = 'Bluetooth mic detected: fine for jotting ideas, but it adds lag and lowers accuracy. A wired or built-in mic works better.';
    ui.hint.classList.add('warn');
    ui.hint.hidden = false;
  } else {
    ui.hint.textContent = DEFAULT_HINT;
    ui.hint.classList.remove('warn');
    ui.hint.hidden = ui.tip.getAttribute('aria-expanded') !== 'true';
  }
}
ui.tip.addEventListener('click', () => {
  const open = ui.tip.getAttribute('aria-expanded') !== 'true';
  ui.tip.setAttribute('aria-expanded', String(open));
  ui.hint.hidden = !open && !ui.hint.classList.contains('warn');
});

// ---------- zoom (see the whole app at once) ----------
const ZOOM_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
const zoom = {
  level: Number(store.get('zoom', '1')) || 1,
  fit: store.get('fit', '0') === '1',
};
function applyZoom() {
  const root = document.documentElement;
  let z = zoom.level;
  if (zoom.fit) {
    root.style.zoom = '1';
    const needed = root.scrollHeight;
    z = Math.max(0.3, Math.min(1, window.innerHeight / needed));
  }
  root.style.zoom = String(z);
  ui.zoomReset.textContent = `${Math.round(z * 100)}%`;
  ui.zoomFit.setAttribute('aria-pressed', String(zoom.fit));
  store.set('zoom', String(zoom.level));
  store.set('fit', zoom.fit ? '1' : '0');
}
function stepZoom(dir) {
  const cur = zoom.fit ? Number(document.documentElement.style.zoom || 1) : zoom.level;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > cur + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001);
  zoom.level = next ?? cur;
  zoom.fit = false;
  applyZoom();
}
ui.zoomIn.addEventListener('click', () => stepZoom(1));
ui.zoomOut.addEventListener('click', () => stepZoom(-1));
ui.zoomReset.addEventListener('click', () => { zoom.level = 1; zoom.fit = false; applyZoom(); });
ui.zoomFit.addEventListener('click', () => { zoom.fit = !zoom.fit; if (!zoom.fit) zoom.level = 1; applyZoom(); });
applyZoom();

// ---------- demo tone source (for testing without a guitar) ----------
function openDemo() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  const seq = [40, 45, 50, 55, 59, 64, 64, 62, 60, 59, 57, 55, 52, 57, 59, 60];
  let i = 0;
  const pluck = () => {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (seq[i % seq.length] - 69) / 12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.02, t + 0.5);
    osc.connect(gain).connect(analyser);
    osc.start(t);
    osc.stop(t + 0.55);
    i++;
  };
  pluck();
  const timer = setInterval(pluck, 600);
  return { ctx, analyser, deviceId: '__demo__', label: 'Demo tones', close() { clearInterval(timer); ctx.close().catch(() => {}); } };
}

// ---------- start / stop ----------
async function start() {
  ui.record.disabled = true;
  try {
    session = ui.mic.value === '__demo__' ? openDemo() : await openMic(store.get('mic', ''));
  } catch (err) {
    ui.record.disabled = false;
    mozart.set('asleep');
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    ui.liveFret.textContent = denied
      ? 'Microphone permission was blocked. Allow it in the browser’s site settings, then try again.'
      : (err?.message || 'Could not open the microphone.');
    return;
  }
  ui.record.disabled = false;
  await refreshMics();
  showMicHint(session.label);

  buf = new Float32Array(session.analyser.fftSize);
  tracker = new NoteTracker({
    onStart: (n) => {
      n.pos = picker.pick(n.midi);
      notes.push(n);
      scheduleRender();
    },
    onEnd: (n) => {
      // Drop blips shorter than 90 ms (string noise, pitch wobble at the attack)
      if (n.end - n.start < 0.09) {
        const i = notes.lastIndexOf(n);
        if (i >= 0) notes.splice(i, 1);
        const prev = notes[i - 1];
        if (prev && prev.midi === n.midi) prev.end = n.end;
      }
      scheduleRender();
    },
    onLive: showLive,
  });

  ui.record.classList.add('on');
  ui.record.setAttribute('aria-pressed', 'true');
  ui.recordLabel.textContent = 'Cease';
  lastSound = session.ctx.currentTime;
  mozart.set('idle');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
  loop();
}

function stop() {
  cancelAnimationFrame(raf);
  if (tracker && session) tracker.flush(session.ctx.currentTime);
  session?.close();
  session = null;
  tracker = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  ui.record.classList.remove('on');
  ui.record.setAttribute('aria-pressed', 'false');
  ui.recordLabel.textContent = 'Begin';
  ui.meter.style.width = '0%';
  ui.levelStatus.textContent = 'Off';
  ui.levelStatus.className = 'level-status';
  mozart.set('asleep');
  scheduleRender();
}

ui.record.addEventListener('click', () => (session ? stop() : start()));
ui.clear.addEventListener('click', () => {
  notes = [];
  picker.reset();
  scheduleRender();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && session && !wakeLock) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

// ---------- analysis loop ----------
function loop() {
  raf = requestAnimationFrame(loop);
  if (!session) return;
  session.analyser.getFloatTimeDomainData(buf);
  const level = rms(buf);
  const gate = gateFromSens(+ui.sens.value);
  const t = session.ctx.currentTime;

  // meter
  ui.meter.style.width = levelToPct(level) + '%';
  if (level < gate) { ui.levelStatus.textContent = 'Quiet'; ui.levelStatus.className = 'level-status quiet'; }
  else if (level > 0.5) { ui.levelStatus.textContent = 'Too loud'; ui.levelStatus.className = 'level-status loud'; }
  else { ui.levelStatus.textContent = 'Good'; ui.levelStatus.className = 'level-status good'; }

  let freq = 0, clarity = 0;
  if (level > gate) ({ freq, clarity } = detectPitch(buf, session.ctx.sampleRate));
  tracker.update(t, level, freq, clarity, gate);

  // mascot mood
  if (tracker.cur) { lastSound = t; mozart.set('scribbling'); }
  else if (t - lastSound > 2.5) mozart.set('listening');
  else mozart.set('idle');
}

function showLive(f) {
  if (!f.voiced) {
    ui.needle.classList.add('off');
    return;
  }
  ui.needle.classList.remove('off');
  ui.liveNote.textContent = noteName(f.midi);
  const pos = tracker?.cur && tracker.cur.midi === f.midi ? tracker.cur.pos : picker.peek(f.midi);
  ui.liveFret.textContent = pos ? `${stringName(pos.stringIndex)} string · fret ${pos.fret}` : 'Below the guitar’s range';
  ui.liveCents.textContent = f.cents === 0 ? 'in tune' : `${f.cents > 0 ? '+' : ''}${f.cents} cents`;
  ui.needle.style.left = `${50 + f.cents}%`;
}

// ---------- score ----------
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = 0;
    renderScore(ui.score, notes, { liveNote: tracker?.cur || null });
    ui.count.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
    const page = ui.score.parentElement;
    if (session) page.scrollTop = page.scrollHeight;
  }, 120);
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (zoom.fit) applyZoom(); scheduleRender(); }, 150);
});

// ---------- boot ----------
refreshMics();
scheduleRender();
if ('serviceWorker' in navigator && window.isSecureContext && !DEMO) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Expose a little for debugging in the console
window.musicScribe = { get notes() { return notes; }, get tracker() { return tracker; }, start, stop };
