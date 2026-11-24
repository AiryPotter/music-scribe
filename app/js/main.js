import { listMics, openMic, looksBluetooth, IS_IOS, IS_STANDALONE, setAudioSession, wake } from './audio.js';
import { detectPitch, rms } from './pitch.js';
import { NoteTracker } from './tracker.js';
import { FretPicker, noteName, stringName, TUNINGS, MAX_CAPO, tuningLetters, noteNameFlat, setNameKey } from './guitar.js';
import { detectKey, keyName, keyChoices } from './keys.js';
import { renderScore, previewModel } from './score.js';
import { Mozart } from './mozart.js';
import { Recorder } from './recorder.js';
import { Metronome } from './metronome.js';
import { transcribe, preloadTranscriber, cancelTranscription, startStream } from './transcribe.js';
import { onsetEvents, estimateTempo, phaseFor, detectMeter, quantize, layoutBars, SLOTS_PER_BEAT } from './rhythm.js';
import { nameChord } from './chords.js';
import * as E from './edits.js';
import { playPluck } from './pluck.js';
import { Player } from './player.js';
import { Tuner } from './tuner.js';
import { saveTake, listTakes, deleteTake, newTakeId } from './takes.js';
import { removeClickNotes, removePlaybackNotes } from './notes-post.js';
import * as FX from './fixlog.js';
import { createBugReporter } from './bugreport.js';
import { JAM_SIZES, jamSizes, defaultJamSize, nextTop, loopNotes, splitRounds } from './jam.js';

