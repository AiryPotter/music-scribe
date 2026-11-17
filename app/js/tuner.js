// Tuner: listens to the mic (nothing is recorded or kept), finds the string you're playing
// in the current tuning, and shows how sharp or flat it is.

import { detectPitch, rms } from './pitch.js';

const A4 = 440;
const midiOf = (f) => 69 + 12 * Math.log2(f / A4);

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
    const m = midiOf(freq);
    this.recent.push(m);
    if (this.recent.length > 7) this.recent.shift();
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
