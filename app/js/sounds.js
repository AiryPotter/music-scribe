// The instruments music is played back with. All made here from maths (no recordings, no downloads).
import { playPluck } from './pluck.js';

// program: General MIDI number (0-based) used in MIDI and MusicXML files · group: where it's listed
export const SOUND_GROUPS = ['Guitars', 'Basses', 'Keys', 'Strings', 'Brass & woodwind', 'Synths & voices', 'Mallets'];
export const SOUNDS = [
  ['classic', 'Harpsichord (original)', 25, 'Acoustic Guitar', 2],
  ['acoustic', 'Acoustic guitar', 25, 'Acoustic Guitar', 0],
  ['nylon', 'Nylon guitar', 24, 'Classical Guitar', 0],
  ['twelve', '12-string guitar', 25, '12-String Guitar', 0],
  ['clean', 'Clean electric guitar', 27, 'Electric Guitar (clean)', 0],
  ['crunch', 'Crunch guitar', 29, 'Overdriven Guitar', 0],
  ['heavy', 'Heavy guitar', 30, 'Distortion Guitar', 0],
  ['muted', 'Palm-muted guitar', 28, 'Muted Guitar', 0],
  ['banjo', 'Banjo', 105, 'Banjo', 0],
  ['bass', 'Bass guitar', 33, 'Electric Bass', 1],
  ['upright', 'Upright bass', 32, 'Acoustic Bass', 1],
  ['slap', 'Slap bass', 36, 'Slap Bass', 1],
  ['synthbass', 'Synth bass', 38, 'Synth Bass', 1],
  ['piano', 'Grand piano', 0, 'Grand Piano', 2],
  ['epiano', 'Electric piano', 4, 'Electric Piano', 2],
  ['clav', 'Clavinet', 7, 'Clavinet', 2],
  ['organ', 'Organ', 16, 'Organ', 2],
  ['church', 'Church organ', 19, 'Church Organ', 2],
  ['strings', 'Dreamy strings', 48, 'Strings', 3],
  ['violin', 'Violin', 40, 'Violin', 3],
  ['cello', 'Cello', 42, 'Cello', 3],
  ['harp', 'Harp', 46, 'Harp', 3],
  ['trumpet', 'Trumpet', 56, 'Trumpet', 4],
  ['sax', 'Saxophone', 65, 'Alto Saxophone', 4],
  ['flute', 'Flute', 73, 'Flute', 4],
  ['synth', 'Synth lead', 81, 'Synth Lead', 5],
  ['pad', 'Warm pad', 89, 'Synth Pad', 5],
  ['choir', 'Choir', 52, 'Choir', 5],
  ['marimba', 'Marimba', 12, 'Marimba', 6],
  ['vibes', 'Vibraphone', 11, 'Vibraphone', 6],
].map(([id, name, program, instrument, g]) => ({ id, name, program, instrument, group: SOUND_GROUPS[g] }));
export const DEFAULT_SOUND = 'classic';
export const soundInfo = (id) => SOUNDS.find((s) => s.id === id) || SOUNDS[0];

const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Add a fading sine: amp, time to fall 60 dB. */
function ring(out, sr, f, amp, t60) {
  if (f <= 0 || f > sr * 0.45) return;
  const w = (2 * Math.PI * f) / sr, r = Math.exp(-6.908 / (t60 * sr));
  const a1 = 2 * r * Math.cos(w), a2 = -r * r;
  let y1 = amp * Math.sin(w), y2 = 0;
  out[0] += y1;
  for (let i = 1; i < out.length; i++) { const y = a1 * y1 + a2 * y2; out[i] += y; y2 = y1; y1 = y; }
}
/** A short puff of soft noise (a hammer, a pick, a mallet). */
function knock(out, sr, amp, secs, smooth) {
  const n = Math.min(out.length, Math.floor(sr * secs));
  let lp = 0;
  for (let i = 0; i < n; i++) { lp = lp * smooth + (Math.random() * 2 - 1) * (1 - smooth); out[i] += lp * amp * (1 - i / n) ** 2; }
}
function lowpass(x, sr, fc) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  let y = 0;
  for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] = y; }
}