// the last few errors, for bug reports (they stay on this device unless a report is shared)
const recentErrors = [];
window.addEventListener('error', (e) => { recentErrors.push(`${new Date().toLocaleTimeString()} ${e.message || 'error'}${e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : ''}`); recentErrors.splice(0, recentErrors.length - 8); });
window.addEventListener('unhandledrejection', (e) => { recentErrors.push(`${new Date().toLocaleTimeString()} ${e.reason?.message || String(e.reason)}`); recentErrors.splice(0, recentErrors.length - 8); });
import { createExportSheet } from './exportui.js';
import { PROJECT_FORMAT, validateProject, localStamp } from './exporters.js';

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
  meterSel: $('meterSelect'), keySel: $('keySelect'), detailSel: $('detailSelect'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomReset: $('zoomReset'), zoomFit: $('zoomFit'),
  undo: $('undoBtn'), redo: $('redoBtn'), exportBtn: $('exportBtn'), takes: $('takesBtn'), fixes: $('fixesBtn'), play: $('playBtn'), guitarToggle: $('guitarToggle'), guitarTools: $('guitarTools'),
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
let take = null;         // last finished take: { notes, events, tempo, score, model, source } (rec = audio, only until the notes are written)
let sel = null;          // editor selection (see edits.js)
const picked = new Set(); // notes picked with the Select tool (event indexes)
let selectMode = false;   // Select tool: each tap adds/removes a note instead of opening just that one

// ---------- layers: up to 4 parts on one manuscript (melody, backup…), sharing tempo, time and key ----------
// take.layers = [{ name, hue, events, notes, source, mute, vol, thin }]; take.active = the one being edited.
// take.score.events IS the active layer's events (same array), so every editing tool works on it unchanged.
const LAYER_HUES = ['#3b8fd0', '#7b4fb3', '#a3001b', '#1f6b4f']; // sky blue, violet, arterial red, evergreen
const LAYER_FADE = [0.45, 0.45, 0.55, 0.5]; // how solid a faint layer is (red fades to pink, so it stays darker)
const LAYER_HUE_NAMES = ['sky blue', 'violet', 'red', 'green'];
const LAYER_PAN = [0, -0.35, 0.35, -0.15];
const MAX_LAYERS = 4;
const ACTIVE_INK = '#111111'; // the layer you're working on: bold black
let allView = false;          // All: every layer bold in its colour (tap a chip to thin it)
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
  const gName = guitar.id === 'custom' ? `Custom (${tuningLetters(tuningStrings())})` : TUNINGS[guitar.id].name;
  ui.guitarToggle.querySelector('span').textContent = `Guitar: ${gName}${guitar.capo ? ` · Capo ${guitar.capo}` : ''}`;
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
  // ?leak (testing): the click is also "heard" by the demo's mic, the way PC speakers leak into a mic:
  // band-limited, with a speaker-cabinet thump at a fixed low pitch, and short room echoes
  let leak = null;
  if (new URLSearchParams(location.search).has('leak')) {
    leak = ctx.createGain();
    leak.gain.value = 0.6;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const thump = ctx.createBiquadFilter(); thump.type = 'bandpass'; thump.frequency.value = 110; thump.Q.value = 12;
    const thumpGain = ctx.createGain(); thumpGain.gain.value = 9;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(2.2 * x + 0.3 * x * x); }
    shaper.curve = curve;
    leak.connect(shaper);
    shaper.connect(hp).connect(bus);
    leak.connect(thump).connect(thumpGain).connect(bus);
    for (const [ms, g] of [[7, 0.35], [13, 0.25], [23, 0.15]]) {
      const d = ctx.createDelay(0.1); d.delayTime.value = ms / 1000;
      const dg = ctx.createGain(); dg.gain.value = g;
      hp.connect(d).connect(dg).connect(bus);
    }
  }
  return {
    ctx, analyser, source: bus, deviceId: '__demo__', label: 'Demo song', leak,
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

// A take is held in memory while you play, so very long ones could run a phone out of memory.
const REC_LIMIT = Math.max(20, Number(new URLSearchParams(location.search).get('limit')) || 600); // seconds (?limit= is for testing)
const limitText = REC_LIMIT >= 120 ? `${Math.round(REC_LIMIT / 60)}-minute` : `${REC_LIMIT}-second`;
let limitTimers = [];
let hitLimit = false;

async function start({ jamming = false } = {}) {
  if (busy) return;
  if (!jamming) stopJam(); // Begin is its own recording
  jam.holding = jamming;   // (opening the mic closes the editor, which must not stop the loop)
  busy = true;
  ui.record.disabled = true;
  if (!$('tunerSheet').hidden) closeTuner();
  cancelTranscription(); // a new take replaces one still being written out
  flushSave();
  if (!$('takesSheet').hidden) closeTakes();
  endProgress();
  hideToast();
  preloadTranscriber();
  try {
    session = ui.mic.value === '__demo__' ? openDemo() : await openMic(store.get('mic', ''));
    recorder = await Recorder.create(session.ctx, session.source);
    // write the take out while it's played (in memory only), so Cease has only the last bit left to do
    session.stream = startStream(session.ctx.sampleRate);
    session.feedTimer = setInterval(() => { if (session && recorder) session.stream.feed(recorder.takeNew()); }, 1000);
  } catch (err) {
    if (session?.feedTimer) clearInterval(session.feedTimer);
    session?.close?.();
    session = null;
    busy = false;
    jam.holding = false;
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
  if (session.ctx.state !== 'running') ui.liveFret.textContent = 'Tap anywhere to start listening';

  // a song with more than one layer: record into the layer being edited, with the others playing
  const jamSong = jamming ? take : null; // recording over the loop: the song stays as it is
  const song = !jamSong && take?.score && take.layers?.length > 1 ? take : null;
  if (jamSong) {
    closeEditor();
  } else if (song) {
    syncLayer(song);
    pushHistory();
    closeEditor();
  } else {
    // fresh take (the old one stays reachable with Undo)
    if (take?.score) pushHistory();
    take = null;
    closeEditor();
  }
  if (exportSheet.isOpen) exportSheet.close();
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
  const bpm = (song || jamSong) ? (song || jamSong).score.tempo.bpm : clampBpm(ui.bpm.value);
  const meter = (song || jamSong) ? (song || jamSong).score.tempo.meter : ui.meterSel.value === 'auto' ? 4 : Number(ui.meterSel.value);
  countInEnd = 0;
  let clickInfo = null;
  if (jamSong) {
    // the loop plays on another audio clock: find the offset, then start writing at its next top
    const diffs = [];
    for (let i = 0; i < 9; i++) { diffs.push(ctx.currentTime - earCtx.currentTime); await new Promise((r) => setTimeout(r, 12)); }
    const offset = diffs.sort((a, b) => a - b)[4];
    const p = jam.player;
    if (!p.playing) { // stopped while the microphone was opening
      jam.holding = false;
      session.jam = { cancelled: true };
    } else {
      const top = nextTop(p.t0, p.cycleDur, earCtx.currentTime) + offset;
      countInEnd = top;
      clickLag = (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + 0.005;
      session.jam = { song: jamSong, loop: { ...jam.loop }, bpm, meter, top, slotDur: 60 / bpm / SLOTS_PER_BEAT, layers: jamLayers().map((L) => ({ events: L.events })), out: earCtx.outputLatency || 0 };
    }
  } else if (ui.click.checked || song) { // a new layer always gets a one-bar count-in, so it lines up with the others
    const countOnly = !ui.click.checked;
    metro = new Metronome(ctx, {
      bpm, meter, leak: session.leak || null, beats: countOnly ? meter : 0,
      onBeat: (b) => { if (b < meter) mozart.say(String(b + 1)); else if (b === meter) mozart.say(''); },
    });
    clickLag = (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + 0.005;
    const t0 = metro.start(ctx.currentTime + 0.2);
    countInEnd = t0 + meter * (60 / bpm);
    clickInfo = { bpm, meter, downbeat: countInEnd, first: t0, countOnly };
    if (countOnly) setTimeout(() => { if (metro && session) mozart.say(''); }, (countInEnd - ctx.currentTime) * 1000 + 300);
  }
  session.clickInfo = clickInfo;
  if (song) {
    // the other layers play from bar 1 as the count-in ends (headphones keep them out of the mic)
    const slotDur = 60 / bpm / SLOTS_PER_BEAT;
    const playing = song.layers.map((L, k) => ({ L, k })).filter(({ L, k }) => k !== song.active && !L.mute && L.events.length);
    const backing = new Player();
    backing.start(ctx, playing.map(({ L }) => ({ events: L.events, volume: L.vol ?? 1, pan: LAYER_PAN[L.hue] })), bpm, 0, { meter, at: countInEnd });
    session.overdub = {
      song, layer: song.active, bpm, meter, downbeat: countInEnd, backing,
      played: playing.flatMap(({ L }) => L.events.flatMap((ev) => ev.notes.map((n) => ({ midi: n.midi, t: countInEnd + ev.slot * slotDur, dur: ev.len * slotDur })))),
    };
  }
  if (session.play) session.play(countInEnd || ctx.currentTime + 0.3, clickInfo || jamSong ? bpm : 100);

  updateUndoUi();
  ui.record.classList.add('on');
  ui.record.setAttribute('aria-pressed', 'true');
  ui.recordLabel.textContent = 'Cease';
  setStatus(jamSong ? 'Jam: recording from the next time round…' : song ? `Recording ${song.layers[song.active].name} with the other layers · ♩=${Math.round(bpm)} · count-in…`
    : clickInfo ? `Recording with the metronome · ♩=${bpm}` : 'Recording · live preview');
  lastSound = ctx.currentTime;
  mozart.set('idle');
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
  hitLimit = false;
  const warnAt = Math.max(REC_LIMIT - 60, REC_LIMIT / 2);
  limitTimers = [
    setTimeout(() => { if (session) setStatus(`Recording · ${Math.round(REC_LIMIT - warnAt)} seconds left (${limitText} limit per take)`); }, warnAt * 1000),
    setTimeout(() => { if (session) { hitLimit = true; stop(); } }, REC_LIMIT * 1000),
  ];
  scheduleRender();
  loop();
  jam.holding = false;
  if (session.jam?.cancelled) stop(); else if (session.jam) syncJam();
}

async function stop() {
  if (!session || busy) return;
  busy = true;
  limitTimers.forEach(clearTimeout);
  limitTimers = [];
  if (hitLimit) showToast(`Stopped at the ${limitText} limit. Mozart is writing out what you played.`);
  cancelAnimationFrame(raf);
  const ctx = session.ctx;
  tracker?.flush(ctx.currentTime);
  metro?.stop();
  metro = null;
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  let rec = null;
  try { rec = await recorder.stop(); } catch { rec = null; }
  const clickInfo = session.clickInfo;
  const overdub = session.overdub || null;
  const jamRec = session.jam || null;
  clearInterval(session.feedTimer);
  const stream = session.stream || null;
  if (overdub) overdub.stream = stream;
  overdub?.backing.stop(false);
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
    if ((overdub && take === overdub.song) || (jamRec && take)) layoutTake(take);
    stream?.cancel();
    scheduleRender();
    return;
  }
  const rel = (t) => t - rec.startTime;
  if (jamRec) {
    stopJam();
    if (jamRec.cancelled) { stream?.cancel(); if (take?.score) layoutTake(take); return; }
    const live = notes.filter((n) => n.end).map((n) => ({ midi: n.midi, start: rel(n.start), end: rel(n.end), amp: 0.6 }));
    await analyzeJam(jamRec, rec, stream, (jamRec.out || ctx.outputLatency || 0) + (ctx.baseLatency || 0), live);
    return;
  }
  if (overdub) {
    const live = notes.filter((n) => n.end).map((n) => ({ midi: n.midi, start: rel(n.start), end: rel(n.end), amp: 0.6 }));
    await analyzeLayer(overdub, rec, clickInfo, latency, live);
    return;
  }
  take = {
    rec,
    live: notes.filter((n) => n.end).map((n) => ({ midi: n.midi, start: rel(n.start), end: rel(n.end), amp: 0.6 })),
    click: clickInfo ? { ...clickInfo, downbeat: rel(clickInfo.downbeat) + latency, first: rel(clickInfo.first) + latency } : null,
    stream,
  };
  await analyzeTake();
}

ui.record.addEventListener('click', () => (session ? stop() : start()));
ui.clear.addEventListener('click', () => {
  if (session) return;
  const wasWriting = take && !take.score;
  cancelTranscription();
  if (wasWriting) mozart.set('asleep');
  flushSave();
  const hadScore = !!take?.score;
  if (hadScore) pushHistory();
  notes = [];
  take = null;
  closeEditor();
  endProgress();
  picker.reset();
  setStatus('Live preview');
  if (hadScore) showToast('Manuscript cleared', undo);
  updateUndoUi();
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

/** When every click reached the mic, in seconds from the start of the recording. */
function beatTimes(click, untilSecs) {
  const p = 60 / click.bpm, out = [];
  for (let c = click.first ?? click.downbeat; c <= untilSecs + p; c += p) out.push(c);
  return out;
}

async function analyzeTake() {
  const t = take;
  mozart.set('squint');
  setStatus('Mozart is writing it out…', true);
  setProgress(0);
  updateUndoUi();
  let result = null;
  try {
    const recSecs = t.rec.samples.length / t.rec.sampleRate;
    t.clickTimes = t.click ? beatTimes(t.click, recSecs) : null;
    const progress = (p, mode) => {
      const pct = `${Math.round(p * 100)}%`;
      mozart.say(pct);
      if (take === t) setProgress(p, mode === 'slow');
    };
    const t0 = performance.now();
    result = t.stream
      ? await t.stream.finish(t.rec.samples, progress, { clickTimes: t.clickTimes }) // most of it was written while you played
      : await transcribe(t.rec.samples, t.rec.sampleRate, progress, { clickTimes: t.clickTimes });
    t.waitMs = Math.round(performance.now() - t0);
  } catch (err) {
    if (err?.name === 'AbortError') { t.rec = null; return; } // stopped by Clear / Begin
    console.warn('Accurate pass failed, using live notes', err);
  }
  t.rec = null; // the recording is thrown away here: only the written notes are kept
  t.stream = null;
  if (take === t) endProgress();
  updateUndoUi();
  if (take !== t) return; // a new take started meanwhile
  t.source = result && result.length ? 'accurate' : 'live';
  t.notes = t.source === 'accurate' ? result : t.live;
  const lowest = Math.min(38, Math.min(...tuningStrings()) + guitar.capo); // below this can't be played
  t.notes = t.notes.filter((n) => n.midi >= lowest);
  if (t.click) {
    t.notes = t.notes.filter((n) => n.start > t.click.downbeat - 0.12);
    const before = t.notes.length;
    t.notes = removeClickNotes(t.notes, t.clickTimes || beatTimes(t.click, Math.max(0, ...t.notes.map((n) => n.end)) + 1));
    t.clickNotesRemoved = before - t.notes.length;
  }
  t.events = onsetEvents(t.notes);
  computeTempo(t);
  requantize(t);
  t.id = newTakeId();
  t.createdAt = Date.now();
  FX.registerTake(t.id, { source: t.source, notes: t.score.events.reduce((n, e) => n + e.notes.length, 0), bpm: t.score.tempo.bpm, meter: t.score.tempo.meter, tuning: guitar.id, capo: guitar.capo });
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
  const keep = t.score?.key?.manual ? t.score.key : null;
  const q = quantize(t.notes, t.tempo, { simple: ui.detailSel.value !== 'detailed', openStrings: tuningStrings().map((m) => m + guitar.capo) });
  t.score = {
    tempo: { ...t.tempo },
    events: q.events.map((e) => ({ slot: e.slot, len: e.len, notes: e.keys.map((midi) => ({ midi })) })),
  };
  if (keep) t.score.key = keep; else ensureKey(t);
}

/** Score → drawable model: bars, ties, tab positions, chord names, tap targets, selection. */
function layoutTake(t, { quiet = false } = {}) {
  stopPlayback();
  resumeFrom = null;
  if (practice.loopAt && t.score && practice.loopAt.start >= (t.model?.measures.length ?? 1e9) * t.score.tempo.meter * SLOTS_PER_BEAT) practice.loopAt = null;
  if (!t.score.key) ensureKey(t);
  const { events, tempo } = t.score;
  const meter = tempo.meter;
  const fifths = t.score.key.fifths;
  setNameKey(fifths);
  const barSlots = meter * SLOTS_PER_BEAT;
  layersOf(t);
  syncLayer(t);
  const layered = t.layers.length > 1;
  // the other layers, laid out on the same bars (drawn faintly behind, or bold in the All view)
  const others = layered ? t.layers.map((L, k) => ({ L, k })).filter(({ L, k }) => k !== t.active && L.events.length) : [];
  const otherBars = others.map(({ L }) => layoutBars(L.events, barSlots));
  const bars = layoutBars(events, barSlots, Math.max(1, t.score.bars || 0, ...otherBars.map((b) => b.length)));
  const ghosts = others.map(({ L }, j) => {
    while (otherBars[j].length < bars.length) otherBars[j].push([{ slots: barSlots, rest: true }]);
    return {
      color: LAYER_HUES[L.hue],
      fade: LAYER_FADE[L.hue],
      thin: allView ? !!L.thin : true,
      measures: otherBars[j].map((bar) => bar.map((p) => (p.rest
        ? { slots: p.slots, rest: true }
        : { slots: p.slots, keys: L.events[p.evIdx].notes.map((n) => n.midi).sort((a, b) => a - b), tieToNext: p.tieToNext, tieFromPrev: p.tieFromPrev }))),
    };
  });

  // tab positions + chord names, in time order
  picker.reset();
  let lastChord = '';
  let chordCount = 0;
  t.placed = events.map((ev) => {
    E.sortNotes(ev);
    const keys = ev.notes.map((n) => n.midi);
    const placed = picker.pickChord(keys, ev.notes.map((n) => n.str));
    const auto = keys.length >= 2 ? nameChord(keys, fifths) : '';
    let show = '';
    if (ev.chord !== undefined) { show = ev.chord; if (show) lastChord = show; }
    else if (auto) { if (auto !== lastChord) show = auto; lastChord = auto; }
    if (show) chordCount++;
    return { keys, positions: placed.map((x) => x.pos), auto, show };
  });

  // tap targets: one per note/chord, one per rest
  t.refs = [];
  const evRef = new Map();
  const isSel = (p) => (!p.rest && picked.has(p.evIdx)) || (!!sel && (sel.kind === 'ev'
    ? p.evIdx === sel.idx
    : p.rest && p.at >= sel.at && p.at < sel.at + sel.len));
  const measures = bars.map((bar) => bar.map((p) => {
    if (p.rest) {
      const ref = t.refs.push({ kind: 'rest', at: p.restAt, len: p.restLen }) - 1;
      return { slots: p.slots, rest: true, ref, sel: isSel(p), label: `${whereLabel(p.at)}: rest` };
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
      label: p.tieFromPrev ? '' : pieceLabel(events[p.evIdx], pl),
    };
  }));
  t.pieceStarts = new Map(); // evIdx → slots where each written piece starts (for Untie)
  bars.flat().forEach((p) => { if (!p.rest) (t.pieceStarts.get(p.evIdx) || t.pieceStarts.set(p.evIdx, []).get(p.evIdx)).push(p.at); });

  const A = t.layers[t.active];
  t.model = {
    ghosts,
    layerStyle: layered ? { color: allView ? LAYER_HUES[A.hue] : ACTIVE_INK, fade: LAYER_FADE[A.hue], thin: allView && !!A.thin } : null,
    measures, meter, keyFifths: fifths, header: scoreHeader(), label: `Manuscript${t.title ? `: ${t.title}` : ''}, ${measures.length} bar${measures.length === 1 ? '' : 's'}, ${meter}/4 at ${Math.round(tempo.bpm)} beats per minute. Use the arrow keys to move between notes.` };
  layoutVersion++;
  const noteCount = events.reduce((s, ev) => s + ev.notes.length, 0);
  ui.count.textContent = `${noteCount} note${noteCount === 1 ? '' : 's'}${layered ? ` · ${A.name}` : ''}`;
  syncLayerUi();
  if (!quiet) {
    const how = t.source === 'accurate' ? 'Accurate' : 'From live notes (offline)';
    syncKeyUi();
    setStatus(`${how} · ♩=${Math.round(tempo.bpm)} · ${meter}/4 · ${keyName(t.score.key)} · ${measures.length} bar${measures.length === 1 ? '' : 's'}${chordCount ? ` · ${chordCount} chord${chordCount === 1 ? '' : 's'}` : ''}${t.edited ? ' · edited' : ''}`);
  }
  scheduleRender();
  if (sel) refreshEditor();
  refreshTools();
  if (!quiet) scheduleSave();
}

// ---------- key signature ----------
for (const k of keyChoices()) ui.keySel.add(new Option(k.label, k.value));
/** Work out the key for a take unless the person chose one. */
function ensureKey(t, { redetect = false } = {}) {
  if (!t?.score) return;
  if (t.score.key?.manual && !redetect) return;
  const k = detectKey(t.score.events);
  t.score.key = { fifths: k.fifths, mode: k.mode, manual: false };
}
function syncKeyUi() {
  const k = take?.score?.key;
  ui.keySel.value = k?.manual ? `${k.fifths}:${k.mode}` : 'auto';
  ui.keySel.options[0].textContent = k && !k.manual ? `Auto (${keyName(k)})` : 'Auto';
}
ui.keySel.addEventListener('change', () => {
  if (!take?.score || session) return;
  pushHistory();
  if (ui.keySel.value === 'auto') ensureKey(take, { redetect: true });
  else {
    const [f, mode] = ui.keySel.value.split(':');
    take.score.key = { fifths: Number(f), mode, manual: true };
  }
  layoutTake(take);
});

// ---------- detail: Simple (clean, for capturing ideas) or Detailed ----------
ui.detailSel.value = store.get('detail', 'simple') === 'detailed' ? 'detailed' : 'simple';
ui.detailSel.addEventListener('change', () => {
  store.set('detail', ui.detailSel.value);
  if (!take?.events || session) return;
  rethinkRhythm(() => {}); // re-writes the take at the new detail (Undo brings back the old page)
});

// ---------- tempo controls ----------
function onTempoEdit(newBpm) {
  if (take?.layers?.length > 1) { ui.bpm.value = String(Math.round(take.score.tempo.bpm)); return; } // shared by every layer
  const bpm = clampBpm(newBpm);
  ui.bpm.value = String(bpm);
  store.set('bpm', String(bpm));
  if (!take?.events || session) return;
  if (take.score && take.score.tempo.bpm === bpm) return;
  const from = take.score?.tempo.bpm;
  rethinkRhythm(() => { take.tempo.bpm = bpm; });
  if (from) logFix({ kind: 'tempo', from: Math.round(from), to: bpm, ratio: Math.abs(bpm / from - 0.5) < 0.02 ? 0.5 : Math.abs(bpm / from - 2) < 0.04 ? 2 : +(bpm / from).toFixed(2) });
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
  const from = take.score?.tempo.meter;
  rethinkRhythm(() => {});
  if (from && take.score.tempo.meter !== from) logFix({ kind: 'meter', from, to: take.score.tempo.meter });
});

// ---------- analysis loop ----------
let clickLag = 0; // how long a tick takes to come back in through the mic (output + input latency)
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

  // the click leaks into the mic through speakers: ignore the instant of each tick (and its echo)
  const tickAt = metro ? metro.lastTickBefore(t - clickLag) : -Infinity;
  const inTick = t - clickLag - tickAt < 0.09;
  let freq = 0, clarity = 0;
  if (level > gate && !inTick) ({ freq, clarity } = detectPitch(buf, session.ctx.sampleRate));
  if (!inTick) tracker.update(t, level, freq, clarity, gate);

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
    const empty = !take && !notes.length && !session;
    $('emptyHint').hidden = !empty;
    ui.score.hidden = empty;
    $('scoreTools').hidden = empty;
    if (empty) {
      ui.exportBtn.disabled = true;
      ui.play.disabled = true;
      $('practice').hidden = true;
      return;
    }
    const focusRef = ui.score.contains(document.activeElement) ? document.activeElement.dataset?.ref : null;
    if (take?.model && (!session || session.jam)) {
      renderScore(ui.score, take.model);
    } else {
      setNameKey(0);
      const m = previewModel(notes, tracker?.cur || null);
      m.header = scoreHeader();
      renderScore(ui.score, m);
      ui.count.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
    }
    if (focusRef != null) {
      const again = (sel && ui.score.querySelector('.hit[tabindex="0"]')) || ui.score.querySelector(`.hit[role="button"][data-ref="${focusRef}"]`);
      if (again) { ui.score.querySelectorAll('.hit[tabindex="0"]').forEach((h) => h.setAttribute('tabindex', '-1')); again.setAttribute('tabindex', '0'); again.focus({ preventScroll: true }); }
    }
    const page = ui.score.parentElement;
    if (session && !session.jam) page.scrollTop = page.scrollHeight;
    ui.exportBtn.disabled = !(take?.model && !session);
    ui.play.disabled = ui.exportBtn.disabled;
    $('practice').hidden = ui.play.disabled;
    if (player.playing) showPlayhead(player.shown);
    if (sel && !ui.ed.hidden) requestAnimationFrame(() => keepSelVisible(page));
  }, 120);
}
/** Scroll so the selected note isn't hidden above the page or under the editor tray. */
function keepSelVisible(page) {
  const band = ui.score.querySelector('.sel-band');
  if (!band) return;
  const z = Number(document.documentElement.style.zoom || 1) || 1;
  const b = band.getBoundingClientRect(), pg = page.getBoundingClientRect();
  const trayTop = docked() ? Infinity : ui.ed.getBoundingClientRect().top; // (docked on the right: nothing covers the page)
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
  syncLayer();
  return {
    take, score: take?.score ? JSON.stringify(take.score) : null, edited: !!take?.edited,
    // layers: their written notes as text, the raw notes by reference (they never change in place)
    layers: take?.layers ? JSON.stringify(take.layers.map(({ notes: _n, ...L }) => L)) : null,
    raw: take?.layers ? take.layers.map((L) => L.notes) : null,
    active: take?.active ?? 0,
  };
}
function pushHistory() {
  history.past.push(snapshot());
  if (history.past.length > 150) history.past.shift();
  history.future.length = 0;
  updateUndoUi();
}
function restore(s) {
  hideToast();
  const keepSel = s.take === take && sel?.kind === 'ev' ? sel : null; // stay on the same note while undoing
  closeEditor({ relayout: false });
  take = s.take;
  if (take && s.score) {
    take.score = JSON.parse(s.score);
    if (s.layers) {
      take.layers = JSON.parse(s.layers).map((L, k) => ({ ...L, notes: s.raw[k] || [] }));
      take.active = Math.min(s.active, take.layers.length - 1);
      const L = take.layers[take.active];
      L.events = take.score.events; // the page edits the active layer through take.score
      take.notes = L.notes;
      take.source = L.source;
    } else {
      take.layers = null;
      take.active = 0;
    }
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
/** True while the accurate pass is running on the take that's on the page. */
function writing() { return !!take && ((!take.score && !!take.rec) || !!take.overdubbing); }
const WRITING_MSG = 'Mozart is still writing. Wait a moment, or tap Clear to stop him.';
function undo() {
  if (writing()) { showToast(WRITING_MSG); return; }
  if (session || busy || !history.past.length) return;
  if (take?.id) FX.unrecord(take.id, history.past.length);
  history.future.push(snapshot());
  restore(history.past.pop());
  refreshFixCount();
}
function redo() {
  if (writing()) { showToast(WRITING_MSG); return; }
  if (session || busy || !history.future.length) return;
  history.past.push(snapshot());
  restore(history.future.pop());
}
function updateUndoUi() {
  ui.undo.disabled = !history.past.length || !!session || writing();
  ui.redo.disabled = !history.future.length || !!session || writing();
}
ui.undo.addEventListener('click', undo);
ui.redo.addEventListener('click', redo);

// ---------- hear notes (tap a note, or while editing) ----------
let earCtx = null;
function audition(midis) {
  if (session || !midis?.length || midis.some((m) => m === undefined)) return;
  setAudioSession('playback'); // iPhone: play even when the silent switch is on
  try { earCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  wake(earCtx);
  playPluck(earCtx, midis);
}

// ---------- small message with an Undo button ----------
let toastTimer = 0;
function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }
function showToast(text, onAction) {
  $('toastText').textContent = text;
  $('toastBtn').hidden = !onAction; // a plain notice has no button
  $('toastBtn').onclick = () => { hideToast(); onAction?.(); };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}

// ---------- progress on the manuscript while Mozart writes ----------
function setProgress(p, slow = false) {
  const pct = Math.round(p * 100);
  $('scoreProgress').hidden = false;
  $('scoreProgressFill').style.width = `${pct}%`;
  $('scoreProgress').querySelector('.sp-bar').setAttribute('aria-valuenow', String(pct));
  $('scoreProgressText').textContent = slow ? `${pct}% · slow mode (no graphics chip) · Clear to stop` : `${pct}%`;
  ui.record.classList.add('writing');
}
function endProgress() {
  $('scoreProgress').hidden = true;
  ui.record.classList.remove('writing');
}

// editor tray: String, Chord name and Tie live behind "More"
function setMore(open) {
  $('edMore').hidden = !open;
  $('edMoreBtn').setAttribute('aria-expanded', String(open));
  $('edMoreBtn').classList.toggle('on', open);
  store.set('edMore', open ? '1' : '0');
  requestAnimationFrame(() => document.body.style.setProperty('--tray-h', `${ui.ed.offsetHeight}px`));
}
$('edMoreBtn').addEventListener('click', () => setMore($('edMore').hidden));
setMore(store.get('edMore', '0') === '1');

// ---------- practice options: speed, loop, click (playback only) ----------
const practice = {
  speed: Math.max(40, Math.min(100, Number(store.get('prSpeed', '100')) || 100)),
  click: store.get('prClick', '0') === '1',
  bars: [1, 2, 4].includes(Number(store.get('prBars', '1'))) ? Number(store.get('prBars', '1')) : 1,
  loop: false,
  loopAt: null, // { start, end } in slots, chosen when Loop is turned on or Play is pressed
};
function loopRange(fromSlot) {
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT;
  const start = Math.floor(fromSlot / barSlots) * barSlots;
  return { start, end: start + practice.bars * barSlots, barSlots };
}
function syncPractice() {
  $('prSpeed').value = String(practice.speed);
  $('prSpeedOut').textContent = `${practice.speed}%`;
  $('prClick').checked = practice.click;
  $('prLoop').setAttribute('aria-pressed', String(practice.loop));
  $('prLoop').classList.toggle('on', practice.loop);
  $('practice').querySelectorAll('[data-bars]').forEach((b) => b.classList.toggle('on', Number(b.dataset.bars) === practice.bars));
  let hint = '';
  if (practice.loop && practice.loopAt && take?.score) {
    const bs = take.score.tempo.meter * SLOTS_PER_BEAT;
    const a = practice.loopAt.start / bs + 1, b = practice.loopAt.end / bs;
    hint = a === b ? `Looping bar ${a}` : `Looping bars ${a}–${b}`;
  } else if (practice.loop) hint = 'Tap a note to choose where the loop starts';
  $('prHint').textContent = hint;
  const parts = [`${practice.speed}%`];
  if (practice.loop) parts.push(`Loop ${practice.bars} bar${practice.bars === 1 ? '' : 's'}`);
  if (practice.click) parts.push('Metronome');
  $('practiceToggle').querySelector('span').textContent = `Practice: ${parts.join(' · ')}`;
}
/** Change a practice setting; if music is playing, carry on from the same note with the new setting. */
function changePractice(fn) {
  fn();
  syncPractice();
  if (player.playing) {
    const at = player.position;
    stopPlayback();
    resumeFrom = at;
    togglePlay();
  }
}
$('prSpeed').addEventListener('input', () => { practice.speed = Number($('prSpeed').value); $('prSpeedOut').textContent = `${practice.speed}%`; });
$('prSpeed').addEventListener('change', () => changePractice(() => store.set('prSpeed', String(practice.speed))));
$('prClick').addEventListener('change', () => changePractice(() => { practice.click = $('prClick').checked; store.set('prClick', practice.click ? '1' : '0'); }));
$('prLoop').addEventListener('click', () => changePractice(() => {
  practice.loop = !practice.loop;
  if (practice.loop && take?.score) {
    const fromSlot = sel?.kind === 'ev' ? take.score.events[sel.idx].slot : sel?.kind === 'rest' ? sel.at
      : player.playing ? player.position : practice.loopAt?.start ?? 0;
    practice.loopAt = loopRange(fromSlot);
  }
}));
$('practice').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bars]');
  if (!b) return;
  changePractice(() => {
    practice.bars = Number(b.dataset.bars);
    store.set('prBars', String(practice.bars));
    if (practice.loopAt && take?.score) practice.loopAt = loopRange(practice.loopAt.start);
  });
});
$('practiceToggle').addEventListener('click', () => {
  const open = $('practice').classList.toggle('open');
  $('practiceToggle').setAttribute('aria-expanded', String(open));
});
syncPractice();

