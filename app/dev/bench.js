// Accuracy test bench (developer tool, not part of the app's UI).
// Renders guitar-like test songs (plucked-string synth, human timing, strums, ringing notes, room noise),
// runs them through the same pipeline as a real take, and scores the result against what was "played".
//
// Use from the browser console on the app's page:
//   const B = await import('./dev/bench.js'); console.table((await B.run()).rows);
// No audio is stored: each song is rendered in memory, scored, and dropped.

import { playPluck } from '../js/pluck.js';
import { FretPicker, TUNINGS } from '../js/guitar.js';
import { transcribe } from '../js/transcribe.js';
import { onsetEvents, estimateTempo, detectMeter, quantize, STRUM_SPAN } from '../js/rhythm.js';
import { makeNotes, removeClickNotes } from '../js/notes-post.js';

const BP_URL = 'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/+esm';
const rawCache = new Map(); // song name → the model's raw output, so clean-up settings can be compared quickly

// ---------- the test songs: [beat, [midi…], lengthInBeats] ----------
const bars = (n, beatsPerBar, fn) => Array.from({ length: n }, (_, b) => fn(b).map(([t, m, l]) => [b * beatsPerBar + t, m, l])).flat();
const CH = {
  G: [43, 47, 50, 55, 59, 67], Em: [40, 47, 52, 55, 59, 64], C: [48, 52, 55, 60, 64], D: [50, 57, 62, 66],
  Am: [45, 52, 57, 60, 64], F: [41, 48, 53, 57, 60, 65],
};
const DEMO = [[0, [40], 1], [1, [45], 1], [2, [50], 0.5], [2.5, [55], 0.5], [3, [59], 1], [4, CH.C, 2], [6, CH.G, 2],
  [8, [57], 0.5], [8.5, [60], 0.5], [9, [64], 1], [10, [62], 1], [11, [60], 1], [12, CH.Am, 1], [13, CH.Am, 1], [14, CH.F, 2]];
export const SONGS = [
  { name: 'Clean demo (guard)', bpm: 100, meter: 4, synth: 'triangle', notes: [...DEMO, ...DEMO.map(([t, m, l]) => [t + 16, m, l])] },
  {
    name: 'Riff + chords', bpm: 100, meter: 4,
    notes: [[0, [40], 1], [1, [45], 1], [2, [50], 0.5], [2.5, [55], 0.5], [3, [59], 1], [4, CH.C, 2], [6, CH.G, 2],
      [8, [57], 0.5], [8.5, [60], 0.5], [9, [64], 1], [10, [62], 1], [11, [60], 1], [12, CH.Am, 1], [13, CH.Am, 1], [14, CH.F, 2]],
  },
  {
    name: 'Fingerpicking', bpm: 80, meter: 4,
    notes: bars(4, 4, (b) => {
      const [lo, alt, a, c] = [[45, 52, 60, 64], [48, 52, 60, 64], [43, 50, 55, 59], [40, 47, 55, 59]][b];
      return [[0, [lo], 0.5], [0.5, [a], 0.5], [1, [c], 0.5], [1.5, [a], 0.5], [2, [alt], 0.5], [2.5, [a], 0.5], [3, [c], 0.5], [3.5, [a], 0.5]];
    }),
  },
  {
    name: 'Waltz (3/4)', bpm: 120, meter: 3,
    notes: bars(8, 3, (b) => {
      const [bass, up] = [[43, [55, 59, 67]], [50, [57, 62, 66]], [40, [55, 59, 64]], [48, [55, 60, 64]]][b % 4];
      return [[0, [bass], 1], [1, up, 1], [2, up, 1]];
    }),
  },
  {
    name: 'Fast run', bpm: 140, meter: 4,
    notes: [
      ...[57, 60, 62, 64, 67, 69, 72, 69, 67, 64, 62, 60, 57, 60, 62, 64].map((m, i) => [i * 0.5, [m], 0.5]),
      ...Array.from({ length: 16 }, (_, i) => [8 + i * 0.25, [[57, 60, 62, 64][i % 4]], 0.25]),
      [12, [69], 4],
    ],
  },
  {
    name: 'Slow melody', bpm: 66, meter: 4,
    notes: [[0, [64], 2], [2, [67], 1], [3, [69], 1], [4, [71], 3], [8, [69], 1.5], [9.5, [67], 0.5], [10, [64], 2], [12, [62], 4]],
  },
  {
    name: 'Drop D power chords', bpm: 110, meter: 4, lowest: 38,
    notes: bars(4, 4, () => [[0, [38, 45, 50], 0.5], [0.5, [38, 45, 50], 0.5], [1, [38, 45, 50], 1], [2, [41, 48, 53], 1], [3, [43, 50, 55], 1]]),
  },
  {
    name: 'Strumming pattern', bpm: 96, meter: 4,
    notes: bars(4, 4, (b) => {
      const c = [CH.G, CH.Em, CH.C, CH.D][b];
      const up = c.slice(-3); // upstrokes catch the top strings
      return [[0, c, 1], [1, c, 0.5], [1.5, up, 1], [2.5, up, 0.5], [3, c, 0.5], [3.5, up, 0.5]];
    }),
  },
];

