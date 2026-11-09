import { listMics, openMic, looksBluetooth } from './audio.js';
import { detectPitch, rms } from './pitch.js';
import { NoteTracker } from './tracker.js';
import { FretPicker, noteName, stringName } from './guitar.js';
import { renderScore, previewModel } from './score.js';
import { Mozart } from './mozart.js';
import { Recorder } from './recorder.js';
import { Metronome } from './metronome.js';
import { transcribe, preloadTranscriber } from './transcribe.js';
import { onsetEvents, estimateTempo, phaseFor, detectMeter, buildMeasures } from './rhythm.js';
import { nameChord } from './chords.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('musicScribe.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('musicScribe.' + k, v); } catch { /* storage unavailable */ } },
};

const ui = {
  record: $('recordBtn'), recordLabel: $('recordLabel'), click: $('clickToggle'),
  mic: $('micSelect'), sens: $('sens'), meter: $('meterFill'), gate: $('gateMark'),
  levelStatus: $('levelStatus'), hint: $('micHint'), tip: $('tipBtn'),
  liveNote: $('liveNote'), liveFret: $('liveFret'), liveCents: $('liveCents'), needle: $('tunerNeedle'),
  score: $('score'), count: $('noteCount'), clear: $('clearBtn'), status: $('scoreStatus'),
  bpm: $('bpmInput'), bpmUp: $('bpmUp'), bpmDown: $('bpmDown'), bpmHalf: $('bpmHalf'), bpmDouble: $('bpmDouble'),
  meterSel: $('meterSelect'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomReset: $('zoomReset'), zoomFit: $('zoomFit'),
};
const DEFAULT_HINT = ui.hint.textContent;
const DEMO = new URLSearchParams(location.search).has('demo');

const mozart = new Mozart($('mozart'));
const picker = new FretPicker();
let notes = [];          // live preview notes (audio-clock times)
let take = null;         // last finished take: { rec, notes, events, tempo, model, source }
let session = null;
let tracker = null;
let recorder = null;
let metro = null;
let countInEnd = 0;
let buf = null;
let raf = 0;
let wakeLock = null;
let lastSound = 0;
let renderTimer = 0;
let busy = false;

// ---------- settings ----------
ui.sens.value = store.get('sens', '55');
ui.bpm.value = store.get('bpm', '100');
ui.click.checked = store.get('click', '0') === '1';
ui.meterSel.value = store.get('meter', 'auto');
ui.click.addEventListener('change', () => store.set('click', ui.click.checked ? '1' : '0'));

function gateFromSens(s) { return 0.05 * Math.pow(0.04, s / 100); }
function levelToPct(level) {
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}
function updateGateMark() { ui.gate.style.left = levelToPct(gateFromSens(+ui.sens.value)) + '%'; }
ui.sens.addEventListener('input', () => { store.set('sens', ui.sens.value); updateGateMark(); });
updateGateMark();

// ---------- mic list ----------
async function refreshMics() {
  const mics = await listMics().catch(() => []);
  const chosen = session?.deviceId || store.get('mic', '');
  ui.mic.innerHTML = '';
  ui.mic.add(new Option('Default microphone', ''));
  mics.forEach((m, i) => {
    if (m.deviceId === 'default' || m.deviceId === '') return;
    ui.mic.add(new Option(m.label || `Microphone ${i + 1}`, m.deviceId));
  });
  if (DEMO) ui.mic.add(new Option('Demo song (no mic)', '__demo__'));
  const known = chosen && [...ui.mic.options].some((o) => o.value === chosen);
  ui.mic.value = known ? chosen : (DEMO ? '__demo__' : '');
}
navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);
ui.mic.addEventListener('change', async () => {
  store.set('mic', ui.mic.value);
  if (session) { await stop(); await start(); }
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
const zoom = { level: Number(store.get('zoom', '1')) || 1, fit: store.get('fit', '0') === '1' };
function applyZoom() {
  const root = document.documentElement;
  let z = zoom.level;
  if (zoom.fit) {
    root.style.zoom = '1';
    z = Math.max(0.3, Math.min(1, window.innerHeight / root.scrollHeight));
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

// ---------- demo song (for testing without a guitar) ----------
// [beat, notes, length in beats] — one 4-bar phrase, played twice
const DEMO_SONG = [
  [0, [40], 1], [1, [45], 1], [2, [50], 0.5], [2.5, [55], 0.5], [3, [59], 1],
  [4, [48, 52, 55, 60, 64], 2], [6, [43, 47, 50, 55, 59, 67], 2],
  [8, [57], 0.5], [8.5, [60], 0.5], [9, [64], 1], [10, [62], 1], [11, [60], 1],
  [12, [45, 52, 57, 60, 64], 1], [13, [45, 52, 57, 60, 64], 1], [14, [41, 48, 53, 57, 60, 65], 2],
];
function openDemo() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const bus = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  bus.connect(analyser);
  const pluck = (t, midi, dur, level) => {
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    lp.frequency.value = 3000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(level * 0.12, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
    osc.connect(lp).connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };
  return {
    ctx, analyser, source: bus, deviceId: '__demo__', label: 'Demo song',
    play(at, bpm) {
      const p = 60 / bpm;
      for (let loop = 0; loop < 2; loop++) {
        for (const [beat, ms, len] of DEMO_SONG) {
          const t = at + (loop * 16 + beat) * p;
          const level = ms.length > 1 ? 0.13 : 0.3;
          ms.forEach((m, k) => pluck(t + k * 0.012, m, len * p * 0.95, level));
        }
      }
    },
    close() { ctx.close().catch(() => {}); },
  };
}

// ---------- start / stop ----------
function clampBpm(v) { return Math.max(40, Math.min(240, Math.round(Number(v) || 100))); }

async function start() {
  if (busy) return;
  busy = true;
  ui.record.disabled = true;
  preloadTranscriber();
  try {
    session = ui.mic.value === '__demo__' ? openDemo() : await openMic(store.get('mic', ''));
    recorder = await Recorder.create(session.ctx, session.source);
  } catch (err) {
    session?.close?.();
    session = null;
    busy = false;
    ui.record.disabled = false;
    mozart.set('asleep');
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    ui.liveFret.textContent = denied
      ? 'Microphone permission was blocked. Allow it in the browser’s site settings, then try again.'
      : (err?.message || 'Could not open the microphone.');
    return;
  }
  busy = false;
  ui.record.disabled = false;
  await refreshMics();
  showMicHint(session.label);

  // fresh take
  take = null;
  notes = [];
  picker.reset();
  buf = new Float32Array(session.analyser.fftSize);
  tracker = new NoteTracker({
    onStart: (n) => { n.pos = picker.pick(n.midi); notes.push(n); scheduleRender(); },
    onEnd: (n) => {
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

  const ctx = session.ctx;
  const bpm = clampBpm(ui.bpm.value);
  const meter = ui.meterSel.value === 'auto' ? 4 : Number(ui.meterSel.value);
  countInEnd = 0;
  let clickInfo = null;
  if (ui.click.checked) {
    metro = new Metronome(ctx, {
      bpm, meter,
      onBeat: (b) => { if (b < meter) mozart.say(String(b + 1)); else if (b === meter) mozart.say(''); },
    });
    const t0 = metro.start(ctx.currentTime + 0.2);
    countInEnd = t0 + meter * (60 / bpm);
    clickInfo = { bpm, meter, downbeat: countInEnd };
  }
  session.clickInfo = clickInfo;
  if (session.play) session.play(countInEnd || ctx.currentTime + 0.3, clickInfo ? bpm : 100);

  ui.record.classList.add('on');
  ui.record.setAttribute('aria-pressed', 'true');
  ui.recordLabel.textContent = 'Cease';
  setStatus(clickInfo ? `Recording with click · ♩=${bpm}` : 'Recording · live preview');
  lastSound = ctx.currentTime;
  mozart.set('idle');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
  scheduleRender();
  loop();
}

async function stop() {
  if (!session || busy) return;
  busy = true;
  cancelAnimationFrame(raf);
  const ctx = session.ctx;
  tracker?.flush(ctx.currentTime);
  metro?.stop();
  metro = null;
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  let rec = null;
  try { rec = await recorder.stop(); } catch { rec = null; }
  const clickInfo = session.clickInfo;
  session.close();
  session = null;
  tracker = null;
  recorder = null;
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  ui.record.classList.remove('on');
  ui.record.setAttribute('aria-pressed', 'false');
  ui.recordLabel.textContent = 'Begin';
  ui.meter.style.width = '0%';
  ui.levelStatus.textContent = 'Off';
  ui.levelStatus.className = 'level-status';
  busy = false;

  if (!rec || rec.samples.length < rec.sampleRate * 0.5) {
    mozart.set('asleep');
    setStatus('Live preview');
    scheduleRender();
    return;
  }
  const rel = (t) => t - rec.startTime;
  take = {
    rec,
    live: notes.filter((n) => n.end).map((n) => ({ midi: n.midi, start: rel(n.start), end: rel(n.end), amp: 0.6 })),
    click: clickInfo ? { ...clickInfo, downbeat: rel(clickInfo.downbeat) + latency } : null,
  };
  await analyzeTake();
}

ui.record.addEventListener('click', () => (session ? stop() : start()));
ui.clear.addEventListener('click', () => {
  if (session) return;
  notes = [];
  take = null;
  picker.reset();
  setStatus('Live preview');
  scheduleRender();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && session && !wakeLock) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

// ---------- accurate pass ----------
function setStatus(text, isBusy = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('busy', isBusy);
}

async function analyzeTake() {
  const t = take;
  mozart.set('squint');
  setStatus('Mozart is writing it out…', true);
  let result = null;
  try {
    result = await transcribe(t.rec.samples, t.rec.sampleRate, (p) => {
      const pct = `${Math.round(p * 100)}%`;
      mozart.say(pct);
      setStatus(`Mozart is writing it out… ${pct}`, true);
    });
  } catch (err) {
    console.warn('Accurate pass failed, using live notes', err);
  }
  if (take !== t) return; // a new take started meanwhile
  t.source = result && result.length ? 'accurate' : 'live';
  t.notes = t.source === 'accurate' ? result : t.live;
  if (t.click) t.notes = t.notes.filter((n) => n.start > t.click.downbeat - 0.12);
  t.events = onsetEvents(t.notes);
  computeTempo(t);
  layoutTake(t);
  mozart.set('bow');
  mozart.say('Bravo!');
  setTimeout(() => { if (!session && take === t) { mozart.set('asleep'); } }, 2500);
}

function computeTempo(t, { keepBpm = false } = {}) {
  const forcedMeter = ui.meterSel.value === 'auto' ? null : Number(ui.meterSel.value);
  if (t.click && !keepBpm) {
    const bpm = t.click.bpm;
    const beat0 = phaseFor(t.events, bpm, t.click.downbeat);
    t.tempo = { bpm, beat0, meter: forcedMeter || t.click.meter, offset: 0 };
  } else {
    let bpm, beat0;
    if (keepBpm) {
      bpm = t.tempo.bpm;
      beat0 = phaseFor(t.events, bpm);
    } else {
      const est = estimateTempo(t.events);
      bpm = est ? est.bpm : clampBpm(ui.bpm.value);
      beat0 = est ? est.beat0 : (t.events[0]?.t ?? 0);
    }
    const m = detectMeter(t.events, bpm, beat0, forcedMeter);
    t.tempo = { bpm, beat0, meter: m.meter, offset: m.offset };
  }
  ui.bpm.value = String(Math.round(t.tempo.bpm));
}

function layoutTake(t) {
  const built = buildMeasures(t.notes, t.tempo);
  picker.reset();
  let lastChord = '';
  let chordCount = 0;
  const seen = new Set();
  const measures = built.measures.map((bar) => bar.map((piece) => {
    if (piece.rest || !piece.ev) return { slots: piece.slots, rest: true };
    const ev = piece.ev;
    if (!seen.has(ev)) {
      seen.add(ev);
      ev.keys = [...new Set(ev.notes.map((n) => n.midi))].sort((a, b) => a - b);
      const placed = picker.pickChord(ev.keys);
      ev.positions = placed.map((x) => (x.pos ? { str: x.pos.string, fret: x.pos.fret } : null));
      ev.chordName = ev.keys.length >= 2 ? nameChord(ev.keys) : '';
      ev.showChord = !!ev.chordName && ev.chordName !== lastChord;
      if (ev.chordName) { if (ev.showChord) chordCount++; lastChord = ev.chordName; }
    }
    return {
      slots: piece.slots,
      keys: ev.keys,
      positions: ev.positions,
      chord: !piece.tieFromPrev && ev.showChord ? ev.chordName : '',
      tieToNext: piece.tieToNext,
      tieFromPrev: piece.tieFromPrev,
    };
  }));
  t.model = { measures, meter: t.tempo.meter };
  const noteCount = t.notes.length;
  ui.count.textContent = `${noteCount} note${noteCount === 1 ? '' : 's'}`;
  const how = t.source === 'accurate' ? 'Accurate' : 'From live notes (offline)';
  setStatus(`${how} · ♩=${Math.round(t.tempo.bpm)} · ${t.tempo.meter}/4 · ${measures.length} bar${measures.length === 1 ? '' : 's'}${chordCount ? ` · ${chordCount} chord${chordCount === 1 ? '' : 's'}` : ''}`);
  scheduleRender();
}

// ---------- tempo controls ----------
function onTempoEdit(newBpm) {
  const bpm = clampBpm(newBpm);
  ui.bpm.value = String(bpm);
  store.set('bpm', String(bpm));
  if (!take?.events || session) return;
  take.tempo.bpm = bpm;
  computeTempo(take, { keepBpm: true });
  layoutTake(take);
}
ui.bpm.addEventListener('change', () => onTempoEdit(ui.bpm.value));
ui.bpmUp.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) + 1));
ui.bpmDown.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) - 1));
ui.bpmHalf.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) / 2));
ui.bpmDouble.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) * 2));
ui.meterSel.addEventListener('change', () => {
  store.set('meter', ui.meterSel.value);
  if (!take?.events || session) return;
  computeTempo(take, { keepBpm: true });
  layoutTake(take);
});

