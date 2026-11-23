// Tuner: listens to the mic (nothing is recorded or kept), finds the string you're playing
// in the current tuning, and shows how sharp or flat it is.

import { detectPitch, rms } from './pitch.js';

const A4 = 440;
const midiOf = (f) => 69 + 12 * Math.log2(f / A4);

/** Strength of one frequency in the buffer (Goertzel, with a Hann window). */
function power(buf, sampleRate, f) {
  const N = buf.length, k = 2 * Math.cos((2 * Math.PI * f) / sampleRate);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    const s = buf[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)) + k * s1 - s2;
    s2 = s1; s1 = s;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}
/** A pitch read an octave too low has almost nothing at its own odd harmonics: the real note is an octave up. */
export function fixOctave(buf, sampleRate, f) {
  const odd = power(buf, sampleRate, f) + power(buf, sampleRate, 3 * f) + power(buf, sampleRate, 5 * f);
  const even = power(buf, sampleRate, 2 * f) + power(buf, sampleRate, 4 * f);
  return odd < 0.03 * even ? 2 * f : f;
}

export class Tuner {
  /**
   * strings: open-string MIDI notes, low → high. onReading({ freq, midi, string, cents, inTune, level }) is called
   * ~30×/s while a note sounds, and with null when it goes quiet.
   */
  constructor({ strings, onReading }) {
    this.strings = strings;
    this.onReading = onReading;
    this.lock = null;   // string index to tune, or null = whichever is nearest
    this.recent = [];   // last few pitch readings, for a steady needle
    this.raf = 0;
  }

  /** session: { ctx, analyser } from openMic (or the demo). */
  start(session) {
    this.session = session;
    this.buf = new Float32Array(session.analyser.fftSize);
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.read();
    };
    tick();
  }

  read() {
    const { analyser, ctx } = this.session;
    analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    if (level < 0.004) { this.recent = []; this.onReading(null, level); return; }
    const { freq, clarity } = detectPitch(this.buf, ctx.sampleRate, { minFreq: 55, maxFreq: 1100, threshold: 0.12 });
    if (!freq || clarity < 0.85) { this.onReading(null, level); return; }
    const m = midiOf(fixOctave(this.buf, ctx.sampleRate, freq));
    // a new note starts a fresh count (the old string's readings mustn't be mixed with it)
    if (this.recent.length >= 3) {
      const mid = [...this.recent].sort((a, b) => a - b)[this.recent.length >> 1];
      this.odd = Math.abs(m - mid) > 0.6 ? (this.odd || 0) + 1 : 0;
      if (this.odd && this.odd < 3) return; // one stray reading: ignore it
      if (this.odd) { this.recent = []; this.odd = 0; }
    }
    this.recent.push(m);
    if (this.recent.length > 7) this.recent.shift();
    // only believe a note once several readings in a row agree
    if (this.recent.length < 4 || Math.max(...this.recent) - Math.min(...this.recent) > 1) { this.onReading(null, level); return; }
    const sorted = [...this.recent].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1]; // median: ignores the odd octave slip
    let string = this.lock;
    if (string === null) {
      let best = Infinity;
      this.strings.forEach((open, i) => { const d = Math.abs(med - open); if (d < best) { best = d; string = i; } });
      if (best > 3.5) string = null; // not near any open string: just show the note
    }
    const target = string !== null ? this.strings[string] : Math.round(med);
    const cents = Math.round((med - target) * 100);
    this.onReading({ freq, midi: med, string, target, cents, inTune: Math.abs(cents) <= 5, level }, level);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.session = null;
    this.recent = [];
  }
}
