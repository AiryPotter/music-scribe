import { listMics, openMic, looksBluetooth } from './audio.js';
import { detectPitch, rms } from './pitch.js';
import { NoteTracker } from './tracker.js';
import { FretPicker, noteName, stringName, TUNINGS, MAX_CAPO, tuningLetters, noteNameFlat } from './guitar.js';
import { renderScore, previewModel } from './score.js';
import { Mozart } from './mozart.js';
import { Recorder } from './recorder.js';
import { Metronome } from './metronome.js';
import { transcribe, preloadTranscriber } from './transcribe.js';
import { onsetEvents, estimateTempo, phaseFor, detectMeter, quantize, layoutBars, SLOTS_PER_BEAT } from './rhythm.js';
import { nameChord } from './chords.js';
import * as E from './edits.js';

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
  undo: $('undoBtn'), redo: $('redoBtn'),
  tuning: $('tuningSelect'), capo: $('capoSelect'), custom: $('customTuning'),
  ed: $('editor'), edWhat: $('edWhat'), edWhere: $('edWhere'), edPrev: $('edPrev'), edNext: $('edNext'), edClose: $('edClose'),
  edNote: $('edNoteTools'), edRest: $('edRestTools'), edChips: $('edChips'), edPitch: $('edPitch'),
  edString: $('edString'), edLens: $('edLens'), edChord: $('edChord'),
};
const DEFAULT_HINT = ui.hint.textContent;
const DEMO = new URLSearchParams(location.search).has('demo');

const mozart = new Mozart($('mozart'));
let picker = new FretPicker();
let notes = [];          // live preview notes (audio-clock times)
let take = null;         // last finished take: { rec, notes, events, tempo, score, model, source }
let sel = null;          // editor selection (see edits.js)
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

// ---------- tuning + capo ----------
const guitar = {
  id: store.get('tuning', 'standard'),
  capo: Math.max(0, Math.min(MAX_CAPO, Number(store.get('capo', '0')) || 0)),
  custom: (() => {
    try {
      const c = JSON.parse(store.get('customTuning', ''));
      if (Array.isArray(c) && c.length === 6 && c.every((m) => Number.isInteger(m) && m >= 28 && m <= 71)) return c;
    } catch { /* fall through */ }
    return [...TUNINGS.standard.strings];
  })(),
};
if (guitar.id !== 'custom' && !TUNINGS[guitar.id]) guitar.id = 'standard';
function tuningStrings() { return guitar.id === 'custom' ? guitar.custom : TUNINGS[guitar.id].strings; }
function tuningLabel() {
  const name = guitar.id === 'custom' ? 'Custom' : TUNINGS[guitar.id].name;
  return `${name} (${tuningLetters(tuningStrings())})`;
}
function scoreHeader() {
  const parts = [];
  if (guitar.id !== 'standard') parts.push(`Tuning: ${tuningLetters(tuningStrings())}`);
  if (guitar.capo) parts.push(`Capo ${guitar.capo}`);
  return parts.join(' · ');
}
function rebuildPicker() { picker = new FretPicker(tuningStrings(), guitar.capo); }