// ---------- analysis loop ----------
function loop() {
  raf = requestAnimationFrame(loop);
  if (!session) return;
  session.analyser.getFloatTimeDomainData(buf);
  const level = rms(buf);
  const gate = gateFromSens(+ui.sens.value);
  const t = session.ctx.currentTime;

  ui.meter.style.width = levelToPct(level) + '%';
  if (level < gate) { ui.levelStatus.textContent = 'Quiet'; ui.levelStatus.className = 'level-status quiet'; }
  else if (level > 0.5) { ui.levelStatus.textContent = 'Too loud'; ui.levelStatus.className = 'level-status loud'; }
  else { ui.levelStatus.textContent = 'Good'; ui.levelStatus.className = 'level-status good'; }

  let freq = 0, clarity = 0;
  if (level > gate) ({ freq, clarity } = detectPitch(buf, session.ctx.sampleRate));
  tracker.update(t, level, freq, clarity, gate);

  if (countInEnd && t < countInEnd) return; // Mozart is counting in
  if (tracker.cur) { lastSound = t; mozart.set('scribbling'); }
  else if (t - lastSound > 2.5) mozart.set('listening');
  else mozart.set('idle');
}

function showLive(f) {
  if (!f.voiced) { ui.needle.classList.add('off'); return; }
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
    if (take?.model && !session) {
      renderScore(ui.score, take.model);
    } else {
      renderScore(ui.score, previewModel(notes, tracker?.cur || null));
      ui.count.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
    }
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
// Handy for debugging in the console
window.musicScribe = {
  get notes() { return notes; }, get take() { return take; }, get tracker() { return tracker; }, start, stop,
};
