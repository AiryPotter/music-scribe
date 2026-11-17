// Click track: sample-accurate ticks scheduled on the audio clock.
// The default beep is pitched at 2000/2600 Hz, above the guitar and the transcriber's range.
// When speakers leak it into the mic, the transcription knows when every beat was (see notes-post.js).

const noiseCache = new WeakMap(); // AudioContext → a short noise buffer
function noiseBuffer(ctx) {
  if (noiseCache.has(ctx)) return noiseCache.get(ctx);
  const len = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = (seed / 4294967296) * 2 - 1; }
  noiseCache.set(ctx, buf);
  return buf;
}

let style = 'tone';
/** 'tone' = 2000/2600 Hz beep (default: it leaked into transcriptions least in testing); 'tick' = short noise tick. */
export function setClickStyle(s) { style = s; }

/** One tick at audio time t (accent = beat 1). Shared by the recording click and playback. */
export function clickSound(ctx, t, accent, dest = ctx.destination) {
  if (style === 'tone') {
    const osc = ctx.createOscillator(), og = ctx.createGain();
    osc.frequency.value = accent ? 2600 : 2000;
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.002); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(og).connect(dest); osc.start(t); osc.stop(t + 0.05);
    return og;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = accent ? 5200 : 4200; // well above the guitar's notes and Basic Pitch's range
  bp.Q.value = 2.5;
  const g = ctx.createGain();
  const peak = accent ? 1.4 : 0.9;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.018); // 18 ms: a tick, not a tone
  src.connect(bp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.03);
  return g;
}

export class Metronome {
  /** leak: optional extra destination for the ticks (the demo uses it to imitate speakers heard by the mic) */
  constructor(ctx, { bpm = 100, meter = 4, onBeat = () => {}, leak = null } = {}) {
    this.ctx = ctx;
    this.leak = leak;
    this.bpm = bpm;
    this.meter = meter;
    this.onBeat = onBeat;
    this.timer = 0;
    this.timeouts = [];
  }

  /** Start at audio time `at`; returns that time. Beat 0 is the first count-in beat. */
  start(at = this.ctx.currentTime + 0.1) {
    this.startTime = at;
    this.next = at;
    this.beat = 0;
    this._tick();
    this.timer = setInterval(() => this._tick(), 25);
    return at;
  }

  get period() { return 60 / this.bpm; }

  _tick() {
    while (this.next < this.ctx.currentTime + 0.15) {
      const b = this.beat, t = this.next;
      this._click(t, b % this.meter === 0);
      const delay = Math.max(0, (t - this.ctx.currentTime) * 1000);
      this.timeouts.push(setTimeout(() => this.onBeat(b, t), delay));
      this.beat++;
      this.next += this.period;
    }
    if (this.timeouts.length > 64) this.timeouts.splice(0, 32);
  }

  _click(t, accent) {
    clickSound(this.ctx, t, accent);
    if (this.leak) clickSound(this.ctx, t, accent, this.leak);
  }

  /** Audio time of the tick at or just before `t` (for ignoring the click in the live preview). */
  lastTickBefore(t) {
    if (t < this.startTime) return -Infinity;
    return this.startTime + Math.floor((t - this.startTime) / this.period) * this.period;
  }

  stop() {
    clearInterval(this.timer);
    this.timeouts.forEach(clearTimeout);
    this.timeouts = [];
  }
}
