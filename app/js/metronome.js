// Click track: sample-accurate ticks scheduled on the audio clock.
// Ticks are pitched at 2000/2600 Hz, well above the guitar's range, so they
// can be filtered out of the transcription if the mic picks them up.

export class Metronome {
  constructor(ctx, { bpm = 100, meter = 4, onBeat = () => {} } = {}) {
    this.ctx = ctx;
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
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 2600 : 2000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  stop() {
    clearInterval(this.timer);
    this.timeouts.forEach(clearTimeout);
    this.timeouts = [];
  }
}
