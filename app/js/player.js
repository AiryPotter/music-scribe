// Plays the written score back (from the notes on the page, never from a recording),
// with the plucked-string sound, and reports which note is sounding so the page can follow.

import { playPluck } from './pluck.js';

const LOOKAHEAD = 0.25; // seconds of notes scheduled ahead of the clock
const TICK_MS = 40;

export class Player {
  /** onStep(eventIndex | -1) fires when the sounding note changes; onEnd(finished) when playback stops. */
  constructor({ onStep = () => {}, onEnd = () => {} } = {}) {
    this.onStep = onStep;
    this.onEnd = onEnd;
    this.playing = false;
    this.timer = 0;
  }

  /** events: [{ slot, len, notes:[{ midi }] }] sorted; bpm; from = index of the first event to play. */
  start(ctx, events, bpm, from = 0) {
    this.stop(false);
    if (!events.length) return;
    from = Math.max(0, Math.min(from, events.length - 1));
    this.ctx = ctx;
    this.events = events;
    this.slotDur = 60 / bpm / 4;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    this.t0 = ctx.currentTime + 0.12 - events[from].slot * this.slotDur; // audio time of slot 0
    this.next = from;      // next event to schedule
    this.shown = -1;       // event currently highlighted
    this.cursor = from;    // next event to highlight
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  timeOf(i) { return this.t0 + this.events[i].slot * this.slotDur; }

  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    while (this.next < this.events.length && this.timeOf(this.next) < now + LOOKAHEAD) {
      const ev = this.events[this.next];
      playPluck(this.ctx, ev.notes.map((n) => n.midi), { at: Math.max(now, this.timeOf(this.next)), dest: this.out });
      this.next++;
    }
    while (this.cursor < this.events.length && this.timeOf(this.cursor) <= now) {
      this.shown = this.cursor++;
      this.onStep(this.shown);
    }
    const last = this.events[this.events.length - 1];
    if (now > this.t0 + (last.slot + last.len) * this.slotDur + 0.6) this.stop(true);
  }

  /** Index to resume from after a pause. */
  get position() { return this.playing ? Math.max(0, this.shown) : 0; }

  stop(finished = false) {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    const out = this.out, ctx = this.ctx;
    try {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.03); // quick fade, no click
      setTimeout(() => { try { out.disconnect(); } catch { /* gone */ } }, 400);
    } catch { /* context closed */ }
    this.onStep(-1);
    this.onEnd(finished);
  }
}