// Finger-lift tests (not in the averages above): a slow scale on the low E string where lifting the
// finger lets the open string ring (some as loud as the fretted note, as at high frets), plus two
// guards whose open strings are played on purpose and must stay. Run with liftCheck().
const LOW_E_UP = Array.from({ length: 18 }, (_, k) => 42 + k);           // frets 2 → 19
const LOW_E = [...LOW_E_UP, ...LOW_E_UP.slice(0, -1).reverse()];        // and back down
export const LIFT_SONGS = [
  {
    name: 'Low E scale + lift noise', bpm: 100, meter: 4, lowest: 40,
    notes: LOW_E.map((m, k) => [k * 2, [m], 2]),
    // the open E rings late in a note as the finger lifts, just before the next fret; levels vary
    ghosts: LOW_E.flatMap((m, k) => (k % 3 === 1 || k === 16 ? [[k * 2 + 1.55, 40, [0.22, 0.35, 0.5][k % 3 === 1 ? (k >> 1) % 3 : 2]]] : []))
      .concat([[16 * 2 + 1.8, 40, 0.3]]),                                // a doubled ghost (as after fret 18)
  },
  {
    // the 2026-11-17 14.25 take: one fret per bar up the low E; an octave ghost after fret 2 and a
    // quieter A ringing in sympathy with fret 10 (written as a "D5" chord, which threw the tab off the string)
    name: 'Low E climb 1-19 (one string)', bpm: 100, meter: 4, lowest: 40,
    notes: Array.from({ length: 19 }, (_, k) => [k * 4, [41 + k], 4]),
    ghosts: [[6.4, 54, 0.3], [36.02, 57, 0.28], [22.6, 40, 0.3]],
  },
  {
    name: 'Pedal open E (guard)', bpm: 100, meter: 4, lowest: 40,
    notes: [55, 57, 59, 60, 62, 64, 62, 60, 59, 57].flatMap((m, k) => [[k * 2, [40], 1], [k * 2 + 1, [m], 1]]),
  },
  {
    name: 'Riff down to open E (guard)', bpm: 100, meter: 4, lowest: 40,
    notes: [0, 4, 8, 12].flatMap((b) => [[b, [52], 1], [b + 1, [50], 1], [b + 2, [48], 1], [b + 3, [40], 1]]),
  },
];