for (const [id, t] of Object.entries(TUNINGS)) ui.tuning.add(new Option(`${t.name} · ${tuningLetters(t.strings)}`, id));
ui.tuning.add(new Option('Custom…', 'custom'));
for (let c = 0; c <= MAX_CAPO; c++) ui.capo.add(new Option(c ? `Fret ${c}` : 'None', String(c)));
function buildCustomTuning() {
  ui.custom.innerHTML = '';
  guitar.custom.forEach((m, i) => {
    const s = document.createElement('select');
    s.setAttribute('aria-label', `String ${6 - i} (${i === 0 ? 'lowest' : i === 5 ? 'highest' : 'middle'})`);
    for (let x = 28; x <= 71; x++) s.add(new Option(noteNameFlat(x), String(x)));
    s.value = String(m);
    s.addEventListener('change', () => {
      guitar.custom[i] = Number(s.value);
      store.set('customTuning', JSON.stringify(guitar.custom));
      onGuitarChange();
    });
    ui.custom.appendChild(s);
  });
}
function syncGuitarUi() {
  ui.tuning.value = guitar.id;
  ui.capo.value = String(guitar.capo);
  ui.custom.hidden = guitar.id !== 'custom';
  if (guitar.id === 'custom' && !ui.custom.childElementCount) buildCustomTuning();
  ui.tuning.title = tuningLabel();
}
function onGuitarChange() {
  rebuildPicker();
  syncGuitarUi();
  if (take?.score && !session) layoutTake(take);
  else scheduleRender();
}
ui.tuning.addEventListener('change', () => { guitar.id = ui.tuning.value; store.set('tuning', guitar.id); onGuitarChange(); });
ui.capo.addEventListener('change', () => { guitar.capo = Number(ui.capo.value); store.set('capo', String(guitar.capo)); onGuitarChange(); });
rebuildPicker();
syncGuitarUi();

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

  // fresh take (the old one stays reachable with Undo)
  if (take?.score) pushHistory();
  take = null;
  closeEditor();
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

  updateUndoUi();
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
  updateUndoUi();

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
  if (take?.score) pushHistory();
  notes = [];
  take = null;
  closeEditor();
  picker.reset();
  setStatus(history.past.length ? 'Cleared · Undo brings it back' : 'Live preview');
  ui.count.textContent = '0 notes';
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
  const lowest = Math.min(38, Math.min(...tuningStrings()) + guitar.capo); // below this can't be played
  t.notes = t.notes.filter((n) => n.midi >= lowest);
  if (t.click) t.notes = t.notes.filter((n) => n.start > t.click.downbeat - 0.12);
  t.events = onsetEvents(t.notes);
  computeTempo(t);
  requantize(t);
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

/** Snap the take's notes to the grid → the editable score (throws away edits; callers push history first). */
function requantize(t) {
  const q = quantize(t.notes, t.tempo);
  t.score = {
    tempo: { ...t.tempo },
    events: q.events.map((e) => ({ slot: e.slot, len: e.len, notes: e.keys.map((midi) => ({ midi })) })),
  };
}

/** Score → drawable model: bars, ties, tab positions, chord names, tap targets, selection. */
function layoutTake(t, { quiet = false } = {}) {
  const { events, tempo } = t.score;
  const meter = tempo.meter;
  const barSlots = meter * SLOTS_PER_BEAT;
  const bars = layoutBars(events, barSlots);

  // tab positions + chord names, in time order
  picker.reset();
  let lastChord = '';
  let chordCount = 0;
  t.placed = events.map((ev) => {
    E.sortNotes(ev);
    const keys = ev.notes.map((n) => n.midi);
    const placed = picker.pickChord(keys, ev.notes.map((n) => n.str));
    const auto = keys.length >= 2 ? nameChord(keys) : '';
    let show = '';
    if (ev.chord !== undefined) { show = ev.chord; if (show) lastChord = show; }
    else if (auto) { if (auto !== lastChord) show = auto; lastChord = auto; }
    if (show) chordCount++;
    return { keys, positions: placed.map((x) => x.pos), auto, show };
  });

  // tap targets: one per note/chord, one per rest
  t.refs = [];
  const evRef = new Map();
  const isSel = (p) => !!sel && (sel.kind === 'ev'
    ? p.evIdx === sel.idx
    : p.rest && p.at >= sel.at && p.at < sel.at + sel.len);
  const measures = bars.map((bar) => bar.map((p) => {
    if (p.rest) {
      const ref = t.refs.push({ kind: 'rest', at: p.restAt, len: p.restLen }) - 1;
      return { slots: p.slots, rest: true, ref, sel: isSel(p) };
    }
    if (!evRef.has(p.evIdx)) evRef.set(p.evIdx, t.refs.push({ kind: 'ev', idx: p.evIdx }) - 1);
    const pl = t.placed[p.evIdx];
    const selected = isSel(p);
    return {
      slots: p.slots,
      keys: pl.keys,
      positions: pl.positions.map((pos) => (pos ? { str: pos.string, fret: pos.fret } : null)),
      chord: !p.tieFromPrev ? pl.show : '',
      tieToNext: p.tieToNext,
      tieFromPrev: p.tieFromPrev,
      ref: evRef.get(p.evIdx),
      sel: selected,
      focus: selected ? sel.focus : undefined,
      at: p.at,
    };
  }));
  t.pieceStarts = new Map(); // evIdx → slots where each written piece starts (for Untie)
  bars.flat().forEach((p) => { if (!p.rest) (t.pieceStarts.get(p.evIdx) || t.pieceStarts.set(p.evIdx, []).get(p.evIdx)).push(p.at); });

  t.model = { measures, meter, header: scoreHeader() };
  const noteCount = events.reduce((s, ev) => s + ev.notes.length, 0);
  ui.count.textContent = `${noteCount} note${noteCount === 1 ? '' : 's'}`;
  if (!quiet) {
    const how = t.source === 'accurate' ? 'Accurate' : 'From live notes (offline)';
    setStatus(`${how} · ♩=${Math.round(tempo.bpm)} · ${meter}/4 · ${measures.length} bar${measures.length === 1 ? '' : 's'}${chordCount ? ` · ${chordCount} chord${chordCount === 1 ? '' : 's'}` : ''}${t.edited ? ' · edited' : ''}`);
  }
  scheduleRender();
  if (sel) refreshEditor();
}