// ---------- playback (plays the written notes, never a recording) ----------
let resumeFrom = null; // event index to continue from after Pause
let lastPlayhead = null;
function showPlayhead(evIdx) {
  lastPlayhead?.classList.remove('playing');
  lastPlayhead = null;
  if (evIdx < 0 || !take?.refs) return;
  const ref = take.refs.findIndex((r) => r.kind === 'ev' && r.idx === evIdx);
  const rect = ui.score.querySelector(`.hit[data-ref="${ref}"]`);
  if (!rect) return;
  rect.classList.add('playing');
  lastPlayhead = rect;
  // keep the sounding note on screen inside the manuscript page
  const page = ui.score.parentElement;
  const z = Number(document.documentElement.style.zoom || 1) || 1;
  const b = rect.getBoundingClientRect(), pg = page.getBoundingClientRect();
  if (b.bottom > pg.bottom - 8 || b.top < pg.top) page.scrollTop += (b.top - pg.top - 16) / z;
}
const player = new Player({
  onStep: showPlayhead,
  onEnd: (finished) => {
    ui.play.textContent = '▶︎';
    ui.play.setAttribute('aria-label', 'Play');
    ui.play.classList.remove('on');
    if (finished) resumeFrom = null;
    if (!session && !busy) mozart.set('asleep');
  },
});
// Jam: loops some bars while you play along (and can record you); see the Jam section below
const jam = { player: new Player({ onStep: (i) => showPlayhead(i) }), size: 0, from: 1, loop: null, rounds: [], song: null, holding: false, timer: 0, hearing: null };
function stopPlayback() {
  if (player.playing) player.stop(false);
  if (!jam.holding && !session) stopJam();
}
/** What ▶ plays: every layer that isn't muted, each at its volume and place left/right. */
function playLayers() {
  if (!take?.score) return [];
  const many = layersOf(take).length > 1;
  return take.layers.map((L, k) => ({
    events: k === take.active ? take.score.events : L.events,
    active: k === take.active,
    volume: L.mute ? 0 : L.vol ?? 1,
    pan: many ? LAYER_PAN[L.hue] : 0,
  })).filter((x) => x.volume > 0 && x.events.length);
}
function togglePlay() {
  if (!session) stopJam();
  if (!take?.score || session) return;
  if (!take.layers?.some((L, k) => (k === take.active ? take.score.events : L.events).length) && !take.score.events.length) return;
  if (player.playing) { // pause: remember where we were
    const at = player.position;
    player.stop(false);
    resumeFrom = at;
    return;
  }
  const events = take.score.events;
  const layers = playLayers();
  if (!layers.length) { showToast('Every layer is muted. Tap 🔇 on a layer to hear it.'); return; }
  let from = resumeFrom ?? 0; // in slots
  if (sel?.kind === 'ev') from = events[sel.idx].slot;
  else if (sel?.kind === 'rest') from = sel.at;
  if (practice.loop && (sel || !practice.loopAt)) { practice.loopAt = loopRange(from); syncPractice(); }
  const loop = practice.loop && practice.loopAt ? { start: practice.loopAt.start, end: practice.loopAt.end } : null;
  if (loop && !(from >= loop.start && from < loop.end)) from = loop.start;
  if (sel) closeEditor(); // (redraws, which also clears resumeFrom)
  if (exportSheet.isOpen) exportSheet.close();
  setAudioSession('playback');
  try { earCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  wake(earCtx);
  player.start(earCtx, layers, take.score.tempo.bpm, from, { speed: practice.speed / 100, click: practice.click, meter: take.score.tempo.meter, loop });
  ui.play.textContent = '❚❚';
  ui.play.setAttribute('aria-label', 'Pause');
  ui.play.classList.add('on');
  mozart.set('idle');
}
ui.play.addEventListener('click', togglePlay);
ui.guitarToggle.addEventListener('click', () => {
  const open = ui.guitarTools.classList.toggle('open');
  ui.guitarToggle.setAttribute('aria-expanded', String(open));
});

// ---------- layers ----------
/** Make sure a take has its list of layers (a take starts as one layer, "Melody"). */
function layersOf(t) {
  if (!t.layers?.length) t.layers = [{ name: 'Melody', hue: 0, events: t.score.events, notes: t.notes || [], source: t.source, mute: false, vol: 1, thin: false }];
  if (!(t.active >= 0 && t.active < t.layers.length)) t.active = 0;
  return t.layers;
}
/** The page edits take.score.events: keep the active layer pointing at what's on the page. */
function syncLayer(t = take) {
  if (!t?.score || !t.layers?.length) return;
  const L = t.layers[t.active];
  L.events = t.score.events;
  if (t.notes) L.notes = t.notes;
  if (t.source) L.source = t.source;
}
/** Work on another layer (it turns bold black; the one you leave goes faint in its colour). */
function useLayer(k) {
  if (!take?.score || session || writing() || k === take.active || !take.layers?.[k]) return;
  syncLayer();
  closeEditor({ relayout: false });
  take.active = k;
  const L = take.layers[k];
  take.score.events = L.events;
  take.notes = L.notes;
  take.source = L.source;
  take.events = onsetEvents(L.notes || []);
  layoutTake(take, { quiet: true });
  scheduleSave();
}
function addLayer() {
  if (!take?.score || session || writing() || layersOf(take).length >= MAX_LAYERS) return;
  syncLayer();
  pushHistory();
  const used = new Set(take.layers.map((L) => L.hue));
  const hue = [0, 1, 2, 3].find((h) => !used.has(h));
  const name = `Layer ${take.layers.length + 1}`;
  take.layers.push({ name, hue, events: [], notes: [], source: 'empty', mute: false, vol: 1, thin: false });
  take.edited = true;
  useLayer(take.layers.length - 1);
  layoutTake(take);
  setStatus(`${name} added · tap Begin to record it while the others play (headphones help), or tap a rest to write notes in`);
}
/**
 * Harmony: a new layer that copies the one you're on, every note moved up a 3rd (steps = 2) or a
 * 6th (steps = 5) along the song's key, so it stays in key (E → G♯ in E major, F♯ → A…).
 */
function addHarmony(steps) {
  if (!take?.score || session || writing() || layersOf(take).length >= MAX_LAYERS) return;
  syncLayer();
  const src = take.layers[take.active];
  if (!src.events.length) { showToast('This layer has no notes to harmonise yet.'); return; }
  const fifths = take.score.key?.fifths ?? 0;
  const up = (m) => { let x = m; for (let i = 0; i < steps; i++) x = E.keyStep(x, 1, fifths); while (x > 86) x -= 12; return x; };
  const events = src.events.map((ev) => {
    const notes = [...new Set(ev.notes.map((n) => up(n.midi)))].sort((a, b) => a - b).map((midi) => ({ midi }));
    return { slot: ev.slot, len: ev.len, notes };
  });
  pushHistory();
  const used = new Set(take.layers.map((L) => L.hue));
  const hue = [0, 1, 2, 3].find((h) => !used.has(h));
  const name = `${src.name} · ${steps === 2 ? '3rd' : '6th'} up`.slice(0, 24);
  take.layers.push({ name, hue, events, notes: [], source: 'harmony', mute: false, vol: 0.8, thin: false });
  take.edited = true;
  useLayer(take.layers.length - 1);
  layoutTake(take);
  setStatus(`${name} added · ▶ plays it with the others · edit any note, or Undo to take it away`);
  audition(events[0].notes.map((n) => n.midi).concat(src.events[0].notes.map((n) => n.midi)));
}
function deleteLayer() {
  if (!take?.score || session || writing() || !(take.layers?.length > 1)) return;
  syncLayer();
  pushHistory();
  const gone = take.layers[take.active];
  take.layers.splice(take.active, 1);
  const k = Math.max(0, take.active - 1);
  take.active = -1; // so useLayer() switches
  take.score.events = take.layers[k].events;
  take.active = k;
  const L = take.layers[k];
  take.notes = L.notes;
  take.source = L.source;
  take.events = onsetEvents(L.notes || []);
  take.edited = true;
  closeEditor({ relayout: false });
  layoutTake(take);
  showToast(`Deleted “${gone.name}”`, undo);
}
/** Mute/volume/name/thin: how a layer sounds and looks (no Undo needed; saved with the song). */
function changeLayer(k, fn, { replay = false } = {}) {
  const L = take?.layers?.[k];
  if (!L) return;
  fn(L);
  const again = jam.player.playing && !session && !jam.hearing; // keep the loop going with the new mix
  if (again) { stopJam(); layoutTake(take, { quiet: true }); scheduleSave(); startJam(); return; }
  if (replay && player.playing) { const at = player.position; stopPlayback(); resumeFrom = at; togglePlay(); return; }
  layoutTake(take, { quiet: true });
  scheduleSave();
}
function syncLayerUi() {
  renderMix();
  syncJam();
  const bar = $('layerBar');
  const has = !!take?.score && !session;
  bar.hidden = !has;
  const layered = has && take.layers?.length > 1;
  // tempo, time and detail are shared by every layer once there are several
  for (const el of [ui.bpm, ui.bpmUp, ui.bpmDown, ui.bpmHalf, ui.bpmDouble, ui.meterSel, ui.detailSel]) {
    el.disabled = !!layered;
    el.title = layered ? 'Shared by every layer: set it before adding layers' : '';
  }
  if (!has) return;
  const chips = $('layerChips');
  chips.innerHTML = '';
  take.layers.forEach((L, k) => {
    const on = k === take.active;
    const chip = document.createElement('span');
    chip.className = `layer-chip${on ? ' on' : ''}${allView && L.thin ? ' thin' : ''}${L.mute ? ' muted' : ''}`;
    chip.style.setProperty('--layer', LAYER_HUES[L.hue]);
    const what = allView ? (L.thin ? 'thin: tap to make it bold' : 'bold: tap to make it thin') : on ? 'the layer you are editing' : 'tap to edit this layer';
    chip.innerHTML = `<button type="button" class="lc-main" data-layer="${k}" aria-pressed="${on}" title="${escHtml(L.name)} (${LAYER_HUE_NAMES[L.hue]}): ${what}"><i class="lc-dot" aria-hidden="true"></i>${escHtml(L.name)}</button>`
      + (layered ? `<button type="button" class="lc-mute" data-mute="${k}" aria-pressed="${!!L.mute}" aria-label="${L.mute ? 'Unmute' : 'Mute'} ${escHtml(L.name)}" title="${L.mute ? 'Muted: tap to hear it' : 'Tap to mute'}">${L.mute ? '🔇' : '🔊'}</button>` : '');
    chips.appendChild(chip);
  });
  if (layered) {
    const all = document.createElement('button');
    all.type = 'button';
    all.className = `layer-chip all${allView ? ' on' : ''}`;
    all.dataset.all = '1';
    all.setAttribute('aria-pressed', String(allView));
    all.title = allView ? 'Back to editing one layer' : 'See every layer bold in its colour';
    all.textContent = 'All';
    chips.appendChild(all);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'layer-chip add';
  add.dataset.add = '1';
  add.disabled = take.layers.length >= MAX_LAYERS || writing();
  add.title = add.disabled ? 'Up to 4 layers' : 'Add a layer: record a backup part with the others playing';
  add.textContent = '+ Layer';
  chips.appendChild(add);
  // Harmony: copy this layer a 3rd or 6th up in the key
  const full = take.layers.length >= MAX_LAYERS || writing() || !take.score.events.length;
  for (const [steps, label] of [[2, '+ 3rd'], [5, '+ 6th']]) {
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'layer-chip add harmony';
    h.dataset.harmony = String(steps);
    h.disabled = full;
    h.textContent = label;
    h.title = full ? (take.score.events.length ? 'Up to 4 layers' : 'This layer has no notes yet')
      : `Harmony: a new layer that copies ${take.layers[take.active].name} a ${steps === 2 ? '3rd' : '6th'} higher, in the key`;
    chips.appendChild(h);
  }
  $('layerRow').hidden = !layered;
  if (layered) {
    const L = take.layers[take.active];
    if (document.activeElement !== $('layerName')) $('layerName').value = L.name;
    $('layerVol').value = String(Math.round((L.vol ?? 1) * 100));
    $('layerHint').textContent = allView
      ? 'All layers: tap a layer to make it thin or bold. Tap All again to go back to editing one.'
      : `Editing ${L.name} (bold black). Begin records ${L.name} again with the others playing.`;
  } else $('layerHint').textContent = '';
}
$('layerChips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !take?.score || session) return;
  if (b.dataset.add) return addLayer();
  if (b.dataset.harmony) return addHarmony(Number(b.dataset.harmony));
  if (b.dataset.all) { allView = !allView; store.set('allView', allView ? '1' : '0'); layoutTake(take, { quiet: true }); return; }
  if (b.dataset.mute !== undefined) return changeLayer(Number(b.dataset.mute), (L) => { L.mute = !L.mute; }, { replay: true });
  const k = Number(b.dataset.layer);
  if (allView) return changeLayer(k, (L) => { L.thin = !L.thin; });
  useLayer(k);
});
$('layerName').addEventListener('change', () => {
  const v = $('layerName').value.trim().slice(0, 24);
  changeLayer(take?.active, (L) => { L.name = v || L.name; });
});
$('layerName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('layerName').blur(); });
$('layerVol').addEventListener('change', () => changeLayer(take?.active, (L) => { L.vol = Number($('layerVol').value) / 100; }, { replay: true }));
$('layerDelete').addEventListener('click', deleteLayer);
allView = store.get('allView', '0') === '1';

/**
 * Write out a layer recorded with the others playing: same tempo and bars as the song (bar 1 =
 * the end of the count-in), and the other layers' notes that leaked into the mic taken out.
 */
async function analyzeLayer(od, rec, click, latency, live) {
  const song = od.song;
  if (take !== song) return;
  const L = song.layers[od.layer];
  song.overdubbing = true;
  updateUndoUi();
  syncLayerUi();
  mozart.set('squint');
  setStatus(`Mozart is writing out ${L.name}…`, true);
  setProgress(0);
  const rel = (t) => t - rec.startTime;
  const downbeat = rel(od.downbeat) + latency;
  const p = 60 / od.bpm;
  const recSecs = rec.samples.length / rec.sampleRate;
  const clickTimes = !click ? null : click.countOnly
    ? Array.from({ length: od.meter }, (_, k) => downbeat - (od.meter - k) * p)
    : beatTimes({ ...click, first: rel(click.first) + latency, downbeat }, recSecs);
  let result = null;
  try {
    const progress = (x, mode) => { mozart.say(`${Math.round(x * 100)}%`); if (take === song) setProgress(x, mode === 'slow'); };
    result = od.stream
      ? await od.stream.finish(rec.samples, progress, { clickTimes })
      : await transcribe(rec.samples, rec.sampleRate, progress, { clickTimes });
  } catch (err) {
    if (err?.name === 'AbortError') { song.overdubbing = false; return; }
    console.warn('Accurate pass failed, using live notes', err);
  }
  rec.samples = null; // the recording is thrown away here: only the written notes are kept
  song.overdubbing = false;
  if (take === song) endProgress();
  updateUndoUi();
  if (take !== song) return;
  const source = result && result.length ? 'accurate' : 'live';
  let got = source === 'accurate' ? result : live;
  const lowest = Math.min(38, Math.min(...tuningStrings()) + guitar.capo);
  got = got.filter((n) => n.midi >= lowest && n.start > downbeat - 0.12);
  if (click && !click.countOnly) got = removeClickNotes(got, clickTimes);
  const before = got.length;
  got = removePlaybackNotes(got, od.played.map((x) => ({ midi: x.midi, t: rel(x.t) + latency, dur: x.dur })));
  const leaked = before - got.length;
  const tempo = { bpm: od.bpm, beat0: downbeat, meter: od.meter, offset: 0 };
  const q = quantize(got, tempo, { simple: ui.detailSel.value !== 'detailed', openStrings: tuningStrings().map((m) => m + guitar.capo), anchor: true });
  L.events = q.events.map((e) => ({ slot: e.slot, len: e.len, notes: e.keys.map((midi) => ({ midi })) }));
  L.notes = got;
  L.source = source;
  if (song.active === od.layer) { song.score.events = L.events; song.notes = got; song.source = source; song.events = onsetEvents(got); }
  song.edited = true;
  layoutTake(song);
  setStatus(`${L.name} written · ${L.events.length} note${L.events.length === 1 ? '' : 's'}${leaked ? ` · ${leaked} note${leaked === 1 ? '' : 's'} from the other layers taken out` : ''} · ▶ plays them all together`);
  mozart.set('bow');
  mozart.say('Bravo!');
  setTimeout(() => { if (!session && take === song) mozart.set('asleep'); }, 2500);
}

// ---------- Jam: loop the melody, play along, record when ready, keep the best time round ----------
function songBars() {
  if (!take?.score) return 0;
  const end = Math.max(0, ...layersOf(take).flatMap((L, k) => (k === take.active ? take.score.events : L.events)).map((e) => e.slot + e.len));
  return Math.max(end ? take.score.bars || 0 : 0, Math.ceil(end / (take.score.tempo.meter * SLOTS_PER_BEAT)));
}
/** What the loop plays: every layer that isn't muted. */
function jamLayers() {
  return playLayers().filter((L) => L.events.some((e) => e.slot >= jam.loop.start && e.slot < jam.loop.end)); // (the player picks out the bars, so the cursor keeps its place)
}
/** Keep the loop's size and place sensible for the song on the page. */
function fitJam() {
  const bars = songBars();
  if (jam.song !== take) { jam.song = take; jam.size = 0; jam.from = 1; jam.rounds = []; }
  if (!bars) return 0;
  if (!jamSizes(bars).includes(jam.size)) jam.size = defaultJamSize(bars);
  jam.from = Math.max(1, Math.min(jam.from, Math.max(1, bars - jam.size + 1)));
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT;
  jam.loop = { start: (jam.from - 1) * barSlots, end: (jam.from - 1 + jam.size) * barSlots };
  return bars;
}
function syncJam() {
  const rec = !!session?.jam;
  const bars = take?.score && !writing() && (!session || rec) ? fitJam() : 0;
  $('jamBar').hidden = !bars;
  if (!bars) return;
  const on = jam.player.playing && !jam.hearing;
  const ok = jamSizes(bars);
  $('jamSizes').innerHTML = JAM_SIZES.map((n) => `<button type="button" class="ed-btn seg${n === jam.size ? ' on' : ''}" data-size="${n}" aria-pressed="${n === jam.size}"${ok.includes(n) && !rec ? '' : ' disabled'}>${n}</button>`).join('') + `<span class="jam-label">bar${jam.size === 1 ? '' : 's'}</span>`;
  $('jamFrom').textContent = String(jam.from);
  $('jamPrev').disabled = rec || jam.from <= 1;
  $('jamNext').disabled = rec || jam.from + jam.size > bars;
  $('jamPlay').textContent = on ? '■ Stop loop' : '▶ Start loop';
  $('jamPlay').hidden = rec;
  $('jamRec').textContent = rec ? '■ Stop and write it out' : '● Record';
  $('jamRec').classList.toggle('on', rec);
  const full = layersOf(take).length >= MAX_LAYERS;
  $('jamRec').disabled = !rec && (full || busy);
  if (!rec && !jam.rounds.length) $('jamStatus').textContent = full ? 'This song already has 4 layers. Delete one to record another part.' : on ? 'Play along. Tap Record when you’re ready: it starts the next time the loop comes round.' : 'Headphones work best.';
  renderRounds();
}
function renderRounds() {
  const full = !take?.score || layersOf(take).length >= MAX_LAYERS;
  for (const r of jam.rounds) r.kept = !!take?.layers?.some((L) => L.jamId === r.id); // (Undo can take a kept one away)
  $('jamRounds').innerHTML = session ? '' : jam.rounds.map((r, i) => `<li${r.kept ? ' class="kept"' : ''}>
    <strong>Round ${r.round}</strong><small>${r.noteCount} note${r.noteCount === 1 ? '' : 's'}${r.partial ? ' · not finished' : ''}</small>
    <button type="button" class="ed-btn" data-hear="${i}" aria-pressed="${jam.hearing === r}">${jam.hearing === r ? '■ Stop' : '▶ Hear it'}</button>
    <button type="button" class="ed-btn primary" data-keep="${i}"${full || r.kept ? ' disabled' : ''}>${r.kept ? 'Kept ✓' : 'Keep'}</button></li>`).join('');
}
function startJam(extra = null) {
  if (!take?.score || session || writing() || !fitJam()) return false;
  if (player.playing) player.stop(false);
  if (!$('tunerSheet').hidden) closeTuner();
  const layers = jamLayers();
  if (extra) layers.push({ events: extra.events, volume: 1, pan: 0.3 });
  if (!layers.length) { $('jamStatus').textContent = 'Nothing to loop in those bars (or every layer is muted).'; return false; }
  setAudioSession('playback');
  try { earCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
  wake(earCtx);
  jam.hearing = extra;
  jam.player.start(earCtx, layers, take.score.tempo.bpm, jam.loop.start, { click: practice.click, meter: take.score.tempo.meter, loop: jam.loop, fullLoop: true });
  clearInterval(jam.timer);
  jam.timer = setInterval(showJamPos, 150);
  return true;
}
function stopJam() {
  clearInterval(jam.timer);
  const was = jam.player.playing;
  jam.player.stop(false);
  jam.hearing = null;
  $('jamPos').textContent = '';
  if (was) syncJam();
}
function showJamPos() {
  const p = jam.player;
  if (!p.playing) return;
  const beats = take.score.tempo.meter, beat = p.slotDur * SLOTS_PER_BEAT;
  const t = Math.max(0, earCtx.currentTime - p.t0), inLoop = t % p.cycleDur;
  const where = `bar ${jam.from + Math.floor(inLoop / (beat * beats))} · beat ${Math.floor(inLoop / beat) % beats + 1}`;
  const rec = session?.jam;
  if (rec && !rec.cancelled) {
    const since = session.ctx.currentTime - rec.top;
    $('jamPos').textContent = since < 0 ? `Recording in ${Math.ceil(-since / beat)}…` : `● Round ${Math.floor(since / p.cycleDur) + 1} · ${where}`;
    $('jamStatus').textContent = since < 0 ? 'Get ready: it starts when the loop comes round.' : 'Recording. Every time round is written separately, so just keep going.';
  } else $('jamPos').textContent = where;
}
async function recordJam() {
  if (session?.jam) { stop(); return; }
  if (session || busy || writing() || !take?.score || layersOf(take).length >= MAX_LAYERS) return;
  if (jam.hearing) stopJam();
  if (!jam.player.playing && !startJam()) return;
  jam.rounds = [];
  $('jamStatus').textContent = 'Opening the microphone…';
  await start({ jamming: true });
  if (!session) { $('jamStatus').textContent = ui.liveFret.textContent; }
}
/** Write out what was played over the loop: one written version per time round. */
async function analyzeJam(j, rec, stream, latency, live) {
  const song = j.song;
  if (take !== song) { stream?.cancel(); return; }
  song.overdubbing = true;
  updateUndoUi();
  syncLayerUi();
  scheduleRender();
  mozart.set('squint');
  setStatus('Mozart is writing out each time round…', true);
  setProgress(0);
  const rel = (t) => t - rec.startTime;
  const top = rel(j.top) + latency, until = rec.samples.length / rec.sampleRate;
  let result = null;
  try {
    const progress = (x, mode) => { if (take === song) setProgress(x, mode === 'slow'); };
    result = stream ? await stream.finish(rec.samples, progress, {}) : await transcribe(rec.samples, rec.sampleRate, progress, {});
  } catch (err) {
    if (err?.name === 'AbortError') { song.overdubbing = false; rec.samples = null; return; }
    console.warn('Accurate pass failed, using live notes', err);
  }
  rec.samples = null; // the recording is thrown away here: only the written notes are kept
  song.overdubbing = false;
  if (take === song) endProgress();
  updateUndoUi();
  if (take !== song) return;
  const lowest = Math.min(38, Math.min(...tuningStrings()) + guitar.capo);
  let got = (result?.length ? result : live).filter((n) => n.midi >= lowest);
  got = removePlaybackNotes(got, loopNotes(j.layers, j.loop, j.slotDur, top, until, top)); // the loop heard through speakers
  const rounds = splitRounds(got, { top, until, loop: j.loop, tempo: { bpm: j.bpm, meter: j.meter }, simple: ui.detailSel.value !== 'detailed', openStrings: tuningStrings().map((m) => m + guitar.capo) });
  layoutTake(song, { quiet: true });
  jam.rounds = rounds.map((r) => ({ ...r, id: newTakeId(), source: result?.length ? 'accurate' : 'live' }));
  syncJam();
  setStatus(rounds.length ? `${rounds.length} time${rounds.length === 1 ? '' : 's'} round written` : 'Nothing was written');
  $('jamStatus').textContent = rounds.length ? 'Hear each one with the melody, then Keep the one you like as a new layer. The others go when you close the app or jam again.'
    : 'No notes were heard. Check the microphone, then try again.';
  mozart.set('bow');
  setTimeout(() => { if (!session && take === song) mozart.set('asleep'); }, 2500);
}
function keepRound(r) {
  if (!r || r.kept || !take?.score || session || writing() || layersOf(take).length >= MAX_LAYERS) return;
  stopJam();
  syncLayer();
  pushHistory();
  const used = new Set(take.layers.map((L) => L.hue));
  const name = `Jam ${take.layers.filter((L) => /^Jam \d/.test(L.name)).length + 1}`;
  const status = `${name} is now a layer · ▶ plays it with the others`;
  take.layers.push({ name, hue: [0, 1, 2, 3].find((h) => !used.has(h)), events: r.events.map((e) => ({ ...e, notes: e.notes.map((n) => ({ ...n })) })), notes: r.notes, source: r.source, jamId: r.id, mute: false, vol: 1, thin: false });
  take.edited = true;
  useLayer(take.layers.length - 1);
  layoutTake(take);
  setStatus(status);
  $('jamStatus').textContent = `${name} is kept as a new layer. Undo takes it away.`;
}
$('jamOpen').addEventListener('click', () => {
  const open = $('jamPanel').hidden;
  $('jamPanel').hidden = !open;
  $('jamOpen').setAttribute('aria-expanded', String(open));
  if (!open && !session) stopJam();
  syncJam();
});
$('jamPlay').addEventListener('click', () => { if (jam.player.playing && !jam.hearing) stopJam(); else { if (jam.hearing) stopJam(); startJam(); } syncJam(); });
$('jamRec').addEventListener('click', recordJam);
function moveJam(fn) {
  if (session) return;
  const on = jam.player.playing && !jam.hearing;
  stopJam();
  fn();
  jam.rounds = []; // (written for the old bars)
  fitJam();
  if (on) startJam();
  syncJam();
}
$('jamSizes').addEventListener('click', (e) => { const b = e.target.closest('[data-size]'); if (b) moveJam(() => { jam.size = Number(b.dataset.size); }); });
$('jamPrev').addEventListener('click', () => moveJam(() => { jam.from--; }));
$('jamNext').addEventListener('click', () => moveJam(() => { jam.from++; }));
$('jamRounds').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.keep !== undefined) { keepRound(jam.rounds[Number(b.dataset.keep)]); return; }
  const r = jam.rounds[Number(b.dataset.hear)], same = jam.hearing === r;
  stopJam();
  if (!same) startJam(r);
  syncJam();
});