// how each struck or plucked instrument is built: (samples to fill, sample rate, frequency, midi)
const MAKE = {
  acoustic(o, sr, f, midi) {
    const base = Math.max(1.2, 5 - (midi - 40) * 0.08);
    for (let n = 1; n <= 24; n++) ring(o, sr, f * n * Math.sqrt(1 + 0.00006 * n * n), (Math.abs(Math.sin(Math.PI * n * 0.17)) / n ** 1.25) * Math.exp((-n * f) / 5200), base / (1 + 0.16 * (n - 1)));
    ring(o, sr, 104, 0.09, 0.18); ring(o, sr, 212, 0.05, 0.13); // the wooden body
    knock(o, sr, 0.5, 0.012, 0.6);
  },
  heavy(o, sr, f) {
    for (let n = 1; n <= 14; n++) ring(o, sr, f * n, 0.8 / n, 7 / (1 + 0.06 * n));
    knock(o, sr, 0.8, 0.02, 0.3);
    for (let i = 0; i < o.length; i++) o[i] = Math.tanh(7 * o[i] + 0.25) - Math.tanh(0.25); // overdrive
    lowpass(o, sr, 4200); lowpass(o, sr, 4200);                                            // the speaker cabinet
    const low = o.slice(); lowpass(low, sr, 70);
    for (let i = 0; i < o.length; i++) o[i] -= low[i];
  },
  bass(o, sr, f) {
    for (let n = 1; n <= 10; n++) ring(o, sr, f * n, Math.abs(Math.sin(Math.PI * n * 0.3)) / n ** 1.5, 4 / (1 + 0.45 * (n - 1)));
    knock(o, sr, 0.35, 0.015, 0.8);
  },
  piano(o, sr, f, midi) {
    const B = 0.0003 * 2 ** ((midi - 60) / 14), base = Math.min(9, Math.max(1.6, 7 * 2 ** ((50 - midi) / 22)));
    for (let n = 1; n <= 22; n++) {
      const fn = f * 0.998 * n * Math.sqrt(1 + B * n * n); // (stiff strings sound a touch sharp)
      const a = ((0.12 + Math.abs(Math.sin((Math.PI * n) / 8))) / n ** 1.05) * Math.exp((-n * f) / 3800), t = base / (1 + 0.3 * (n - 1));
      ring(o, sr, fn * 0.9998, a * 0.6, t); ring(o, sr, fn * 1.0002, a * 0.4, t * 1.7); // each note has more than one string
    }
    knock(o, sr, 0.5, 0.025, 0.9);
  },
  epiano(o, sr, f) {
    for (const [r, a, t] of [[1, 1, 3.2], [2, 0.22, 2], [3, 0.1, 1.2], [4, 0.06, 0.8], [7.1, 0.16, 0.28], [13.9, 0.06, 0.12]]) ring(o, sr, f * r, a, t);
    for (let i = 0; i < o.length; i++) o[i] = Math.tanh(1.5 * o[i]) / 1.5;
  },
  marimba(o, sr, f) {
    for (const [r, a, t] of [[1, 1, 1.3], [3.93, 0.28, 0.3], [9.2, 0.1, 0.1]]) ring(o, sr, f * r, a, t);
    knock(o, sr, 0.5, 0.012, 0.85);
  },
};
/** A plucked string: n harmonics, plucked at `where` along it, darker the smaller `dark`, ringing for `base` seconds. */
function string(o, sr, f, { n = 18, where = 0.18, roll = 1.25, dark = 5000, base = 3, damp = 0.16, stiff = 0.00005, gain = 1 }) {
  for (let k = 1; k <= n; k++) ring(o, sr, f * k * Math.sqrt(1 + stiff * k * k), (gain * Math.abs(Math.sin(Math.PI * k * where)) / k ** roll) * Math.exp((-k * f) / dark), base / (1 + damp * (k - 1)));
}
const ringFor = (midi, low, per) => Math.max(0.8, low - (midi - 40) * per);
Object.assign(MAKE, {
  nylon(o, sr, f, midi) { string(o, sr, f, { n: 16, where: 0.28, roll: 1.6, dark: 3200, base: ringFor(midi, 3.4, 0.06), damp: 0.3 }); ring(o, sr, 98, 0.08, 0.2); ring(o, sr, 200, 0.06, 0.15); knock(o, sr, 0.25, 0.015, 0.8); },
  twelve(o, sr, f, midi) {
    const base = ringFor(midi, 4.6, 0.07);
    string(o, sr, f, { n: 20, base });
    string(o, sr, (midi < 59 ? 2 : 1) * f * 1.0022, { n: 14, base, gain: 0.65 }); // each string has a partner, an octave up on the low four
    knock(o, sr, 0.5, 0.012, 0.5);
  },
  clean(o, sr, f, midi) { string(o, sr, f, { n: 22, where: 0.13, roll: 1.15, dark: 4200, base: ringFor(midi, 6, 0.07), damp: 0.12 }); knock(o, sr, 0.3, 0.008, 0.6); },
  crunch(o, sr, f) {
    for (let n = 1; n <= 14; n++) ring(o, sr, f * n, 0.6 / n, 6 / (1 + 0.08 * n));
    knock(o, sr, 0.5, 0.015, 0.4);
    for (let i = 0; i < o.length; i++) o[i] = Math.tanh(2.6 * o[i] + 0.15) - Math.tanh(0.15);
    lowpass(o, sr, 4800); lowpass(o, sr, 4800);
    const low = o.slice(); lowpass(low, sr, 60);
    for (let i = 0; i < o.length; i++) o[i] -= low[i];
  },
  muted(o, sr, f) { string(o, sr, f, { n: 14, where: 0.1, roll: 1.1, dark: 2600, base: 0.42, damp: 0.25 }); knock(o, sr, 0.4, 0.02, 0.88); for (let i = 0; i < o.length; i++) o[i] = Math.tanh(1.8 * o[i]) / 1.8; },
  banjo(o, sr, f, midi) { string(o, sr, f, { n: 24, where: 0.09, roll: 0.95, dark: 6500, base: Math.max(0.5, 1.3 - (midi - 48) * 0.015), damp: 0.1 }); ring(o, sr, 310, 0.12, 0.08); ring(o, sr, 640, 0.08, 0.05); knock(o, sr, 0.4, 0.008, 0.4); },
  upright(o, sr, f) { string(o, sr, f, { n: 9, where: 0.35, roll: 1.5, dark: 1500, base: 2.2, damp: 0.6 }); ring(o, sr, 62, 0.1, 0.18); ring(o, sr, 118, 0.08, 0.12); knock(o, sr, 0.5, 0.03, 0.93); },
  slap(o, sr, f) { string(o, sr, f, { n: 22, where: 0.06, roll: 0.95, dark: 3800, base: 2.4, damp: 0.3 }); knock(o, sr, 0.6, 0.01, 0.35); },
  synthbass(o, sr, f) {
    for (let n = 1; n <= 24; n++) ring(o, sr, f * n, 1 / n, n === 1 ? 2.6 : 2.2 / (1 + 0.5 * (n - 1))); // a saw whose top closes quickly
    lowpass(o, sr, 2600);
  },
  clav(o, sr, f, midi) { string(o, sr, f, { n: 26, where: 0.07, roll: 0.9, dark: 4600, base: Math.max(0.8, 2.2 - (midi - 48) * 0.03), damp: 0.12 }); knock(o, sr, 0.45, 0.006, 0.35); },
  harp(o, sr, f, midi) { string(o, sr, f, { n: 14, where: 0.42, roll: 1.7, dark: 4000, base: ringFor(midi, 4, 0.05), damp: 0.35 }); knock(o, sr, 0.15, 0.012, 0.8); },
  vibes(o, sr, f) {
    for (const [r, a, t] of [[1, 1, 4.5], [4, 0.2, 1.6], [10, 0.06, 0.3]]) ring(o, sr, f * r, a, t);
    for (let i = 0; i < o.length; i++) o[i] *= 1 + 0.22 * Math.sin((2 * Math.PI * 5.2 * i) / sr); // the turning fans
    knock(o, sr, 0.15, 0.01, 0.85);
  },
});
const SECS = { nylon: 2.6, twelve: 2.8, clean: 3, crunch: 3, muted: 0.8, banjo: 1.4, upright: 2.2, slap: 2.4, synthbass: 2.4, clav: 2, harp: 2.8, vibes: 3, acoustic: 2.6, heavy: 3.2, bass: 2.6, piano: 3.6, epiano: 2.8, marimba: 1.4 };
const LEVEL = { nylon: 0.09, twelve: 0.085, clean: 0.088, crunch: 0.086, muted: 0.085, banjo: 0.085, upright: 0.105, slap: 0.1, synthbass: 0.1, clav: 0.085, harp: 0.09, vibes: 0.09, acoustic: 0.09, heavy: 0.085, bass: 0.11, piano: 0.088, epiano: 0.095, marimba: 0.09 }; // loudness of the first moments

