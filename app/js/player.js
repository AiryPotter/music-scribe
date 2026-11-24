// Plays the written score back (from the notes on the page, never from a recording),
// with the plucked-string sound, and reports which note is sounding so the page can follow.
// Practice options: slower speed, a click on every beat, and looping a stretch of bars.

import { playPluck } from './pluck.js';
import { clickSound } from './metronome.js';

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
   * layers: [{ events: [{ slot, len, notes:[{ midi }] }] sorted, active (the one the page follows),
   *   volume (0–1.5), pan (−1…1) }]  (a plain events array also works, as one layer)
   * bpm: the written tempo; fromSlot: where to start (16ths from the start of the song).
   * opts: { speed (0.25–4), click (bool), meter, pulse (slots between ticks), loop: { start, end } in slots, or null,
   *   at: audio time to start (default: right away) }
   */
  start(ctx, layers, bpm, fromSlot = 0, { speed = 1, click = false, meter = 4, pulse = SLOTS_PER_BEAT, loop = null, at = null, fullLoop = false } = {}) {
    this.stop(false);
    if (Array.isArray(layers) && layers.length && !layers[0]?.events) layers = [{ events: layers, active: true }];
    layers = (layers || []).filter((L) => L.events?.length);
    if (!layers.length) return;
    const all = layers.flatMap((L) => L.events);
    const lastEnd = Math.max(...all.map((e) => e.slot + e.len));
    fromSlot = Math.max(0, Math.min(fromSlot, Math.max(...all.map((e) => e.slot))));
    const barSlots = meter * SLOTS_PER_BEAT;
    const seg = loop
      ? { start: loop.start, end: fullLoop ? loop.end : Math.min(loop.end, Math.max(loop.start + 1, lastEnd)) } // fullLoop: keep the silence at the end (whole bars)
      : { start: Math.floor(fromSlot / SLOTS_PER_BEAT) * SLOTS_PER_BEAT, end: lastEnd };
    // one pass through the segment: notes of every layer, plus a tick on every beat if the click is on
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    const items = [];
    layers.forEach((L) => {
      let dest = this.out;
      try {
        const g = ctx.createGain();
        g.gain.value = L.volume ?? 1;
        if (L.pan && ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = L.pan; g.connect(pn).connect(this.out); } else g.connect(this.out);
        dest = g;
      } catch { /* old browser: everything in the middle */ }
      L.events.forEach((ev, i) => {
        if (ev.slot >= seg.start && ev.slot < seg.end && (loop || ev.slot >= fromSlot)) items.push({ slot: ev.slot, ev, i: L.active ? i : undefined, dest });
      });
    });
    if (click) {
      for (let bar = Math.floor(seg.start / barSlots) * barSlots; bar < seg.end; bar += barSlots) {
        for (let s = bar; s < bar + barSlots; s += pulse) if (s >= seg.start && s < seg.end) items.push({ slot: s, tick: true, accent: s === bar });
      }
    }
    items.sort((a, b) => a.slot - b.slot || (a.tick ? -1 : 1));
    if (!items.some((x) => x.ev)) { try { this.out.disconnect(); } catch { /* */ } return; }

    this.ctx = ctx;
    this.items = items;
    this.loop = !!loop;
    this.seg = seg;
    this.slotDur = 60 / (bpm * speed) / SLOTS_PER_BEAT;
    this.cycleDur = (seg.end - seg.start) * this.slotDur;
    const firstSlot = loop ? seg.start : fromSlot;
    this.t0 = (at ?? ctx.currentTime + 0.12) - (firstSlot - seg.start) * this.slotDur; // audio time of seg.start, cycle 0
    this.lastSlot = firstSlot;
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

  tickSound(t, accent) { clickSound(this.ctx, t, accent, this.out); }

  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    while (!this.nextDone && this.timeOf(this.next) < now + LOOKAHEAD) {
      const it = this.items[this.next.j];
      const at = Math.max(now, this.timeOf(this.next));
      if (it.tick) this.tickSound(at, it.accent);
      else playPluck(this.ctx, it.ev.notes.map((n) => n.midi), { at, dest: it.dest || this.out });
      if (!this.advance(this.next)) this.nextDone = true;
    }
    while (!this.cursorDone && this.timeOf(this.cursor) <= now) {
      const it = this.items[this.cursor.j];
      if (!it.tick) this.lastSlot = it.slot;
      if (!it.tick && it.i !== undefined && it.i !== this.shown) { this.shown = it.i; this.onStep(this.shown); }
      if (!this.advance(this.cursor)) this.cursorDone = true;
    }
    if (!this.loop && this.nextDone) {
      const lastEnd = Math.max(...this.items.filter((x) => x.ev).map((x) => x.slot + x.ev.len));
      const end = this.t0 + (lastEnd - this.seg.start) * this.slotDur + 0.6;
      if (now > end) this.stop(true);
    }
  }

  /** Where the music is now, in slots (to resume from after a pause). */
  get position() { return this.playing ? this.lastSlot ?? 0 : 0; }

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