// ---------- wide screens: Guide on the left; layers mixer, note editor and Thy Library on the right ----------
const wideMq = matchMedia('(min-width: 1440px)');
function docked() { return wideMq.matches; }
function openGuide() {
  if (!docked()) { closeEditor(); if (!$('takesSheet').hidden) closeTakes(); } // one sheet at a time at the bottom
  $('guide').classList.add('open');
  $('guideBtn').setAttribute('aria-expanded', 'true');
  $('guide').scrollTop = 0;
}
function closeGuide() { $('guide').classList.remove('open'); $('guideBtn').setAttribute('aria-expanded', 'false'); }
$('guideBtn').addEventListener('click', () => ($('guide').classList.contains('open') ? closeGuide() : openGuide()));
$('guideClose').addEventListener('click', closeGuide);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !docked() && $('guide').classList.contains('open')) closeGuide(); });
function applyDock() {
  const toast = $('toast');
  if (docked()) {
    $('sideRight').append(ui.ed, $('takesSheet'));
    $('takesSheet').hidden = false;
    renderTakes();
  } else {
    document.body.insertBefore(ui.ed, toast);
    document.body.insertBefore($('takesSheet'), toast);
    $('takesSheet').hidden = true;
    document.body.classList.toggle('editing', !ui.ed.hidden);
  }
  closeGuide();
}
wideMq.addEventListener('change', applyDock);

