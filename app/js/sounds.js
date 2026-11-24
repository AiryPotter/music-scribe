// The instruments music is played back with. All made here from maths (no recordings, no downloads).
import { playPluck } from './pluck.js';

// program: General MIDI number (0-based) used in MIDI and MusicXML files
export const SOUNDS = [
  { id: 'classic', name: 'Harpsichord (original)', program: 25, instrument: 'Acoustic Guitar' },
  { id: 'acoustic', name: 'Acoustic guitar', program: 25, instrument: 'Acoustic Guitar' },
  { id: 'heavy', name: 'Heavy guitar', program: 30, instrument: 'Distortion Guitar' },
  { id: 'bass', name: 'Bass guitar', program: 33, instrument: 'Electric Bass' },
  { id: 'piano', name: 'Grand piano', program: 0, instrument: 'Grand Piano' },
  { id: 'epiano', name: 'Electric piano', program: 4, instrument: 'Electric Piano' },
  { id: 'organ', name: 'Organ', program: 16, instrument: 'Organ' },
  { id: 'synth', name: 'Synth lead', program: 81, instrument: 'Synth Lead' },
  { id: 'strings', name: 'Dreamy strings', program: 48, instrument: 'Strings' },
  { id: 'marimba', name: 'Marimba', program: 12, instrument: 'Marimba' },
];
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
const SECS = { acoustic: 2.6, heavy: 3.2, bass: 2.6, piano: 3.6, epiano: 2.8, marimba: 1.4 };
const LEVEL = { acoustic: 0.09, heavy: 0.085, bass: 0.11, piano: 0.088, epiano: 0.095, marimba: 0.09 }; // loudness of the first moments

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

/** Play a note or chord with an instrument. dur: written length in seconds (how long held sounds last). */
export function playSound(ctx, id, midis, { at = ctx.currentTime + 0.03, strum = 0.028, volume = 0.5, dest = ctx.destination, dur = 0.6 } = {}) {
  if (!midis?.length) return at;
  if (id !== 'organ' && id !== 'synth' && id !== 'strings' && !MAKE[id]) return playPluck(ctx, midis, { at, strum, volume, dest });
  const sorted = [...midis].sort((a, b) => a - b);
  const level = volume / Math.sqrt(sorted.length) / 0.5;
  const keys = id === 'piano' || id === 'epiano' || id === 'marimba' || id === 'organ' || id === 'strings' || id === 'synth';
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
      if (id === 'piano' || id === 'epiano' || id === 'heavy' || id === 'bass') { // dampers: the note stops when it's let go
        const off = t + Math.max(0.12, dur);
        if (off < end) { g.gain.setValueAtTime(level, off); g.gain.setTargetAtTime(0, off, 0.07); end = Math.min(end, off + 0.6); src.stop(end); }
      }
      last = Math.max(last, end);
    } else {
      const n = held(ctx, id, freqOf(m), t, dur);
      n.out.connect(g);
      last = Math.max(last, n.end);
    }
  });
  return last;
}