// ---------- tempo controls ----------
function onTempoEdit(newBpm) {
  const bpm = clampBpm(newBpm);
  ui.bpm.value = String(bpm);
  store.set('bpm', String(bpm));
  if (!take?.events || session) return;
  if (take.score && take.score.tempo.bpm === bpm) return;
  rethinkRhythm(() => { take.tempo.bpm = bpm; });
}
/** Re-read the rhythm (tempo/meter change). Undo-able, since it replaces any note edits. */
function rethinkRhythm(change) {
  const hadEdits = !!take.edited;
  pushHistory();
  change();
  computeTempo(take, { keepBpm: true });
  requantize(take);
  take.edited = false;
  closeEditor();
  layoutTake(take);
  if (hadEdits) setStatus(`${ui.status.textContent} · re-read from the recording (Undo restores your edits)`);
}
ui.bpm.addEventListener('change', () => onTempoEdit(ui.bpm.value));
ui.bpmUp.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) + 1));
ui.bpmDown.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) - 1));
ui.bpmHalf.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) / 2));
ui.bpmDouble.addEventListener('click', () => onTempoEdit(clampBpm(ui.bpm.value) * 2));
ui.meterSel.addEventListener('change', () => {
  store.set('meter', ui.meterSel.value);
  if (!take?.events || session) return;
  rethinkRhythm(() => {});
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
  ui.liveFret.textContent = pos ? `${stringName(pos.stringIndex, picker.strings)} string · fret ${pos.fret}` : 'Outside the guitar’s range';
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
      const m = previewModel(notes, tracker?.cur || null);
      m.header = scoreHeader();
      renderScore(ui.score, m);
      ui.count.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
    }
    const page = ui.score.parentElement;
    if (session) page.scrollTop = page.scrollHeight;
    if (sel && !ui.ed.hidden) requestAnimationFrame(() => keepSelVisible(page));
  }, 120);
}
/** Scroll so the selected note isn't hidden above the page or under the editor tray. */
function keepSelVisible(page) {
  const band = ui.score.querySelector('.sel-band');
  if (!band) return;
  const z = Number(document.documentElement.style.zoom || 1) || 1;
  const b = band.getBoundingClientRect(), pg = page.getBoundingClientRect();
  const trayTop = ui.ed.getBoundingClientRect().top;
  const bottom = Math.min(pg.bottom, trayTop) - 12;
  if (b.top < pg.top) {
    page.scrollTop -= (pg.top - b.top + 12) / z;
  } else if (b.bottom > bottom) {
    const need = b.bottom - bottom;
    const before = page.scrollTop;
    page.scrollTop += Math.min(need, b.top - pg.top - 12) / z;
    const moved = (page.scrollTop - before) * z;
    if (need - moved > 1) window.scrollBy(0, (need - moved) / z);
  }
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (zoom.fit) applyZoom(); scheduleRender(); }, 150);
});