/** Layers & mix (right side): every layer's colour, name, mute and volume at once. */
function renderMix() {
  const box = $('mixList');
  if (!take?.score || session) {
    box.innerHTML = `<p class="mix-empty">${session ? 'Recording…' : 'Record or open a take to see its layers here.'}</p>`;
    return;
  }
  const Ls = layersOf(take);
  box.innerHTML = Ls.map((L, k) => `<div class="mix-row${k === take.active ? ' on' : ''}${L.mute ? ' muted' : ''}" style="--layer:${LAYER_HUES[L.hue]}">`
    + `<i class="lc-dot" aria-hidden="true"></i>`
    + `<button type="button" class="mix-name" data-mix-layer="${k}" title="${k === take.active ? 'The layer you are editing' : 'Edit this layer'}">${escHtml(L.name)}${k === take.active ? ' · editing' : ''}</button>`
    + `<button type="button" class="mini" data-mix-mute="${k}" aria-pressed="${!!L.mute}" aria-label="${L.mute ? 'Unmute' : 'Mute'} ${escHtml(L.name)}">${L.mute ? '🔇' : '🔊'}</button>`
    + `<input type="range" min="0" max="150" step="5" value="${Math.round((L.vol ?? 1) * 100)}" data-mix-vol="${k}" aria-label="${escHtml(L.name)} volume">`
    + '</div>').join('')
    + (Ls.length === 1 ? '<p class="mix-empty">Add a backup part with + Layer, or try + 3rd / + 6th for an instant harmony.</p>' : '');
}
$('mixList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !take?.score || session) return;
  if (b.dataset.mixLayer !== undefined) useLayer(Number(b.dataset.mixLayer));
  else if (b.dataset.mixMute !== undefined) changeLayer(Number(b.dataset.mixMute), (L) => { L.mute = !L.mute; }, { replay: true });
});
$('mixList').addEventListener('change', (e) => {
  const r = e.target.closest('[data-mix-vol]');
  if (r && take?.score) changeLayer(Number(r.dataset.mixVol), (L) => { L.vol = Number(r.value) / 100; }, { replay: true });
});

// ---------- Report a bug (one PDF: description, screenshots, manuscript, app/device details) ----------
let appVersion = '';
fetch('sw.js').then((r) => r.text()).then((t) => { appVersion = (t.match(/music-scribe-[\w-]+/) || [''])[0]; }).catch(() => {});
const bugs = createBugReporter({
  hasTake: () => !!take?.model && !session,
  details: () => {
    const t = take?.score ? take : null;
    const L = t?.layers;
    return [
      ['App', `${document.documentElement.dataset.edition === 'ios' ? 'Music Scribe iOS' : 'Music Scribe'} ${appVersion}`],
      ['When', new Date().toString().replace(/ \(.*\)$/, '')],
      ['Browser', navigator.userAgent],
      ['Screen', `${screen.width}×${screen.height}, window ${innerWidth}×${innerHeight}, zoom ${Math.round((Number(document.documentElement.style.zoom) || 1) * 100)}%${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ', home-screen app' : ''}`],
      ['Take', t ? `${t.title || 'Untitled'} · ${t.source || ''} · ${Math.round(t.score.tempo.bpm)} bpm · ${t.score.tempo.meter}/4 · ${keyName(t.score.key)} · ${t.model?.measures.length ?? 0} bars` : 'none open'],
      ['Layers', L?.length ? L.map((x, k) => `${x.name}${k === t.active ? '*' : ''} (${x.events.length} notes${x.mute ? ', muted' : ''})`).join(', ') : '1'],
      ['Settings', `Detail ${ui.detailSel.value}, Metronome ${ui.click.checked ? 'on' : 'off'}, tuning ${guitar.id}, capo ${guitar.capo}, mic ${ui.mic.value === '__demo__' ? 'demo' : 'device'}`],
      ['Recent errors', recentErrors.length ? recentErrors.join(' | ') : 'none'],
    ];
  },
  manuscript: async () => {
    try {
      const { toImage } = await import('./pages.js');
      return await toImage(buildSong('all'), exportModel('all'), { layout: 'both', size: 'page', look: 'white' });
    } catch { return null; }
  },
  onOpen: () => { closeEditor(); closeGuide(); if (exportSheet.isOpen) exportSheet.close(); if (!docked() && !$('takesSheet').hidden) closeTakes(); },
});
$('bugBtn').addEventListener('click', () => (bugs.isOpen ? bugs.close() : bugs.open()));
$('guideBug').addEventListener('click', () => bugs.open());

// ---------- first visit: a short walkthrough ----------
const TOUR = [
  [() => $('tuneBtn'), 'Welcome to Music Scribe! Start by tuning: tap <b>Tune</b> and play one string at a time.'],
  [() => ui.record, 'Tap <b>Begin</b> and play. Tap <b>Cease</b> when you’re done: Mozart writes it out in a few seconds.'],
  [() => document.querySelector('.score-card'), '<b>Thy Manuscript.</b> Tap any note to hear it and fix it. <b>▶</b> plays it back, <b>Export</b> makes a PDF, image, MusicXML or MIDI.'],
  [() => document.querySelector('.score-card .head-actions'), 'Once you have a take, <b>+ Layer</b> adds a backup part while the first one plays, and <b>Takes</b> keeps everything you’ve written.'],
  [() => (docked() ? $('guide') : $('guideBtn')), 'The <b>Guide</b> has room setup tips for clean recordings, shortcuts and more. Open it any time.'],
];
let tourAt = -1, coached = null;
function showTour(i) {
  coached?.classList.remove('coach');
  coached = null;
  if (i < 0 || i >= TOUR.length) { tourAt = -1; $('tour').hidden = true; store.set('toured', '1'); return; }
  tourAt = i;
  const [target, text] = TOUR[i];
  const el = target();
  if (el) { el.classList.add('coach'); coached = el; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  $('tourText').innerHTML = text;
  $('tourStep').textContent = `${i + 1} of ${TOUR.length}`;
  $('tourNext').textContent = i === TOUR.length - 1 ? 'Done' : 'Next';
  $('tour').hidden = false;
}
$('tourNext').addEventListener('click', () => showTour(tourAt + 1));
$('tourSkip').addEventListener('click', () => showTour(-1));
$('tourAgain').addEventListener('click', () => { closeGuide(); showTour(0); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tourAt >= 0) showTour(-1); });
applyDock();
renderMix();
if (!DEMO && store.get('toured', '0') !== '1') setTimeout(() => showTour(0), 900);

// ---------- the note editor (tap a note or rest) ----------
const lenName = (slots) => E.LENGTHS.find(([s]) => s === slots)?.[1] ?? `${slots / 4} beats`;
/** Spoken description of a note or chord, for screen readers. */
function pieceLabel(ev, pl) {
  const len = lenName(ev.len);
  const chord = pl.show || pl.auto;
  const names = ev.notes.map((n) => noteName(n.midi)).join(', ');
  return `${whereLabel(ev.slot)}: ${chord ? `${chord} chord, ` : ''}${names}, ${len}${/beat/.test(len) ? '' : ' note'}`;
}
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
  if (exportSheet.isOpen) exportSheet.close();
  if (!$('takesSheet').hidden) closeTakes();
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
  refreshTools();
  if (sel.kind === 'ev') audition(take.score.events[sel.idx].notes.map((n) => n.midi)); // hear what you tapped
}
function closeEditor({ relayout = true } = {}) {
  stopPlayback(); // Clear, Begin, Undo and opening a project all come through here
  if (!$('takesSheet').hidden) closeTakes();
  resumeFrom = null;
  const had = !!sel || picked.size > 0;
  sel = null;
  picked.clear();
  anchor = null;
  refreshTools();
  ui.ed.hidden = true;
  document.body.classList.remove('editing');
  if (had && relayout && take?.score && !session) layoutTake(take, { quiet: true });
}
function currentRefIndex() {
  if (!sel || !take?.refs) return -1;
  return take.refs.findIndex((r) => (sel.kind === 'ev' ? r.kind === 'ev' && r.idx === sel.idx : r.kind === 'rest' && r.at === sel.at));
}
function nav(dir) {
  if (!selectMode) picked.clear();
  const i = currentRefIndex();
  const next = take?.refs?.[i + dir];
  if (next) select(next);
}

/** Make a change to the score (undo-able), then redraw. */
function edit(fn, { listen = false, what = null } = {}) {
  if (!take?.score || session || !sel) return;
  const before = sel.kind === 'ev' ? JSON.parse(JSON.stringify(take.score.events[sel.idx])) : null;
  const focusBefore = sel.focus;
  const restAt = sel.kind === 'rest' ? sel.at : null;
  pushHistory();
  const had = take.score.events.length;
  sel = fn(take.score, sel) || sel;
  if (take.score.events.length !== had) picked.clear(); // (the picked notes' places have moved)
  if (what) {
    const after = sel.kind === 'ev' ? take.score.events[sel.idx] : null;
    const changed = JSON.stringify(before) !== JSON.stringify(after) || restAt !== null;
    if (changed) logFix(FX.describe(what, before, after, focusBefore));
  }
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
  edit((s, x) => E.setString(s, x, next.stringIndex), { what: 'string' });
}

ui.score.addEventListener('click', (e) => {
  const r = e.target.closest?.('[data-ref]');
  if (!r || !take?.refs || session) return;
  const ref = take.refs[Number(r.dataset.ref)];
  if ((e.ctrlKey || e.metaKey) && e.shiftKey) { pickBar(ref); return; }
  if (e.shiftKey) { pickRange(ref); return; }
  if (e.ctrlKey || e.metaKey) { if (ref?.kind === 'ev') pickAlso(ref.idx); return; }
  if (selectMode && ref?.kind === 'ev') { anchor = ref.idx; togglePick(ref.idx); return; }
  picked.clear();
  anchor = ref?.kind === 'ev' ? ref.idx : null;
  select(ref);
});
// (Shift+click would otherwise also select the page's text)
ui.score.addEventListener('mousedown', (e) => { if ((e.shiftKey || e.ctrlKey || e.metaKey) && e.target.closest?.('[data-ref]')) e.preventDefault(); });

