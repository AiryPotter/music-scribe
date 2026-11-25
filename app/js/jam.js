// Jam: loop some bars of the song and play along. When recorded, each time round the loop is
// written out on its own (notes only), so the best one can be kept as a new layer.
import { quantize } from './rhythm.js';

const SLOTS_PER_BEAT = 4;
export const JAM_SIZES = [1, 2, 4, 8];

/** The next time the loop comes round to its start (at least `lead` seconds away). */
export function nextTop(t0, cycleDur, now, lead = 0.4) {
  return t0 + Math.max(0, Math.ceil((now + lead - t0) / cycleDur)) * cycleDur;
}

/** Every note the loop plays from `top` back `before` and on to `until` (for taking out speaker leak). */
export function loopNotes(layers, loop, slotDur, top, until, before = 0) {
  const cycle = (loop.end - loop.start) * slotDur, out = [];
  for (let k = -Math.ceil(before / cycle); top + k * cycle < until; k++) {
    for (const L of layers) {
      for (const ev of L.events) {
        if (ev.slot < loop.start || ev.slot >= loop.end) continue;
        const t = top + k * cycle + (ev.slot - loop.start) * slotDur;
        if (t >= top - before) for (const n of ev.notes) out.push({ midi: n.midi, t, dur: ev.len * slotDur });
      }
    }
  }
  return out;
}

/**
 * Split what was played into times round the loop, each written on the song's own bars.
 * notes: [{ midi, start, end, amp }] · top: when the first time round began · until: end of the recording
 * loop: { start, end } in slots · tempo: { bpm, meter }
 * → [{ round (1, 2…), events, notes, noteCount, partial }] (rounds with nothing played are left out)
 */
export function splitRounds(notes, { top, until, loop, tempo, simple = true, openStrings = [] }) {
  const slotDur = 60 / tempo.bpm / SLOTS_PER_BEAT;
  const len = loop.end - loop.start, cycle = len * slotDur;
  const early = Math.min(0.12, slotDur); // a note a touch before the top belongs to the next time round
  const out = [];
  for (let k = 0; top + k * cycle < until; k++) {
    const t0 = top + k * cycle;
    const mine = notes
      .filter((n) => n.start >= t0 - early && n.start < t0 + cycle - early)
      .map((n) => ({ ...n, end: Math.min(n.end, t0 + cycle) }))
      .filter((n) => n.end > n.start);
    if (!mine.length) continue;
    const q = quantize(mine, { bpm: tempo.bpm, beat0: t0, meter: tempo.meter, offset: 0 }, { simple, openStrings, anchor: true });
    const events = q.events.filter((e) => e.slot >= 0 && e.slot < len).map((e) => ({
      slot: e.slot + loop.start, len: Math.max(1, Math.min(e.len, len - e.slot)), notes: e.keys.map((midi) => ({ midi })),
    }));
    if (events.length) out.push({ round: k + 1, events, notes: mine, noteCount: events.reduce((s, e) => s + e.notes.length, 0), partial: t0 + cycle > until + 0.25 });
  }
  return out;
}
