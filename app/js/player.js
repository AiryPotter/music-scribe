// Plays the written score back (from the notes on the page, never from a recording),
// with the plucked-string sound, and reports which note is sounding so the page can follow.
// Practice options: slower speed, a click on every beat, and looping a stretch of bars.

import { playPluck } from './pluck.js';

const LOOKAHEAD = 0.25; // seconds of sound scheduled ahead of the clock
const TICK_MS = 40;
const SLOTS_PER_BEAT = 4;

export class Player {
  /** onStep(eventIndex | -1) fires when the sounding note changes; onEnd(finished) when playback stops. */
  constructor({ onStep = () => {}, onEnd = () => {} } = {}) {
    this.onStep = onStep;
    this.onEnd = onEnd;
    this.playing = false;
    this.timer = 0;
  }

  /**
   * events: [{ slot, len, notes:[{ midi }] }] sorted; bpm: the written tempo; from: index of the first event.
   * opts: { speed (0.4–1), click (bool), meter, loop: { start, end } in slots, or null }
   */
  start(ctx, events, bpm, from = 0, { speed = 1, click = false, meter = 4, loop = null } = {}) {
    this.stop(false);
    if (!events.length) return;
    from = Math.max(0, Math.min(from, events.length - 1));
    const lastEnd = Math.max(...events.map((e) => e.slot + e.len));
    const barSlots = meter * SLOTS_PER_BEAT;
    const seg = loop
      ? { start: loop.start, end: Math.min(loop.end, Math.max(loop.start + 1, lastEnd)) }
      : { start: Math.floor(events[from].slot / SLOTS_PER_BEAT) * SLOTS_PER_BEAT, end: lastEnd };
    // one pass through the segment: notes, plus a tick on every beat if the click is on
    const items = [];
    events.forEach((ev, i) => { if (ev.slot >= seg.start && ev.slot < seg.end && (loop || i >= from)) items.push({ slot: ev.slot, ev, i }); });
    if (click) {
      for (let s = Math.ceil(seg.start / SLOTS_PER_BEAT) * SLOTS_PER_BEAT; s < seg.end; s += SLOTS_PER_BEAT) {
        items.push({ slot: s, tick: true, accent: s % barSlots === 0 });
      }
    }
    items.sort((a, b) => a.slot - b.slot || (a.tick ? -1 : 1));
    if (!items.some((x) => x.ev)) return;

    this.ctx = ctx;
    this.items = items;
    this.loop = !!loop;
    this.seg = seg;
    this.slotDur = 60 / (bpm * speed) / SLOTS_PER_BEAT;
    this.cycleDur = (seg.end - seg.start) * this.slotDur;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    const firstSlot = loop ? seg.start : events[from].slot;
    this.t0 = ctx.currentTime + 0.12 - (firstSlot - seg.start) * this.slotDur; // audio time of seg.start, cycle 0
    this.next = { k: 0, j: 0 };   // next item to schedule (cycle, index)
    this.cursor = { k: 0, j: 0 }; // next item to highlight
    this.shown = -1;
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  timeOf(pos) { return this.t0 + pos.k * this.cycleDur + (this.items[pos.j].slot - this.seg.start) * this.slotDur; }

  advance(pos) {
    pos.j++;
    if (pos.j >= this.items.length) {
      if (!this.loop) return false;
      pos.j = 0;
      pos.k++;
    }
    return true;
  }

  tickSound(t, accent) {
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.frequency.value = accent ? 2600 : 2000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    while (!this.nextDone && this.timeOf(this.next) < now + LOOKAHEAD) {
      const it = this.items[this.next.j];
      const at = Math.max(now, this.timeOf(this.next));
      if (it.tick) this.tickSound(at, it.accent);
      else playPluck(this.ctx, it.ev.notes.map((n) => n.midi), { at, dest: this.out });
      if (!this.advance(this.next)) this.nextDone = true;
    }
    while (!this.cursorDone && this.timeOf(this.cursor) <= now) {
      const it = this.items[this.cursor.j];
      if (!it.tick && it.i !== this.shown) { this.shown = it.i; this.onStep(this.shown); }
      if (!this.advance(this.cursor)) this.cursorDone = true;
    }
    if (!this.loop && this.nextDone) {
      const last = [...this.items].reverse().find((x) => x.ev);
      const end = this.t0 + (last.slot + last.ev.len - this.seg.start) * this.slotDur + 0.6;
      if (now > end) this.stop(true);
    }
  }

  /** Index of the note sounding now (to resume from after a pause). */
  get position() { return this.playing ? Math.max(0, this.shown) : 0; }

  stop(finished = false) {
    if (!this.playing) return;
    this.playing = false;
    this.nextDone = this.cursorDone = false;
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