// ---------- undo / redo ----------
const history = { past: [], future: [] };
function snapshot() {
  return { take, score: take?.score ? JSON.stringify(take.score) : null, edited: !!take?.edited };
}
function pushHistory() {
  history.past.push(snapshot());
  if (history.past.length > 150) history.past.shift();
  history.future.length = 0;
  updateUndoUi();
}
function restore(s) {
  const keepSel = s.take === take && sel?.kind === 'ev' ? sel : null; // stay on the same note while undoing
  closeEditor({ relayout: false });
  take = s.take;
  if (take && s.score) {
    take.score = JSON.parse(s.score);
    if (keepSel && keepSel.idx < take.score.events.length) {
      sel = keepSel;
      ui.ed.hidden = false;
      document.body.classList.add('editing');
    }
    take.tempo = { ...take.score.tempo };
    take.edited = s.edited;
    ui.bpm.value = String(Math.round(take.tempo.bpm));
    layoutTake(take);
  } else {
    take = null;
    notes = [];
    setStatus('Live preview');
    ui.count.textContent = '0 notes';
    scheduleRender();
  }
  updateUndoUi();
}
function undo() {
  if (session || busy || !history.past.length) return;
  history.future.push(snapshot());
  restore(history.past.pop());
}
function redo() {
  if (session || busy || !history.future.length) return;
  history.past.push(snapshot());
  restore(history.future.pop());
}
function updateUndoUi() {
  ui.undo.disabled = !history.past.length || !!session;
  ui.redo.disabled = !history.future.length || !!session;
}
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);