// ---------- picking with the keyboard held: Ctrl = also this note, Shift = everything in between, Ctrl+Shift = the whole bar ----------
let anchor = null; // where a Shift+click range starts: the last note clicked without Shift
/** Start from the note being edited, if nothing is picked yet. */
function keepCurrent() { if (!picked.size && sel?.kind === 'ev') picked.add(sel.idx); }
function pickAlso(idx) {
  keepCurrent();
  anchor = idx;
  togglePick(idx);
}
function pickRange(ref) {
  // clicking a rest: up to the note nearest it
  const idx = ref?.kind === 'ev' ? ref.idx : take.score.events.findLastIndex((e) => e.slot <= (ref?.at ?? 0));
  if (idx < 0) return;
  if (anchor === null || !take.score.events[anchor]) anchor = sel?.kind === 'ev' ? sel.idx : idx;
  picked.clear();
  for (let i = Math.min(anchor, idx); i <= Math.max(anchor, idx); i++) picked.add(i);
  select({ kind: 'ev', idx });
}
function pickBar(ref) {
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT;
  const bar = Math.floor((ref.kind === 'ev' ? take.score.events[ref.idx].slot : ref.at) / barSlots);
  const inBar = take.score.events.map((e, i) => i).filter((i) => Math.floor(take.score.events[i].slot / barSlots) === bar);
  if (!inBar.length) { showToast('That bar has no notes to pick.'); return; }
  if (!picked.size && sel?.kind === 'ev' && Math.floor(take.score.events[sel.idx].slot / barSlots) !== bar) keepCurrent();
  if (picked.size && inBar.every((i) => picked.has(i))) { // all of it is picked: take it off again
    inBar.forEach((i) => picked.delete(i));
    const left = [...picked].pop();
    if (left === undefined) { closeEditor(); return; }
    select({ kind: 'ev', idx: left });
    return;
  }
  inBar.forEach((i) => picked.add(i));
  anchor = inBar[0];
  select({ kind: 'ev', idx: inBar[0] });
}
function pickAll() {
  const n = take.score.events.length;
  if (!n) return;
  for (let i = 0; i < n; i++) picked.add(i);
  anchor = 0;
  select({ kind: 'ev', idx: 0 });
}

// ---------- copy, cut and paste ----------
let clip = null; // { bars, meter, take, hue, layers: { [hue]: events }, whole }
/** Is every note of the touched bars picked? Then it's those bars, in every layer; else just the notes. */
function wholeBars() {
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT, bars = new Set(barList() || []), t = new Set(targets());
  return bars.size > 0 && take.score.events.every((e, i) => !bars.has(Math.floor(e.slot / barSlots)) || t.has(i));
}
const copyText = (c, verb) => (c.whole ? `${verb} ${c.bars === 1 ? 'the bar' : `${c.bars} bars`}${Object.keys(c.layers).length > 1 ? ' (every layer)' : ''}` : `${verb} ${c.count} note${c.count === 1 ? '' : 's'}`);
function copyPicked({ quiet = false } = {}) {
  const t = targets(), bars = barList();
  if (!t.length || !bars) return false;
  syncLayer();
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT, whole = wholeBars(), A = layersOf(take)[take.active];
  const layers = {};
  if (whole) take.layers.forEach((L) => { layers[L.hue] = E.extractBars(L.events, bars, barSlots); });
  else layers[A.hue] = E.extractBars(take.score.events, bars, barSlots, new Set(t.map((i) => take.score.events[i])));
  clip = { bars: bars.length, meter: take.score.tempo.meter, take: take.id, hue: A.hue, layers, whole, count: t.length };
  if (!quiet) showToast(`${copyText(clip, 'Copied')} · Ctrl+V puts ${clip.whole && clip.bars === 1 ? 'it' : 'them'} in after the bar you tap`);
  return true;
}
function cutPicked() {
  const bars = barList();
  if (!targets().length || writing()) return;
  const whole = wholeBars();
  if (whole && bars.length >= take.model.measures.length) { showToast('That’s the whole song. Use Clear Thy Manuscript instead.'); return; }
  if (!copyPicked({ quiet: true })) return;
  if (whole) changeBars('delete'); else removeTargets();
  showToast(copyText(clip, 'Cut'), undo);
}
/** New bars after the tapped bar (or at the end), holding what was copied. */
function pasteClip() {
  if (!clip) { showToast('Nothing copied yet. Select some notes and press Ctrl+C.'); return; }
  if (writing() || !take.model) return;
  if (clip.meter !== take.score.tempo.meter) { showToast(`That was copied from a ${clip.meter}/4 song, so it doesn’t fit these ${take.score.tempo.meter}/4 bars.`); return; }
  syncLayer();
  pushHistory();
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT, total = take.model.measures.length, bars = barList();
  const at = (bars ? bars[bars.length - 1] + 1 : total) * barSlots, len = clip.bars * barSlots;
  const A = layersOf(take)[take.active];
  let added = [];
  for (const L of take.layers) {
    // bars copied from this song go back into their own layers; anything else goes into the one being edited
    const music = clip.whole && clip.take === take.id ? clip.layers[L.hue] : L === A ? clip.layers[clip.hue] : null;
    const put = E.insertClip(L.events, at, len, music || []);
    if (L === A) added = put;
  }
  setBars(total + clip.bars);
  take.edited = true;
  closeEditor({ relayout: false });
  added.forEach((ev) => picked.add(take.score.events.indexOf(ev)));
  if (picked.size) { const idx = Math.min(...picked); anchor = idx; sel = { kind: 'ev', idx, focus: take.score.events[idx].notes.length - 1 }; ui.ed.hidden = false; document.body.classList.add('editing'); }
  layoutTake(take);
  refreshTools();
  showToast(copyText(clip, 'Pasted'), undo);
}
/** Ctrl+C / X / V / D / A on the manuscript. Returns true when it was one of these. */
function clipKey(key) {
  if (!take?.score || session || writing() || exportSheet.isOpen || bugs.isOpen || !$('fixesSheet').hidden || !$('tunerSheet').hidden) return false;
  if (key === 'a') { pickAll(); return true; }
  if (key === 'v') { pasteClip(); return true; }
  if (!targets().length) return false;
  if (key === 'c') { if (String(getSelection() || '')) return false; return copyPicked(); } // (selected text copies as usual)
  if (key === 'x') { cutPicked(); return true; }
  if (key === 'd') { changeBars('duplicate'); return true; }
  return false;
}

// ---------- Select tool, Remove, and moving notes along the key ----------
/** The notes an edit applies to: everything picked with the Select tool, else the note being edited. */
function targets() {
  if (picked.size) return [...picked].sort((a, b) => a - b);
  return sel?.kind === 'ev' ? [sel.idx] : [];
}
function togglePick(idx) {
  if (picked.has(idx)) {
    picked.delete(idx);
    if (sel?.kind === 'ev' && sel.idx === idx) {
      const other = [...picked].pop();
      if (other === undefined) { closeEditor(); return; }
      sel = { kind: 'ev', idx: other, focus: take.score.events[other].notes.length - 1 };
    }
    layoutTake(take, { quiet: true });
    refreshTools();
    return;
  }
  picked.add(idx);
  select({ kind: 'ev', idx }); // opens the tray on it and plays it
}
function setSelectMode(on) {
  selectMode = on;
  if (!on && picked.size) {
    // leaving the tool keeps editing just the note in the tray
    picked.clear();
    if (take?.score) layoutTake(take, { quiet: true });
  }
  refreshTools();
}
function refreshTools() {
  const n = targets().length;
  const tool = $('selectTool');
  document.body.classList.toggle('selecting', selectMode);
  tool.setAttribute('aria-pressed', String(selectMode));
  tool.classList.toggle('on', selectMode);
  tool.textContent = selectMode ? (picked.size ? `Select · ${picked.size}` : 'Select · tap notes') : 'Select';
  const rm = $('removeTool');
  rm.disabled = !n || !!session;
  rm.textContent = n > 1 ? `Remove ${n} notes` : 'Remove note';
  const span = barList(), off = !take?.model || !!session || writing();
  const many = span && span.length > 1 ? `${span.length} bars` : 'bar';
  const which = span ? `${span.length > 1 ? 'bars' : 'bar'} ${span.map((x) => x + 1).join(', ')}` : '';
  $('addBarTool').disabled = off;
  $('addBarTool').title = span ? `Add an empty bar after bar ${span[span.length - 1] + 1}` : 'Add an empty bar at the end';
  $('dupBarTool').disabled = off || !span;
  $('dupBarTool').textContent = `Duplicate ${many}`;
  $('dupBarTool').title = span ? `Repeat ${which} straight after (Ctrl+D)` : 'Tap a note or rest in the bar first';
  $('delBarTool').disabled = off || !span || span.length >= take.model.measures.length;
  $('delBarTool').textContent = `Delete ${many}`;
  $('delBarTool').title = span ? `Take ${which} out of every layer` : 'Tap a note or rest in the bar first';
}
/** The bars the tapped or picked notes are in, in order (counting from 0), or null. */
function barList() {
  if (!take?.score || !take.model) return null;
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT;
  const slots = picked.size ? [...picked].map((i) => take.score.events[i]?.slot).filter((s) => s !== undefined)
    : sel?.kind === 'ev' ? [take.score.events[sel.idx]?.slot ?? 0] : sel?.kind === 'rest' ? [sel.at] : [];
  if (!slots.length) return null;
  return [...new Set(slots.map((s) => Math.floor(s / barSlots)))].sort((x, y) => x - y);
}
/** Empty bars at the end aren't in any note, so the song remembers how long it is. */
function setBars(bars) {
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT;
  const end = Math.max(0, ...take.layers.flatMap((L) => L.events).map((e) => e.slot + e.len));
  if (Math.ceil(end / barSlots) < bars) take.score.bars = bars; else delete take.score.bars;
}
/** Add, repeat or take out whole bars, in every layer so they stay lined up (undo-able). */
function changeBars(what) {
  if (!take?.score || !take.model || session || writing()) return;
  const list = barList();
  if (what !== 'add' && !list) return;
  const row = !list || list[list.length - 1] - list[0] + 1 === list.length; // are they next to each other?
  const barSlots = take.score.tempo.meter * SLOTS_PER_BEAT, total = take.model.measures.length;
  if (what === 'delete' && list.length >= total) return;
  syncLayer();
  pushHistory();
  const n = what === 'add' ? 1 : list.length;
  const a = (list ? list[0] : total) * barSlots;
  const b = (list ? list[list.length - 1] + 1 : total) * barSlots;
  for (const L of layersOf(take)) {
    if (what === 'add') E.insertGap(L.events, b, barSlots);
    else if (what === 'duplicate') { if (row) E.duplicateSpan(L.events, a, b); else E.insertClip(L.events, b, n * barSlots, E.extractBars(L.events, list, barSlots)); }
    else for (const bar of [...list].reverse()) E.cutSpan(L.events, bar * barSlots, (bar + 1) * barSlots);
  }
  const bars = total + (what === 'delete' ? -n : n);
  setBars(bars);
  take.edited = true;
  closeEditor({ relayout: false });
  layoutTake(take);
  // go on from the new bar (so Duplicate again repeats the copy, and an empty bar is ready for notes)
  const at = what === 'delete' ? Math.min(a, (bars - 1) * barSlots) : b;
  const ref = take.refs.find((r) => (r.kind === 'ev' ? take.score.events[r.idx].slot >= at && take.score.events[r.idx].slot < at + barSlots : r.at >= at && r.at < at + barSlots));
  if (ref && what !== 'delete') {
    anchor = ref.kind === 'ev' ? ref.idx : null;
    if (what === 'duplicate' && n > 1) take.score.events.forEach((ev, i) => { if (ev.slot >= at && ev.slot < at + n * barSlots) picked.add(i); });
    select(ref);
  }
  refreshTools();
  const text = what === 'add' ? `Bar ${at / barSlots + 1} added` : what === 'duplicate' ? (n > 1 ? `${n} bars duplicated` : 'Bar duplicated') : (n > 1 ? `${n} bars deleted` : 'Bar deleted');
  showToast(`${text}${take.layers.length > 1 ? ' in every layer' : ''}`, undo);
}
/** Take the target notes out of the manuscript and close the gap (undo-able). */
function removeTargets() {
  const idxs = targets();
  if (!idxs.length || !take?.score || session) return;
  pushHistory();
  const gone = idxs.map((i) => JSON.parse(JSON.stringify(take.score.events[i])));
  E.removeEvents(take.score, idxs);
  gone.forEach((ev) => logFix(FX.describe('rest', ev, null))); // each was a wrong extra note
  take.edited = true;
  const first = Math.min(...idxs);
  picked.clear();
  const next = take.score.events[first] ? first : take.score.events.length - 1;
  sel = next >= 0 && !selectMode ? { kind: 'ev', idx: next, focus: take.score.events[next].notes.length - 1 } : null;
  if (!sel) { ui.ed.hidden = true; document.body.classList.remove('editing'); }
  layoutTake(take);
  refreshTools();
  showToast(idxs.length > 1 ? `Removed ${idxs.length} notes` : 'Note removed', undo);
}
/**
 * Move notes up/down: one step in the key (dir ±1), or one fret with byFret.
 * One note being edited: just its focused note. Notes picked with Select: every note in them.
 * You hear the new notes straight away.
 */
function moveTargets(dir, { byFret = false } = {}) {
  if (!take?.score || session) return;
  const fifths = take.score.key?.fifths ?? 0;
  if (!picked.size) {
    if (sel?.kind !== 'ev') return;
    const note = take.score.events[sel.idx].notes[sel.focus];
    if (!note) return;
    const delta = byFret ? dir : E.keyStep(note.midi, dir, fifths) - note.midi;
    edit((s, x) => E.shiftPitch(s, x, delta), { listen: 'note', what: 'pitch' });
    return;
  }
  const idxs = targets();
  pushHistory();
  const heard = [];
  for (const i of idxs) {
    const ev = take.score.events[i];
    const before = JSON.parse(JSON.stringify(ev));
    const moved = ev.notes.map((n) => (byFret ? n.midi + dir : E.keyStep(n.midi, dir, fifths)));
    if (moved.some((m) => m < 28 || m > 88)) continue;
    ev.notes.forEach((n, k) => { n.midi = moved[k]; delete n.str; });
    E.sortNotes(ev);
    before.notes.forEach((_, k) => logFix(FX.describe('pitch', before, { notes: before.notes.map((n, j) => ({ midi: j === k ? moved[k] : n.midi })) }, k)));
    heard.push(ev.notes.map((n) => n.midi));
  }
  take.edited = true;
  layoutTake(take);
  // play the moved notes one after another, like a little run
  heard.slice(0, 12).forEach((m, k) => setTimeout(() => audition(m), k * 170));
}
$('selectTool').addEventListener('click', () => setSelectMode(!selectMode));
$('removeTool').addEventListener('click', removeTargets);
$('addBarTool').addEventListener('click', () => changeBars('add'));
$('dupBarTool').addEventListener('click', () => changeBars('duplicate'));
$('delBarTool').addEventListener('click', () => changeBars('delete'));
// keyboard access to the manuscript: Tab reaches it, ←→ move between notes, Enter/Space opens the editor
ui.score.addEventListener('keydown', (e) => {
  const hit = e.target.closest?.('.hit');
  if (!hit || !take?.refs || session) return;
  const ref = Number(hit.dataset.ref);
  if (e.key === 'Enter' || e.key === ' ') {
    const r = take.refs[ref];
    const already = sel && (r.kind === 'ev' ? sel.kind === 'ev' && sel.idx === r.idx : sel.kind === 'rest' && sel.at === r.at);
    if (already) return; // the editor's own keys take over
    e.preventDefault();
    e.stopPropagation();
    select(r);
  } else if (!sel && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const next = ui.score.querySelector(`.hit[role="button"][data-ref="${ref + (e.key === 'ArrowRight' ? 1 : -1)}"]`);
    if (!next) return;
    e.preventDefault();
    hit.setAttribute('tabindex', '-1');
    next.setAttribute('tabindex', '0');
    next.focus();
  }
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
  if (b && !b.disabled) edit((s, x) => E.setLength(s, x, Number(b.dataset.len)), { what: 'length' });
});
ui.edChord.addEventListener('change', () => {
  if (sel?.kind !== 'ev') return;
  const v = ui.edChord.value.trim();
  const auto = take.placed[sel.idx]?.auto;
  edit((s, x) => E.setChord(s, x, !v || v === auto ? undefined : v), { what: 'chord' });
});
ui.edChord.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.edChord.blur(); });