// ---------- rendering ----------
function rng(seed) { // small deterministic generator, so every run plays the songs the same way
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Returns { samples, sampleRate, truth: [{ midi, start }] } for a song. */
export async function render(song, opts = {}) {
  const { seed = 7, jitterMs = 10, noise = 0.004, sampleRate = 44100 } = opts;
  const rand = rng(seed);
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5; // roughly -1..1, bell-shaped
  const p = 60 / song.bpm;
  const lead = 0.5;
  const last = Math.max(...song.notes.map(([t, , l]) => t + l));
  const dur = lead + last * p + 1.5;
  const oc = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);
  const body = oc.createBiquadFilter(); // a little "wooden box" colour
  body.type = 'peaking'; body.frequency.value = 220; body.Q.value = 1.2; body.gain.value = 4;
  body.connect(oc.destination);
  const truth = [];
  if (song.synth === 'triangle') { // exactly what the app's ?demo mode plays
    for (const [beat, midis, len] of song.notes) {
      const t = lead + beat * p;
      const level = midis.length > 1 ? 0.13 : 0.3;
      midis.forEach((m, k) => {
        const osc = oc.createOscillator(), lpf = oc.createBiquadFilter(), g = oc.createGain();
        const at = t + k * 0.012, d = len * p * 0.95;
        osc.type = 'triangle'; osc.frequency.value = 440 * Math.pow(2, (m - 69) / 12); lpf.frequency.value = 3000;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(level, at + 0.008);
        g.gain.exponentialRampToValueAtTime(level * 0.12, at + d); g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.03);
        osc.connect(lpf).connect(g).connect(oc.destination); osc.start(at); osc.stop(at + d + 0.05);
        truth.push({ midi: m, start: at, beat, len });
      });
    }
    const b0 = await oc.startRendering();
    return { samples: b0.getChannelData(0).slice(), sampleRate, truth, lead };
  }
  // like a real guitar: each note sits on a string, and a new note on that string cuts off the old one
  const strings = song.lowest === 38 ? TUNINGS.dropD.strings : TUNINGS.standard.strings;
  const picker = new FretPicker(strings, 0);
  const voices = new Map();
  // optional: a metronome on every beat leaking in through a speaker (distorted, cabinet thump, echoes)
  let clickTimes = null, drumHits = null;
  if (opts.click) {
    const { clickSound, setClickStyle } = await import('../js/metronome.js');
    setClickStyle(opts.click.style || 'tone');
    const harsh = opts.click.harsh ?? 3;
    const pre = oc.createGain(); pre.gain.value = harsh * (opts.click.level ?? 1);
    const sh = oc.createWaveShaper(); const cv = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; cv[i] = Math.tanh(harsh * x + 0.4 * x * x); }
    sh.curve = cv; pre.connect(sh); sh.connect(oc.destination);
    for (const [f, q, g] of [[110, 15, 6 * harsh], [196, 12, 3 * harsh], [330, 10, 2 * harsh]]) {
      const b = oc.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
      const gg = oc.createGain(); gg.gain.value = g; sh.connect(b).connect(gg).connect(oc.destination);
    }
    for (const [ms, g] of [[9, 0.4], [17, 0.3], [31, 0.2]]) {
      const d = oc.createDelay(0.1); d.delayTime.value = ms / 1000; const dg = oc.createGain(); dg.gain.value = g;
      sh.connect(d).connect(dg).connect(oc.destination);
    }
    clickTimes = [];
    if (opts.click.drums) {
      const D = await import('../js/drums.js');
      const time = `${song.meter}/4`;
      const hits = D.drumTimes({ id: opts.click.drums, time, fills: true }, song.bpm, lead, dur - 1);
      drumHits = hits;
      const into = opts.click.thin ? D.thinFilter(oc, pre) : pre;
      for (let b = 0; lead + b * song.meter * p < dur - 1; b++) for (const h of D.drumBar(opts.click.drums, time, b, true)) D.playDrum(oc, h.drum, lead + b * song.meter * p + h.slot * p / 4, h.vel, into, 1);
      clickTimes = D.PITCHED.flatMap((d) => hits[d] || []).filter((t) => t < dur - 1).sort((a, b) => a - b);
    } else for (let k = 0; k * p < dur - 1; k++) { const t = lead + k * p; clickTimes.push(t); clickSound(oc, t, k % song.meter === 0, pre); }
    setClickStyle('tone');
  }
  const realRandom = Math.random;
  Math.random = rand; // the pluck synth's string noise becomes repeatable too
  try {
  for (const [beat, midis, len] of song.notes) {
    const at = lead + beat * p + gauss() * jitterMs / 1000;
    const strum = midis.length > 1 ? 0.014 + rand() * 0.016 : 0;
    const volume = (midis.length > 1 ? 0.42 : 0.5) * (0.75 + rand() * 0.5);
    const placed = picker.pickChord(midis); // sorted low → high, same order playPluck uses
    const keys = placed.map((x) => (x.pos ? `s${x.pos.stringIndex}` : `m${x.midi}`));
    playPluck(oc, midis, { at, strum, volume, dest: body, voices, keys });
    [...midis].sort((a, b) => a - b).forEach((m, k) => truth.push({ midi: m, start: at + k * strum, beat, len }));
  }
  // finger-lift noise: quiet open strings / scratches right as notes are released (not in the truth)
  for (const [beat, midi, level] of song.ghosts || []) {
    playPluck(oc, [midi], { at: lead + beat * p + gauss() * 0.01, strum: 0, volume: level, dest: body });
  }
  } finally { Math.random = realRandom; }
  const buf = await oc.startRendering();
  const samples = buf.getChannelData(0).slice();
  let lp = 0; // room noise: soft hiss
  for (let i = 0; i < samples.length; i++) { lp = lp * 0.9 + (rand() * 2 - 1) * 0.1; samples[i] += lp * noise * 3; }
  return { samples, sampleRate, truth, lead, clickTimes, drumHits };
}