// ---------- hear a note while editing ----------
let earCtx = null;
function audition(midis) {
  if (session || !midis?.length) return;
  try { earCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  earCtx.resume?.();
  const t0 = earCtx.currentTime + 0.03;
  midis.forEach((m, k) => {
    const t = t0 + k * 0.025; // a gentle strum
    const osc = earCtx.createOscillator(), lp = earCtx.createBiquadFilter(), g = earCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    lp.frequency.value = 2800;
    const level = 0.22 / Math.sqrt(midis.length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(lp).connect(g).connect(earCtx.destination);
    osc.start(t);
    osc.stop(t + 1.15);
  });
}

// ---------- the note editor (tap a note or rest) ----------
const lenName = (slots) => E.LENGTHS.find(([s]) => s === slots)?.[1] ?? `${slots / 4} beats`;
function whereLabel(slot) {
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT;
  const inBar = slot % barSlots;
  const frac = ['', '¼', '½', '¾'][inBar % SLOTS_PER_BEAT];
  return `Bar ${Math.floor(slot / barSlots) + 1}, beat ${Math.floor(inBar / SLOTS_PER_BEAT) + 1}${frac}`;
}

E.LENGTHS.forEach(([slots, name]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ed-btn';
  b.dataset.len = String(slots);
  b.title = name;
  b.setAttribute('aria-label', name);
  b.innerHTML = E.noteIcon(slots);
  ui.edLens.appendChild(b);
});

function select(ref) {
  if (!ref || !take?.score || session) return;
  if (ref.kind === 'ev') {
    const ev = take.score.events[ref.idx];
    const keep = sel?.kind === 'ev' && sel.idx === ref.idx;
    sel = { kind: 'ev', idx: ref.idx, focus: keep ? sel.focus : ev.notes.length - 1 };
  } else {
    sel = { kind: 'rest', at: ref.at, len: ref.len };
  }
  ui.ed.hidden = false;
  document.body.classList.add('editing');
  layoutTake(take, { quiet: true });
}
function closeEditor({ relayout = true } = {}) {
  const had = !!sel;
  sel = null;
  ui.ed.hidden = true;
  document.body.classList.remove('editing');
  if (had && relayout && take?.score && !session) layoutTake(take, { quiet: true });
}
function currentRefIndex() {
  if (!sel || !take?.refs) return -1;
  return take.refs.findIndex((r) => (sel.kind === 'ev' ? r.kind === 'ev' && r.idx === sel.idx : r.kind === 'rest' && r.at === sel.at));
}
function nav(dir) {
  const i = currentRefIndex();
  const next = take?.refs?.[i + dir];
  if (next) select(next);
}

/** Make a change to the score (undo-able), then redraw. */
function edit(fn, { listen = false } = {}) {
  if (!take?.score || session || !sel) return;
  pushHistory();
  sel = fn(take.score, sel) || sel;
  take.edited = true;
  layoutTake(take);
  if (listen && sel.kind === 'ev') {
    const ev = take.score.events[sel.idx];
    audition(listen === 'chord' ? ev.notes.map((n) => n.midi) : [ev.notes[sel.focus]?.midi]);
  }
}

function refreshEditor() {
  if (!sel || !take?.score) { closeEditor({ relayout: false }); return; }
  const { events } = take.score;
  if (sel.kind === 'ev') {
    const ev = events[sel.idx];
    if (!ev) { closeEditor({ relayout: false }); return; }
    sel.focus = Math.max(0, Math.min(sel.focus, ev.notes.length - 1));
    const pl = take.placed[sel.idx];
    const note = ev.notes[sel.focus];
    const pos = pl.positions[sel.focus];
    ui.edNote.hidden = false;
    ui.edRest.hidden = true;
    ui.edWhat.textContent = pl.show || pl.auto || ev.notes.map((n) => noteName(n.midi)).join(' · ');
    ui.edWhere.textContent = `${whereLabel(ev.slot)} · ${lenName(ev.len)}`;

    // chips: pick which note of a chord to change
    ui.edChips.innerHTML = '';
    if (ev.notes.length > 1) {
      [...ev.notes].map((n, i) => ({ n, i })).reverse().forEach(({ n, i }) => {
        const p = pl.positions[i];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ed-chip' + (i === sel.focus ? ' on' : '');
        b.dataset.focus = String(i);
        b.innerHTML = `${noteName(n.midi)}<small>${p ? `${stringName(p.stringIndex, picker.strings)} · ${p.fret}` : 'no string'}</small>`;
        ui.edChips.appendChild(b);
      });
    }
    ui.edPitch.textContent = noteName(note.midi);
    ui.edString.textContent = pos
      ? `${stringName(pos.stringIndex, picker.strings)} string · fret ${pos.fret}${note.str !== undefined ? ' ✎' : ''}`
      : 'Can’t be played in this tuning';
    const others = new Set(pl.positions.filter((p, i) => p && i !== sel.focus).map((p) => p.stringIndex));
    const strOpts = picker.options(note.midi).filter((o) => !others.has(o.stringIndex));
    ui.ed.querySelectorAll('[data-act="str-"],[data-act="str+"]').forEach((b) => { b.disabled = strOpts.length < 2 && !!pos; });

    const max = E.maxLen(take.score, sel.idx);
    ui.edLens.querySelectorAll('[data-len]').forEach((b) => {
      const len = Number(b.dataset.len);
      b.classList.toggle('on', len === ev.len);
      b.disabled = len > max;
    });
    if (document.activeElement !== ui.edChord) ui.edChord.value = ev.chord ?? '';
    ui.edChord.placeholder = pl.auto ? `auto: ${pl.auto}` : 'none';
    ui.ed.querySelector('[data-act="chord-auto"]').classList.toggle('on', ev.chord === undefined);
    ui.ed.querySelector('[data-act="chord-hide"]').classList.toggle('on', ev.chord === '');
    ui.ed.querySelector('[data-act="add"]').disabled = ev.notes.length >= 6;
    ui.ed.querySelector('[data-act="join"]').disabled = !E.canJoin(take.score, sel.idx);
    ui.ed.querySelector('[data-act="split"]').disabled = (take.pieceStarts.get(sel.idx) || []).length < 2;
  } else {
    ui.edNote.hidden = true;
    ui.edRest.hidden = false;
    ui.edWhat.textContent = 'Rest';
    ui.edWhere.textContent = `${whereLabel(sel.at)} · ${lenName(sel.len)} of silence`;
  }
  const i = currentRefIndex();
  ui.edPrev.disabled = i <= 0;
  ui.edNext.disabled = i < 0 || i >= take.refs.length - 1;
  requestAnimationFrame(() => document.body.style.setProperty('--tray-h', `${ui.ed.offsetHeight}px`));
}

function cycleString(dir) {
  if (sel?.kind !== 'ev') return;
  const ev = take.score.events[sel.idx];
  const pl = take.placed[sel.idx];
  const note = ev.notes[sel.focus];
  const others = new Set(pl.positions.filter((p, i) => p && i !== sel.focus).map((p) => p.stringIndex));
  const opts = picker.options(note.midi).filter((o) => !others.has(o.stringIndex));
  if (!opts.length) return;
  const cur = pl.positions[sel.focus]?.stringIndex;
  const i = opts.findIndex((o) => o.stringIndex === cur);
  const next = i < 0 ? opts[0] : opts[(i + dir + opts.length) % opts.length];
  if (next.stringIndex === cur) return;
  edit((s, x) => E.setString(s, x, next.stringIndex));
}

ui.score.addEventListener('click', (e) => {
  const r = e.target.closest?.('[data-ref]');
  if (!r || !take?.refs || session) return;
  select(take.refs[Number(r.dataset.ref)]);
});
ui.edPrev.addEventListener('click', () => nav(-1));
ui.edNext.addEventListener('click', () => nav(1));
ui.edClose.addEventListener('click', () => closeEditor());
ui.edChips.addEventListener('click', (e) => {
  const b = e.target.closest('[data-focus]');
  if (!b || sel?.kind !== 'ev') return;
  sel.focus = Number(b.dataset.focus);
  layoutTake(take, { quiet: true });
  audition([take.score.events[sel.idx].notes[sel.focus].midi]);
});
ui.edLens.addEventListener('click', (e) => {
  const b = e.target.closest('[data-len]');
  if (b && !b.disabled) edit((s, x) => E.setLength(s, x, Number(b.dataset.len)));
});
ui.edChord.addEventListener('change', () => {
  if (sel?.kind !== 'ev') return;
  const v = ui.edChord.value.trim();
  const auto = take.placed[sel.idx]?.auto;
  edit((s, x) => E.setChord(s, x, !v || v === auto ? undefined : v));
});
ui.edChord.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.edChord.blur(); });