function act(name) {
  if (!sel) return;
  if (sel.kind === 'rest') {
    if (name === 'fill') {
      const midi = E.guessPitch(take.score, sel.at);
      edit((s, x) => E.fillRest(s, x.at, x.len, midi), { listen: 'note', what: 'fill' });
    }
    return;
  }
  switch (name) {
    case 'semi-': return moveTargets(-1, { byFret: true });
    case 'semi+': return moveTargets(1, { byFret: true });
    case 'step-': return moveTargets(-1);
    case 'step+': return moveTargets(1);
    case 'delete': return removeTargets();
    case 'oct-': return edit((s, x) => E.shiftPitch(s, x, -12), { listen: 'note', what: 'pitch' });
    case 'oct+': return edit((s, x) => E.shiftPitch(s, x, 12), { listen: 'note', what: 'pitch' });
    case 'str-': return cycleString(-1);
    case 'str+': return cycleString(1);
    case 'add': return edit(E.addNote, { listen: 'chord', what: 'add' });
    case 'remove': return edit(E.removeNote, { what: 'remove' });
    case 'rest': return edit(E.makeRest, { what: 'rest' });
    case 'join': return edit(E.join, { what: 'join' });
    case 'split': return edit((s, x) => E.split(s, x, take.pieceStarts.get(x.idx) || []), { what: 'split' });
    case 'chord-auto': return edit((s, x) => E.setChord(s, x, undefined), { what: 'chord' });
    case 'chord-hide': return edit((s, x) => E.setChord(s, x, ''), { what: 'chord' });
    case 'listen': return audition(take.score.events[sel.idx].notes.map((n) => n.midi));
    default: return undefined;
  }
}
ui.ed.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) act(b.dataset.act);
});

// keyboard (PC): ↑↓ / W S / + − one step in the key (Shift on ↑↓ W S = one fret), ←→ / A D previous/next,
// Delete = remove (closes the gap), Enter = add note to a rest, Esc = close
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && !typing && !e.shiftKey && !e.altKey && 'acdvx'.includes(e.key.toLowerCase()) && e.key.length === 1 && clipKey(e.key.toLowerCase())) { e.preventDefault(); return; }
  if (e.key === ' ' && !typing && !mod && e.target.tagName !== 'BUTTON' && !exportSheet.isOpen && $('takesSheet').hidden && $('fixesSheet').hidden && !ui.play.disabled) { e.preventDefault(); togglePlay(); return; }
  if (!sel || typing || mod || e.altKey) return;
  if (e.key === 'Enter' && (e.target.tagName === 'BUTTON' || sel.kind !== 'rest')) return;
  const up = e.shiftKey ? 'semi+' : 'step+', down = e.shiftKey ? 'semi-' : 'step-';
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const keys = {
    ArrowUp: up, w: up, ArrowDown: down, s: down,
    '+': 'step+', '=': 'step+', '-': 'step-', '_': 'step-',
    Delete: 'delete', Backspace: 'delete', Enter: 'fill',
  };
  if (exportSheet.isOpen) return;
  if (k === 'ArrowLeft' || k === 'a') nav(-1);
  else if (k === 'ArrowRight' || k === 'd') nav(1);
  else if (k === 'Escape') { if (selectMode) setSelectMode(false); closeEditor(); }
  else if (keys[k]) act(keys[k]);
  else return;
  e.preventDefault();
});

// ---------- export, share, Dropbox, projects (M4) ----------
let layoutVersion = 0;
/** One layer laid out for export: bars (as long as the song), tab positions and chord names. */
function partMeasures(events, barSlots, nBars, fifths) {
  const bars = layoutBars(events, barSlots, nBars);
  const pk = new FretPicker(tuningStrings(), guitar.capo);
  let lastChord = '';
  const placed = events.map((ev) => {
    const keys = ev.notes.map((n) => n.midi).sort((a, b) => a - b);
    const pos = pk.pickChord(keys, ev.notes.map((n) => n.str));
    const auto = keys.length >= 2 ? nameChord(keys, fifths) : '';
    let show = '';
    if (ev.chord !== undefined) { show = ev.chord; if (show) lastChord = show; } else if (auto) { if (auto !== lastChord) show = auto; lastChord = auto; }
    return { keys, positions: pos.map((x) => (x.pos ? { str: x.pos.string, fret: x.pos.fret } : null)), show };
  });
  return bars.map((bar) => bar.map((p) => (p.rest ? { slots: p.slots, rest: true } : {
    slots: p.slots, keys: placed[p.evIdx].keys, positions: placed[p.evIdx].positions,
    chord: p.tieFromPrev ? '' : placed[p.evIdx].show, tieToNext: p.tieToNext, tieFromPrev: p.tieFromPrev,
  })));
}
/** Every layer that has notes, as parts for MusicXML / MIDI / text tab (null for a one-layer song). */
function buildParts(t) {
  if (!(t.layers?.length > 1)) return null;
  syncLayer(t);
  const barSlots = t.score.tempo.meter * SLOTS_PER_BEAT;
  const used = t.layers.filter((L) => L.events.length);
  if (used.length < 2) return null;
  const nBars = Math.max(t.model.measures.length, ...used.map((L) => layoutBars(L.events, barSlots).length));
  return used.map((L) => ({ name: L.name, hue: L.hue, events: L.events, measures: partMeasures(L.events, barSlots, nBars, t.score.key.fifths) }));
}
/** The page for PDF/image/SVG: every layer bold in its colour, or just the one being edited. */
function exportModel(which) {
  const m = { ...take.model, header: '' };
  if (which !== 'all' || !(take.layers?.length > 1)) return { ...m, ghosts: [], layerStyle: null };
  const A = take.layers[take.active];
  return {
    ...m,
    ghosts: (m.ghosts || []).map((g) => ({ ...g, thin: false })),
    layerStyle: { color: LAYER_HUES[A.hue], fade: LAYER_FADE[A.hue], thin: false },
  };
}

function buildSong(which = 'one') {
  const t = take;
  syncLayer(t);
  const parts = which === 'all' ? buildParts(t) : null;
  const strings = tuningStrings();
  return {
    title: t.title || '',
    composer: store.get('composer', ''),
    bpm: t.score.tempo.bpm,
    meter: t.score.tempo.meter,
    key: t.score.key,
    strings,
    capo: guitar.capo,
    tuningName: guitar.id === 'custom' ? 'Custom' : TUNINGS[guitar.id].name,
    tuningLetters: tuningLetters(strings),
    measures: t.model.measures,
    events: t.score.events,
    parts: parts || undefined,
    // colour key for PDFs and images with every layer on them
    legend: parts ? parts.map((p) => `${p.name} (${LAYER_HUE_NAMES[p.hue]})`).join('   ·   ') + (t.layers[t.active] ? `   ·   tab: ${t.layers[t.active].name}` : '') : undefined,
    project: {
      format: PROJECT_FORMAT,
      version: 1,
      app: 'Music Scribe',
      id: t.id || undefined, // lets the library recognise this take if the file is opened again
      savedAt: new Date().toISOString(),
      title: t.title || '',
      composer: store.get('composer', ''),
      guitar: { tuning: guitar.id, strings, capo: guitar.capo },
      take: {
        source: t.source, notes: t.notes || [], score: t.score,
        ...(t.layers?.length > 1 ? {
          active: t.active,
          layers: t.layers.map((L, k) => ({ name: L.name, hue: L.hue, mute: !!L.mute, vol: L.vol ?? 1, thin: !!L.thin, source: L.source, notes: L.notes || [], events: k === t.active ? t.score.events : L.events })),
        } : {}),
      },
    },
  };
}

/** Load a .musicscribe.json project as the current take (Undo brings back what was there). */
function openProject(data, saved = null) {
  if (session) return;
  if (writing()) { showToast(WRITING_MSG); return; }
  try { data = validateProject(data); } catch (err) { showToast(err.message); return; }
  flushSave();
  const prev = take;
  const pushed = !!take?.score;
  if (pushed) pushHistory();
  closeEditor({ relayout: false });
  const g = data.guitar || {};
  if (g.tuning === 'custom' && Array.isArray(g.strings) && g.strings.length === 6) {
    guitar.id = 'custom';
    guitar.custom = g.strings.map(Number);
    store.set('customTuning', JSON.stringify(guitar.custom));
    ui.custom.innerHTML = '';
  } else if (TUNINGS[g.tuning]) {
    guitar.id = g.tuning;
  }
  guitar.capo = Math.max(0, Math.min(MAX_CAPO, Number(g.capo) || 0));
  store.set('tuning', guitar.id);
  store.set('capo', String(guitar.capo));
  rebuildPicker();
  syncGuitarUi();
  const notesIn = Array.isArray(data.take.notes) ? data.take.notes : [];
  take = {
    rec: null, live: [], click: null,
    source: data.take.source || 'project',
    notes: notesIn,
    events: onsetEvents(notesIn),
    score: data.take.score,
    tempo: { ...data.take.score.tempo },
    title: data.title || '',
    edited: false,
    id: saved?.id || data.id || newTakeId(), // library entry, the id stored in the file, or a new entry
    createdAt: saved?.createdAt || Date.now(),
  };
  if (data.take.layers?.length > 1) { // a song with layers: the list is the truth, the page shows the active one
    take.layers = data.take.layers;
    take.active = data.take.active;
    const L = take.layers[take.active];
    take.score.events = L.events;
    take.notes = L.notes;
    take.source = L.source;
    take.events = onsetEvents(L.notes);
  }
  if (data.composer && !store.get('composer', '')) store.set('composer', data.composer);
  ui.bpm.value = String(Math.round(take.tempo.bpm));
  try {
    layoutTake(take);
  } catch (err) { // put everything back rather than leave a half-open page
    console.warn('Could not open that project', err);
    take = prev;
    if (pushed) history.past.pop();
    if (take?.score) layoutTake(take); else scheduleRender();
    updateUndoUi();
    showToast('That project couldn’t be opened. Nothing was changed.');
    return;
  }
  setStatus(`Opened “${take.title || 'project'}” · ♩=${Math.round(take.tempo.bpm)} · ${take.tempo.meter}/4`);
  updateUndoUi();
}

const exportSheet = createExportSheet({
  store,
  getSong: buildSong,
  getModel: exportModel,
  layered: () => (take?.layers?.filter((L) => L.events.length).length || 0) > 1,
  version: () => layoutVersion,
  hasTake: () => !!take?.model && !session,
  getTitle: () => take?.title || '',
  setTitle: (v) => { if (take) { take.title = v; scheduleSave(); } },
  pasteMode: IS_IOS && IS_STANDALONE, // home-screen iPhone apps can't use sign-in pop-ups
  onOpenProject: openProject,
  onDone: () => {
    mozart.set('bow');
    mozart.say('Sealed!');
    setTimeout(() => { if (!session) mozart.set('asleep'); }, 2500);
  },
});
ui.exportBtn.addEventListener('click', () => {
  if (!take?.model || session) return;
  closeEditor();
  exportSheet.open();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && exportSheet.isOpen) exportSheet.close(); });

// ---------- saved takes library (written notes only, never audio) ----------
let saveTimer = 0;
let takeCount = 0;
function persistTake() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const t = take;
  if (!t?.id || !t.model || !t.score?.events?.length || session) return;
  const song = buildSong();
  t.createdAt ||= Date.now();
  const rec = {
    id: t.id,
    title: t.title || '',
    createdAt: t.createdAt,
    savedAt: Date.now(),
    bpm: Math.round(t.score.tempo.bpm),
    meter: t.score.tempo.meter,
    bars: t.model.measures.length,
    noteCount: (t.layers || [{ events: t.score.events }]).reduce((n, L) => n + L.events.reduce((m, e) => m + e.notes.length, 0), 0),
    data: song.project, // notes, edits, tuning, title: no audio exists in here
  };
  saveTake(rec).then(refreshTakeCount).catch((err) => console.warn('Could not save the take on this device', err));
}
function scheduleSave() {
  if (!take?.id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistTake, 700);
}
function flushSave() { if (saveTimer) persistTake(); }
async function refreshTakeCount() {
  takeCount = (await listTakes()).length;
  ui.takes.textContent = takeCount ? `Takes (${takeCount})` : 'Takes';
  if (docked()) renderTakes();
  const link = $('hintTakes');
  link.hidden = !takeCount;
  link.textContent = takeCount === 1 ? 'Or open your saved take' : `Or open one of your ${takeCount} saved takes`;
}
const fmtWhen = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function renderTakes() {
  const list = await listTakes();
  $('tkEmpty').hidden = list.length > 0;
  $('tkList').innerHTML = list.map((r) => `
    <li class="tk-item${take?.id === r.id ? ' current' : ''}" data-id="${escHtml(r.id)}">
      <button type="button" class="tk-open" data-do="open">
        <strong>${escHtml(r.title || 'Untitled')}</strong>
        <small>${fmtWhen(r.savedAt)} · ${r.bars} bar${r.bars === 1 ? '' : 's'} · ♩=${r.bpm} · ${r.noteCount} notes${take?.id === r.id ? ' · open now' : ''}</small>
      </button>
      <button type="button" class="mini" data-do="rename" aria-label="Rename" title="Rename">✎</button>
      <button type="button" class="mini" data-do="delete" aria-label="Delete" title="Delete">🗑</button>
    </li>`).join('');
  takesCache = list;
}
let takesCache = [];
function openTakes() {
  if (session) return;
  if (docked()) { renderTakes().then(() => $('takesSheet').scrollIntoView({ block: 'nearest', behavior: 'smooth' })); return; }
  if (!$('fixesSheet').hidden) closeFixes();
  flushSave();
  closeEditor();
  if (exportSheet.isOpen) exportSheet.close();
  renderTakes().then(() => {
    $('takesSheet').hidden = false;
    document.body.classList.add('editing');
    requestAnimationFrame(() => document.body.style.setProperty('--tray-h', `${$('takesSheet').offsetHeight}px`));
  });
}
function closeTakes() {
  if (docked()) return; // on a wide screen Thy Library stays open on the right
  $('takesSheet').hidden = true;
  document.body.classList.remove('editing');
}
ui.takes.addEventListener('click', openTakes);
$('hintTakes').addEventListener('click', openTakes);
$('tkClose').addEventListener('click', closeTakes);
/** Rename a take right in the list: the title becomes a text box with Save and Cancel. */
function renameInline(li, rec) {
  $('tkList').querySelector('.tk-rename')?.closest('.tk-item')?.dispatchEvent(new CustomEvent('cancel-rename'));
  const form = document.createElement('form');
  form.className = 'tk-rename';
  form.innerHTML = `<input type="text" maxlength="80" placeholder="Untitled" aria-label="Name this take" autocomplete="off" enterkeyhint="done">
    <button type="submit" class="ed-btn primary">Save</button>
    <button type="button" class="ed-btn" data-cancel>Cancel</button>`;
  const input = form.querySelector('input');
  input.value = rec.title || '';
  li.classList.add('renaming');
  li.prepend(form);
  input.focus();
  input.select();
  const finish = () => { form.remove(); li.classList.remove('renaming'); li.querySelector('[data-do="rename"]')?.focus(); };
  li.addEventListener('cancel-rename', finish, { once: true });
  form.querySelector('[data-cancel]').addEventListener('click', finish);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    rec.title = input.value.trim().slice(0, 80);
    rec.data.title = rec.title;
    if (take?.id === rec.id) take.title = rec.title;
    await saveTake(rec);
    await renderTakes();
    $('tkList').querySelector(`.tk-item[data-id="${CSS.escape(rec.id)}"] [data-do="rename"]`)?.focus();
  });
}
$('tkList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-do]');
  const li = e.target.closest('.tk-item');
  if (!b || !li) return;
  const rec = takesCache.find((r) => r.id === li.dataset.id);
  if (!rec) return;
  if (b.dataset.do === 'open') {
    closeTakes();
    if (take?.id === rec.id) return; // already on the page
    flushSave();
    openProject(rec.data, { id: rec.id, createdAt: rec.createdAt });
  } else if (b.dataset.do === 'rename') {
    renameInline(li, rec);
  } else if (b.dataset.do === 'delete') {
    await deleteTake(rec.id);
    if (take?.id === rec.id) take.id = null; // still on the page, just no longer in the library
    await renderTakes();
    refreshTakeCount();
    const wasOpen = !!take && !take.id && take.createdAt === rec.createdAt;
    showToast(wasOpen
      ? `Deleted “${rec.title || 'Untitled'}” from the library. It’s still on the page, but changes won’t be saved.`
      : `Deleted “${rec.title || 'Untitled'}”`, async () => {
      await saveTake(rec);
      if (take && !take.id && take.createdAt === rec.createdAt) take.id = rec.id;
      refreshTakeCount();
      if (!$('takesSheet').hidden) renderTakes();
    });
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('takesSheet').hidden) closeTakes(); });
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
refreshTakeCount();