const cache = new Map();
function buffer(ctx, id, midi) {
  const key = `${id}:${ctx.sampleRate}:${midi}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate, len = Math.floor(sr * SECS[id]);
  const buf = ctx.createBuffer(1, len, sr), o = buf.getChannelData(0);
  MAKE[id](o, sr, freqOf(midi), midi);
  const attack = Math.floor(sr * 0.002), fade = Math.floor(sr * 0.15);
  for (let i = 0; i < attack; i++) o[i] *= i / attack;
  for (let i = 0; i < fade; i++) o[len - 1 - i] *= i / fade;
  // same loudness for every note, never clipping
  let sum = 0, peak = 0;
  const n = Math.floor(sr * 0.3);
  for (let i = 0; i < len; i++) { if (i < n) sum += o[i] * o[i]; peak = Math.max(peak, Math.abs(o[i])); }
  const g = Math.min(LEVEL[id] / Math.sqrt(sum / n || 1), 0.95 / (peak || 1));
  for (let i = 0; i < len; i++) o[i] *= g;
  cache.set(key, buf);
  if (cache.size > 220) cache.delete(cache.keys().next().value);
  return buf;
}
/** Make the notes ready before they're needed, a few at a time, so playback never stutters. */
export function prepareSound(ctx, id, midis) {
  if (!MAKE[id]) return;
  const todo = [...new Set(midis)];
  const step = () => {
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 12) buffer(ctx, id, todo.shift());
    if (todo.length) setTimeout(step, 0);
  };
  step();
}

// held sounds made of one or more oscillators: h = harmonics (or a wave's name), det = detunes, a/r = start and end (seconds), g = loudness,
// cutoff = where the filter sits ([times the note's frequency, plus Hz]), vib = [cents, speed, after seconds], air = breath noise
const HELD = {
  church: { h: [1, 0.8, 0.1, 0.6, 0, 0.12, 0, 0.45, 0, 0, 0, 0.1, 0, 0, 0, 0.22], det: [-3, 3], a: 0.05, r: 0.35, g: 0.075 },
  violin: { h: 'sawtooth', det: [0], a: 0.06, r: 0.14, g: 0.18, cutoff: [5, 900], q: 0.8, vib: [14, 5.6, 0.25] },
  cello: { h: 'sawtooth', det: [0], a: 0.08, r: 0.18, g: 0.19, cutoff: [4, 420], q: 0.9, vib: [11, 5, 0.3] },
  trumpet: { h: [0.5, 0.8, 1, 0.9, 0.7, 0.5, 0.34, 0.22, 0.14, 0.09, 0.05], det: [0], a: 0.03, r: 0.09, g: 0.06, cutoff: [7, 1200], open: 0.06, vib: [7, 5.2, 0.4] },
  sax: { h: [0.9, 1, 0.75, 0.55, 0.5, 0.35, 0.28, 0.18, 0.12, 0.08], det: [0], a: 0.035, r: 0.1, g: 0.067, cutoff: [6, 700], vib: [12, 5, 0.3], air: 0.009 },
  flute: { h: [1, 0.28, 0.1, 0.03], det: [0], a: 0.06, r: 0.12, g: 0.115, vib: [8, 5, 0.25], air: 0.014 },
  pad: { h: 'sawtooth', det: [-8, 8], a: 0.35, r: 0.9, g: 0.27, cutoff: [2, 500], q: 0.5 },
  choir: { h: [1, 0.6, 0.5, 0.32, 0.2, 0.12, 0.08], det: [-7, 7], a: 0.16, r: 0.4, g: 0.088, formants: [[700, 4.5]], vib: [9, 4.6, 0.2] },
};
const waves = new WeakMap(); // AudioContext → { id: PeriodicWave }
function waveFor(ctx, id, h) {
  let all = waves.get(ctx);
  if (!all) waves.set(ctx, all = {});
  return all[id] ||= ctx.createPeriodicWave(new Float32Array(h.length + 1), Float32Array.from([0, ...h]), { disableNormalization: true });
}
const airs = new WeakMap();
function airNoise(ctx) {
  if (!airs.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    airs.set(ctx, b);
  }
  return airs.get(ctx);
}
function heldVoice(ctx, id, f, t, dur) {
  const H = HELD[id], out = ctx.createGain(), end = t + Math.max(dur, H.a + 0.05) + H.r;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + H.a);
  out.gain.setValueAtTime(1, end - H.r);
  out.gain.setTargetAtTime(0, end - H.r, H.r / 4);
  let into = out;
  if (H.cutoff) {
    const lp = ctx.createBiquadFilter(), top = Math.min(9000, f * H.cutoff[0] + H.cutoff[1]);
    lp.type = 'lowpass'; lp.Q.value = H.q ?? 0.6;
    if (H.open) { lp.frequency.setValueAtTime(top * 0.35, t); lp.frequency.linearRampToValueAtTime(top, t + H.open); } else lp.frequency.value = top;
    lp.connect(out);
    into = lp;
  }
  for (const [hz, db] of H.formants || []) {
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking'; pk.frequency.value = hz; pk.Q.value = 1.4; pk.gain.value = db;
    pk.connect(into);
    into = pk;
  }
  let vib = null;
  if (H.vib) {
    const lfo = ctx.createOscillator();
    vib = ctx.createGain();
    lfo.frequency.value = H.vib[1];
    vib.gain.setValueAtTime(0, t);
    vib.gain.setValueAtTime(0, t + H.vib[2]);
    vib.gain.linearRampToValueAtTime(H.vib[0], t + H.vib[2] + 0.3);
    lfo.connect(vib); lfo.start(t); lfo.stop(end + 0.1);
  }
  const g = ctx.createGain();
  g.gain.value = H.g / Math.sqrt(H.det.length);
  g.connect(into);
  for (const cents of H.det) {
    const o = ctx.createOscillator();
    if (typeof H.h === 'string') o.type = H.h; else o.setPeriodicWave(waveFor(ctx, id, H.h));
    o.frequency.value = f; o.detune.value = cents;
    vib?.connect(o.detune);
    o.connect(g); o.start(t); o.stop(end + 0.1);
  }
  if (H.air) {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = airNoise(ctx); n.loop = true;
    bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, f * 3); bp.Q.value = 0.8;
    ng.gain.value = H.air;
    n.connect(bp).connect(ng).connect(out); n.start(t); n.stop(end + 0.1);
  }
  return { out, end };
}

const organWaves = new WeakMap();
/** One held note: organ, synth or strings. Returns its output node; `end` is when it must be silent. */
function held(ctx, id, f, t, dur) {
  const out = ctx.createGain();
  const A = { organ: 0.012, synth: 0.008, strings: 0.11 }[id], Rel = { organ: 0.07, synth: 0.14, strings: 0.45 }[id];
  const end = t + Math.max(dur, A + 0.05) + Rel;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + A);
  out.gain.setValueAtTime(1, end - Rel);
  out.gain.setTargetAtTime(0, end - Rel, Rel / 4);
  const osc = (type, freq, cents, gain, to) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = freq; o.detune.value = cents; g.gain.value = gain;
    o.connect(g).connect(to); o.start(t); o.stop(end + 0.1);
  };
  if (id === 'organ') {
    let wave = organWaves.get(ctx);
    if (!wave) {
      const im = new Float32Array(17);
      for (const [k, a] of [[1, 0.14], [2, 1], [3, 0.06], [4, 0.6], [6, 0.3], [8, 0.25], [10, 0.1], [12, 0.12], [16, 0.12]]) im[k] = a;
      wave = ctx.createPeriodicWave(new Float32Array(17), im, { disableNormalization: true });
      organWaves.set(ctx, wave);
    }
    osc(wave, f / 2, 0, 0.085, out);
    osc(wave, f / 2, 4, 0.025, out); // a little shimmer
  } else {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    if (id === 'synth') {
      lp.Q.value = 4;
      lp.frequency.setValueAtTime(Math.min(9000, f * 10 + 600), t);
      lp.frequency.setTargetAtTime(Math.min(5000, f * 3 + 500), t + 0.02, 0.18);
      osc('sawtooth', f, -7, 0.085, lp); osc('sawtooth', f, 7, 0.085, lp); osc('square', f, 0, 0.04, lp);
    } else {
      lp.Q.value = 0.4;
      lp.frequency.value = Math.min(4200, f * 4 + 700);
      for (const c of [-13, -5, 5, 13]) osc('sawtooth', f, c, 0.095, lp);
    }
    lp.connect(out);
  }
  return { out, end };
}

const DAMPED = new Set(['clean', 'crunch', 'upright', 'slap', 'synthbass', 'clav']); // these stop when the note is let go
/** Play a note or chord with an instrument. dur: written length in seconds (how long held sounds last). */
export function playSound(ctx, id, midis, { at = ctx.currentTime + 0.03, strum = 0.028, volume = 0.5, dest = ctx.destination, dur = 0.6 } = {}) {
  if (!midis?.length) return at;
  if (id !== 'organ' && id !== 'synth' && id !== 'strings' && !MAKE[id] && !HELD[id]) return playPluck(ctx, midis, { at, strum, volume, dest });
  const sorted = [...midis].sort((a, b) => a - b);
  const level = volume / Math.sqrt(sorted.length) / 0.5;
  const keys = id === 'piano' || id === 'epiano' || id === 'marimba' || id === 'organ' || id === 'strings' || id === 'synth' || id === 'vibes' || !!HELD[id];
  let last = at;
  sorted.forEach((m, k) => {
    const t = at + k * (keys ? 0.004 : strum), g = ctx.createGain();
    g.gain.value = level;
    g.connect(dest);
    if (MAKE[id]) {
      const src = ctx.createBufferSource();
      src.buffer = buffer(ctx, id, m);
      src.connect(g);
      src.start(t);
      let end = t + src.buffer.duration;
      if (id === 'piano' || id === 'epiano' || id === 'heavy' || id === 'bass' || DAMPED.has(id)) { // dampers: the note stops when it's let go
        const off = t + Math.max(0.12, dur);
        if (off < end) { g.gain.setValueAtTime(level, off); g.gain.setTargetAtTime(0, off, 0.07); end = Math.min(end, off + 0.6); src.stop(end); }
      }
      last = Math.max(last, end);
    } else {
      const n = HELD[id] ? heldVoice(ctx, id, freqOf(m), t, dur) : held(ctx, id, freqOf(m), t, dur);
      n.out.connect(g);
      last = Math.max(last, n.end);
    }
  });
  return last;
}