function act(name) {
  if (!sel) return;
  if (sel.kind === 'rest') {
    if (name === 'fill') {
      const midi = E.guessPitch(take.score, sel.at);
      edit((s, x) => E.fillRest(s, x.at, x.len, midi), { listen: 'note' });
    }
    return;
  }
  switch (name) {
    case 'semi-': return edit((s, x) => E.shiftPitch(s, x, -1), { listen: 'note' });
    case 'semi+': return edit((s, x) => E.shiftPitch(s, x, 1), { listen: 'note' });
    case 'oct-': return edit((s, x) => E.shiftPitch(s, x, -12), { listen: 'note' });
    case 'oct+': return edit((s, x) => E.shiftPitch(s, x, 12), { listen: 'note' });
    case 'str-': return cycleString(-1);
    case 'str+': return cycleString(1);
    case 'add': return edit(E.addNote, { listen: 'chord' });
    case 'remove': return edit(E.removeNote);
    case 'rest': return edit(E.makeRest);
    case 'join': return edit(E.join);
    case 'split': return edit((s, x) => E.split(s, x, take.pieceStarts.get(x.idx) || []));
    case 'chord-auto': return edit((s, x) => E.setChord(s, x, undefined));
    case 'chord-hide': return edit((s, x) => E.setChord(s, x, ''));
    case 'listen': return audition(take.score.events[sel.idx].notes.map((n) => n.midi));
    default: return undefined;
  }
}
ui.ed.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) act(b.dataset.act);
});

// keyboard (PC): ↑↓ pitch (Shift = octave), ←→ previous/next, Delete = rest, Enter = add note to a rest, Esc = close
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (!sel || typing || mod || e.altKey) return;
  if (e.key === 'Enter' && (e.target.tagName === 'BUTTON' || sel.kind !== 'rest')) return;
  const keys = {
    ArrowUp: e.shiftKey ? 'oct+' : 'semi+', ArrowDown: e.shiftKey ? 'oct-' : 'semi-',
    Delete: 'rest', Backspace: 'rest', Enter: 'fill',
  };
  if (e.key === 'ArrowLeft') nav(-1);
  else if (e.key === 'ArrowRight') nav(1);
  else if (e.key === 'Escape') closeEditor();
  else if (keys[e.key]) act(keys[e.key]);
  else return;
  e.preventDefault();
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
  get sel() { return sel; }, select, undo, redo, history,
};