// ---------- Mozart's mistakes: log of corrections (no audio) ----------
function logFix(fix) {
  if (!take?.id || !fix) return;
  FX.record(take.id, history.past.length, fix);
  refreshFixCount();
}
function refreshFixCount() {
  const n = FX.summary().fixes; // same count as the Fixes screen (▲▲ on one note = one fix)
  ui.fixes.textContent = n ? `Fixes (${n})` : 'Fixes';
}
function renderFixes() {
  const s = FX.summary();
  $('fxTotals').textContent = s.fixes
    ? `${s.fixes} fix${s.fixes === 1 ? '' : 'es'} across ${s.editedTakes} take${s.editedTakes === 1 ? '' : 's'}` + (s.written ? ` · Mozart has written ${s.written} notes in ${s.takes} take${s.takes === 1 ? '' : 's'}` : '')
    : 'No fixes yet. When you correct a note Mozart got wrong, it’s counted here.';
  const max = Math.max(1, ...s.rows.map((r) => r.count));
  $('fxList').innerHTML = s.rows.map((r) => `
    <li class="fx-row">
      <div class="fx-top"><strong>${r.name}</strong><span>${r.count}</span></div>
      <div class="fx-bar"><i style="width:${Math.round((r.count / max) * 100)}%"></i></div>
      ${r.details.length ? `<small>${r.details.slice(0, 3).map(([d, n]) => `${n} × ${d}`).join(' · ')}</small>` : ''}
    </li>`).join('');
  $('fxSave').disabled = !s.fixes;
  $('fxClear').disabled = !s.fixes;
}
function openFixes() {
  if (session) return;
  closeEditor();
  if (exportSheet.isOpen) exportSheet.close();
  if (!$('takesSheet').hidden) closeTakes();
  renderFixes();
  $('fixesSheet').hidden = false;
  document.body.classList.add('editing');
  requestAnimationFrame(() => document.body.style.setProperty('--tray-h', `${$('fixesSheet').offsetHeight}px`));
}
function closeFixes() {
  $('fixesSheet').hidden = true;
  document.body.classList.remove('editing');
}
ui.fixes.addEventListener('click', openFixes);
$('fxClose').addEventListener('click', closeFixes);
$('fxSave').addEventListener('click', async () => {
  const blob = FX.exportLog();
  const name = `Thy Manuscript fixes ${localStamp().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  showToast(`Saved ${name}`);
});
$('fxClear').addEventListener('click', () => {
  const old = FX.clearLog();
  renderFixes(); refreshFixCount();
  showToast('Fix log cleared', () => { FX.restoreLog(old); refreshFixCount(); if (!$('fixesSheet').hidden) renderFixes(); });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('fixesSheet').hidden) closeFixes(); });
refreshFixCount();

// ---------- tuner (listens only: nothing is recorded or kept) ----------
const tuner = { t: null, session: null, tuned: new Set(), heldSince: 0 };
function tunerStrings() { return tuningStrings(); }
function renderTunerStrings(active = null) {
  const strings = tunerStrings();
  $('tnStrings').innerHTML = strings.map((m, i) => {
    const on = tuner.t?.lock === i;
    return `<button type="button" class="tn-string${on ? ' locked' : ''}${active === i ? ' active' : ''}${tuner.tuned.has(i) ? ' done' : ''}" data-i="${i}" aria-pressed="${on}">
      <strong>${stringName(i, strings).replace('low ', '').replace('high ', '')}</strong><small>${noteNameFlat(m)}</small>${tuner.tuned.has(i) ? '<i aria-label="in tune">✓</i>' : ''}</button>`;
  }).join('');
}
/** Say what the tuner is listening to, and why nothing is showing (nothing heard / sound but no clear note). */
function tunerStatus(r, level = 0) {
  const now = performance.now();
  if (r) tuner.lastNote = now;
  if (level >= 0.004) tuner.lastSound = now;
  if (now - (tuner.statusAt || 0) < 300) return;
  tuner.statusAt = now;
  const demo = tuner.demo;
  let text = demo ? 'Demo mode: this is a pretend guitar, not your microphone.' : `Listening to ${tuner.session?.label || 'the microphone'}`;
  if (!demo && tuner.session?.ctx.state !== 'running') text = 'The audio is paused. Tap anywhere to start listening.';
  else if (!demo && now - tuner.lastSound > 4000) text = `Waiting for a string. Nothing heard from ${tuner.session?.label || 'the microphone'}. Check it isn’t muted, or pick another one in the microphone list at the top.`;
  else if (!demo && now - tuner.lastNote > 4000) text = 'Hearing sound, but no clear note. Pluck one string and let it ring.';
  if ($('tnStatus').textContent !== text) $('tnStatus').textContent = text;
}
function showTuning(r, level) {
  tunerStatus(r, level);
  const needle = $('tnNeedle');
  if (!r) {
    needle.classList.add('off');
    tuner.heldSince = 0;
    // an old reading must not stay up as if it were still being heard
    if (tuner.shownAt && performance.now() - tuner.shownAt > 1200) {
      tuner.shownAt = 0;
      $('tnNote').textContent = '—';
      $('tnTarget').textContent = 'Play a string';
      $('tnAdvice').textContent = '\u00a0';
      $('tnAdvice').classList.remove('ok');
      $('tnStrings').querySelectorAll('.tn-string.active').forEach((b) => b.classList.remove('active'));
    }
    return;
  }
  tuner.shownAt = performance.now();
  const strings = tunerStrings();
  needle.classList.remove('off');
  const c = Math.max(-50, Math.min(50, r.cents));
  needle.style.left = `${50 + c}%`;
  needle.classList.toggle('ok', r.inTune);
  $('tnNote').textContent = noteNameFlat(Math.round(r.midi));
  $('tnTarget').textContent = r.string !== null
    ? `${stringName(r.string, strings)} string (${noteNameFlat(strings[r.string])})`
    : 'Not near an open string';
  const adv = $('tnAdvice');
  adv.classList.toggle('ok', r.inTune);
  if (r.string === null) adv.textContent = `${r.cents > 0 ? '+' : ''}${r.cents} cents`;
  else if (r.inTune) adv.textContent = 'In tune ✓';
  else if (Math.abs(r.cents) > 100 && tuner.t?.lock === null) adv.textContent = 'Is this the right string? Tap the string you’re tuning.'; // never advise a big turn on a guess
  else if (r.cents < 0) adv.textContent = `${Math.abs(r.cents) > 50 ? 'Much too low' : 'Too low'} · tighten ↑ (${r.cents} cents)`;
  else adv.textContent = `${r.cents > 50 ? 'Much too high' : 'Too high'} · loosen ↓ (+${r.cents} cents)`;
  // a string counts as tuned once it has stayed in tune for half a second
  if (r.inTune && r.string !== null) {
    tuner.heldSince ||= performance.now();
    if (performance.now() - tuner.heldSince > 500 && !tuner.tuned.has(r.string)) {
      tuner.tuned.add(r.string);
      mozart.say('✓');
      renderTunerStrings(r.string);
      return;
    }
  } else tuner.heldSince = 0;
  $('tnStrings').querySelectorAll('.tn-string').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === r.string));
}
async function openTuner() {
  if (session || busy) return;
  stopJam();
  closeEditor();
  if (exportSheet.isOpen) exportSheet.close();
  if (!$('takesSheet').hidden) closeTakes();
  if (!$('fixesSheet').hidden) closeFixes();
  stopPlayback();
  tuner.tuned.clear();
  $('tnNote').textContent = '—';
  $('tnTarget').textContent = 'Play a string';
  $('tnAdvice').textContent = ' ';
  $('tnHint').textContent = guitar.capo ? `Tune with the capo off. Your tuning: ${tuningLabel()}.` : `Your tuning: ${tuningLabel()}. Tap a string to tune only that one.`;
  tuner.demo = ui.mic.value === '__demo__';
  tuner.lastSound = tuner.lastNote = performance.now();
  tuner.statusAt = 0;
  $('tnStatus').textContent = tuner.demo ? 'Demo mode: this is a pretend guitar, not your microphone.' : 'Opening the microphone…';
  $('tnUseMic').hidden = !tuner.demo;
  $('tunerSheet').hidden = false;
  document.body.classList.add('editing');
  renderTunerStrings();
  requestAnimationFrame(() => document.body.style.setProperty('--tray-h', `${$('tunerSheet').offsetHeight}px`));
  try {
    const id = store.get('mic', '');
    tuner.session = tuner.demo ? openTuneDemo() : await openMic(id === '__demo__' ? '' : id);
  } catch (err) {
    $('tnStatus').textContent = '';
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    $('tnTarget').textContent = denied ? 'Microphone permission was blocked. Allow it in the browser’s site settings.' : (err?.message || 'Could not open the microphone.');
    return;
  }
  if ($('tunerSheet').hidden) { tuner.session.close(); tuner.session = null; return; } // closed while asking for the mic
  tuner.lastSound = tuner.lastNote = performance.now(); // (not counting the time spent on the permission prompt)
  tuner.shownAt = 0;
  tuner.t = new Tuner({ strings: tunerStrings(), onReading: showTuning });
  tuner.t.start(tuner.session);
  mozart.set('listening');
}
function closeTuner() {
  tuner.t?.stop(); tuner.t = null;
  tuner.session?.close(); tuner.session = null;
  $('tunerSheet').hidden = true;
  document.body.classList.remove('editing');
  if (!session) mozart.set('asleep');
}
/** ?demo: a guitar being tuned (each string a little off, then in tune), since there's no mic here. */
function openTuneDemo() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  const strings = tunerStrings();
  const plan = [[0, -30], [0, 0], [3, 18], [3, 0], [5, -8], [5, 0]]; // [string, cents]
  // each "pluck" is a filtered sawtooth at an exact, known offset, so the tuner's reading can be checked
  plan.forEach(([s, cents], k) => {
    const t = ctx.currentTime + 0.2 + k * 1.6;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (strings[s] + cents / 100 - 69) / 12);
    const lp = ctx.createBiquadFilter(); lp.frequency.value = 1200;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    osc.connect(lp).connect(g).connect(analyser);
    osc.start(t); osc.stop(t + 1.55);
  });
  return { ctx, analyser, close() { ctx.close().catch(() => {}); } };
}
$('tuneBtn').addEventListener('click', openTuner);
$('tnUseMic').addEventListener('click', () => { // out of the demo: listen to the real microphone
  closeTuner();
  ui.mic.value = '';
  ui.mic.dispatchEvent(new Event('change'));
  openTuner();
});
$('tnClose').addEventListener('click', closeTuner);
$('tnStrings').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b || !tuner.t) return;
  const i = Number(b.dataset.i);
  tuner.t.lock = tuner.t.lock === i ? null : i;
  tuner.t.recent = [];
  renderTunerStrings();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('tunerSheet').hidden) closeTuner(); });

// ---------- iPhone ----------
// Safari may hold audio until the next touch (or pause it after a call); any tap wakes it.
document.addEventListener('pointerdown', () => { wake(session?.ctx); wake(tuner.session?.ctx); wake(earCtx); }, { passive: true, capture: true });

const IOS_EDITION = document.documentElement.dataset.edition === 'ios';
function showInstallBanner() {
  const banner = $('installBanner');
  const key = IOS_EDITION ? 'hideInstall.ios' : 'hideInstall.main';
  if (!IS_IOS || IS_STANDALONE || store.get(key, '0') === '1') return;
  const text = $('installText');
  if (IOS_EDITION) {
    text.innerHTML = '<strong>Install Music Scribe iOS:</strong> tap <b>Share</b> '
      + '<span class="share-glyph" aria-hidden="true">⬆︎</span> (on newer iPhones it’s in Safari’s <b>⋯</b> menu), '
      + 'then <b>Add to Home Screen</b>, and keep <b>Open as Web App</b> on.';
  } else {
    text.innerHTML = '<strong>On an iPhone?</strong> <a href="ios/">Open Music Scribe iOS</a>, '
      + 'the iPhone edition you can add to your Home Screen.';
  }
  banner.hidden = false;
  $('installClose').addEventListener('click', () => { banner.hidden = true; store.set(key, '1'); });
}
showInstallBanner();

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
  buildSong, openProject, get exportModel() { return take?.model ? { ...take.model, header: '' } : null; },
};