// ---------- scoring ----------
function scoreNotes(truth, got, tol = 0.07) {
  const used = new Set();
  let hit = 0, octave = 0;
  const missed = [];
  for (const t of truth) {
    let best = -1, bestD = tol;
    got.forEach((g, i) => { if (!used.has(i) && g.midi === t.midi && Math.abs(g.start - t.start) <= bestD) { best = i; bestD = Math.abs(g.start - t.start); } });
    if (best >= 0) { used.add(best); hit++; } else missed.push(t);
  }
  const extra = got.filter((_, i) => !used.has(i));
  for (const e of extra) if (truth.some((t) => Math.abs(t.start - e.start) <= tol && Math.abs(t.midi - e.midi) % 12 === 0 && t.midi !== e.midi)) octave++;
  const precision = got.length ? hit / got.length : 0, recall = truth.length ? hit / truth.length : 0;
  return { hit, missed, extra, octave, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}
/** How many played onsets ended up on the right 16th-note slot (best whole-grid alignment). */
function scoreRhythm(song, events) {
  const want = new Map();
  for (const [beat, midis] of song.notes) want.set(Math.round(beat * 4), midis);
  const got = new Map(events.map((e) => [e.slot, e.keys]));
  let best = { onGrid: 0, exact: 0, d: 0 };
  for (let d = -16; d <= 16; d++) {
    let onGrid = 0, exact = 0;
    for (const [slot, midis] of want) {
      const g = got.get(slot + d);
      if (!g) continue;
      onGrid++;
      if (g.length === midis.length && [...midis].sort((a, b) => a - b).every((m, i) => m === g[i])) exact++;
    }
    if (onGrid > best.onGrid || (onGrid === best.onGrid && exact > best.exact)) best = { onGrid, exact, d };
  }
  return { ...best, total: want.size, extraEvents: events.length - best.onGrid };
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** Run one song through transcription + rhythm analysis and score it. */
export async function runSong(song, opts = {}) {
  const key = `${song.name}|${opts.seed ?? 7}|${opts.click ? JSON.stringify(opts.click) : ''}`;
  if (!rawCache.has(key)) {
    const r0 = await render(song, opts);
    const raw = await transcribe(r0.samples, r0.sampleRate, () => {}, { raw: true });
    rawCache.set(key, { raw, truth: r0.truth, lead: r0.lead, clickTimes: r0.clickTimes, drumHits: r0.drumHits });
  }
  const r = rawCache.get(key);
  const bp = await import(BP_URL);
  const useClicks = r.clickTimes && opts.clickAware !== false;
  let notes = makeNotes(bp, r.raw, { ...opts.params, ...(useClicks ? { clickTimes: r.clickTimes } : {}) });
  if (useClicks) {
    if (r.drumHits) for (const d of ['kick', 'snare', 'rim', 'tomH', 'tomM', 'tomL']) { if (r.drumHits[d]?.length) notes = removeClickNotes(notes, r.drumHits[d], opts.drumLeak || {}); }
    else notes = removeClickNotes(notes, r.clickTimes);
  }
  const floor = Math.min(38, song.lowest ?? 40);
  notes = notes.filter((n) => n.midi >= floor);
  const n = scoreNotes(r.truth, notes);
  onsetEvents.span = opts.span ?? STRUM_SPAN;
  const events = onsetEvents(notes);
  const est = estimateTempo(events, { halfCheck: opts.halfCheck ?? true });
  let tempo = null, rhythm = { onGrid: 0, exact: 0, total: song.notes.length, extraEvents: 0 }, meter = '?';
  if (est) {
    const m = detectMeter(events, est.bpm, est.beat0, null, { bassAccent: opts.bassAccent ?? true });
    tempo = { bpm: est.bpm, beat0: est.beat0, meter: m.meter, offset: m.offset };
    meter = m.meter;
    // score the rhythm on the true tempo's grid only if the tempo was found; else it's all wrong anyway
    rhythm = scoreRhythm(song, quantize(notes, tempo).events);
  }
  onsetEvents.span = STRUM_SPAN;
  const ratio = est ? est.bpm / song.bpm : 0;
  const tempoNote = !est ? 'none' : Math.abs(ratio - 1) < 0.03 ? 'ok' : Math.abs(ratio - 2) < 0.06 ? 'double' : Math.abs(ratio - 0.5) < 0.03 ? 'half' : 'wrong';
  return {
    row: {
      song: song.name,
      'notes found': `${n.hit}/${r.truth.length} (${pct(n.recall)})`,
      'wrong extras': `${n.extra.length}${n.octave ? ` (${n.octave} octave)` : ''}`,
      'note score': pct(n.f1),
      tempo: `${est ? est.bpm : '—'} (true ${song.bpm}) ${tempoNote}`,
      meter: `${meter}/4 ${meter === song.meter ? 'ok' : `WRONG (true ${song.meter}/4)`}`,
      'onsets on the right 16th': `${rhythm.onGrid}/${rhythm.total} (${pct(rhythm.onGrid / rhythm.total)})`,
      'exact chords/notes': `${rhythm.exact}/${rhythm.total} (${pct(rhythm.exact / rhythm.total)})`,
    },
    detail: {
      f1: n.f1, recall: n.recall, precision: n.precision, tempoOk: tempoNote === 'ok', meterOk: meter === song.meter,
      onGrid: rhythm.onGrid / rhythm.total, exact: rhythm.exact / rhythm.total,
      missed: n.missed.map((t) => `${t.midi}@${t.beat}`), extra: n.extra.map((e) => `${e.midi}@${((e.start - r.lead) / (60 / song.bpm)).toFixed(2)}`),
    },
  };
}

/** Options that switch every 2026-11 accuracy rule off, to compare against how the app used to behave. */
export const OLD = { halfCheck: false, bassAccent: false, span: 0.07, params: { splitEnergy: 0, splitOnsetKeep: 0, weakAmp: 0, weakOnset: 0 } };

/** Run every song. Returns { rows (for console.table), details, summary }. */
export async function run(opts = {}) {
  const rows = [], details = {};
  for (const song of SONGS) {
    if (opts.only && !opts.only.includes(song.name)) continue;
    const r = await runSong(song, opts);
    rows.push(r.row);
    details[song.name] = r.detail;
  }
  const d = Object.values(details);
  const avg = (k) => d.reduce((s, x) => s + x[k], 0) / d.length;
  return {
    rows, details,
    summary: { songs: d.length, noteScore: pct(avg('f1')), tempoRight: `${d.filter((x) => x.tempoOk).length}/${d.length}`, meterRight: `${d.filter((x) => x.meterOk).length}/${d.length}`, onsetsOnGrid: pct(avg('onGrid')), exact: pct(avg('exact')) },
  };
}

/** For diagnosis: the notes the pipeline produced for a song, next to what was played. */
export async function notesFor(name, opts = {}) {
  const song = [...SONGS, ...LIFT_SONGS].find((s) => s.name === name);
  await runSong(song, opts);
  const r = rawCache.get(`${song.name}|${opts.seed ?? 7}|${opts.click ? JSON.stringify(opts.click) : ''}`);
  const bp = await import(BP_URL);
  return { song, truth: r.truth, lead: r.lead, notes: makeNotes(bp, r.raw, opts.params), raw: r.raw, bp };
}

/**
 * Finger-lift check: each LIFT_SONGS take through the real transcriber, then Simple mode with the
 * lift filter off and on. Counts are against what was really played (the ghosts aren't in it).
 */
export async function liftCheck(opts = {}) {
  const R = await import('../js/rhythm.js');
  const opens = [40, 45, 50, 55, 59, 64];
  const rows = [];
  for (const song of LIFT_SONGS) {
    const f = await notesFor(song.name, opts);
    const notes = f.notes.filter((n) => n.midi >= 38);
    const tempo = { bpm: song.bpm, beat0: f.lead, meter: song.meter };
    const truth = f.truth.map((t) => t.midi);
    const count = (releaseFilter) => {
      const got = R.quantize(notes, tempo, { simple: true, openStrings: opens, releaseFilter }).events.flatMap((e) => e.keys);
      const d = Array.from({ length: got.length + 1 }, () => new Array(truth.length + 1).fill(0));
      for (let i = 1; i <= got.length; i++) for (let j = 1; j <= truth.length; j++) d[i][j] = got[i - 1] === truth[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
      const m = d[got.length][truth.length];
      return `${got.length} written · ${got.length - m} wrong · ${truth.length - m} missed`;
    };
    rows.push({ song: song.name, played: truth.length, ghosts: song.ghosts?.length ?? 0, 'filter off': count(false), 'filter on': count(true) });
  }
  return rows;
}

/**
 * Everything the finger-lift filter is judged on: the lift takes (filter off/on), how many REAL
 * notes it removes from each bench song (must stay 0), and the low E scale as written vs played.
 */
export async function ghostReport(opts = {}) {
  const R = await import('../js/rhythm.js');
  const opens = [40, 45, 50, 55, 59, 64];
  const lines = (await liftCheck(opts)).map((r) => `${r.song}: off ${r['filter off']} | on ${r['filter on']}`);
  lines.push('');
  for (const s of SONGS) {
    const f = await notesFor(s.name, opts);
    const kept = new Set(R.dropReleaseNoise(f.notes, opens).map((n) => `${n.start}:${n.midi}`));
    const dropped = f.notes.filter((n) => !kept.has(`${n.start}:${n.midi}`));
    const real = (n) => f.truth.some((t) => t.midi === n.midi && Math.abs(t.start - n.start) < 0.06);
    lines.push(`${s.name}: real notes removed ${dropped.filter(real).map((n) => `${n.midi}@${n.start.toFixed(2)}`).join(' ') || 0}, junk removed ${dropped.filter((n) => !real(n)).length}`);
  }
  const { FretPicker } = await import('../js/guitar.js');
  const STR = ['E', 'A', 'D', 'G', 'B', 'e'];
  for (const song of LIFT_SONGS.slice(0, 2)) {
    const f = await notesFor(song.name, opts);
    const ev = R.quantize(f.notes.filter((n) => n.midi >= 38), { bpm: 100, beat0: f.lead, meter: 4 }, { simple: true, openStrings: opens }).events;
    const picker = new FretPicker();
    const tab = ev.map((e) => picker.pickChord(e.keys).map((x) => (x.pos ? `${STR[x.pos.stringIndex]}${x.pos.fret}` : '?')).join('+'));
    lines.push('', song.name, `  written: ${ev.map((e) => e.keys.join('+')).join(' ')}`, `  played:  ${f.truth.map((t) => t.midi).join(' ')}`, `  tab:     ${tab.join(' ')}`);
  }
  return lines.join('\n');
}
