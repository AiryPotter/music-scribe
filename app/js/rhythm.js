// Rhythm: find the tempo and time signature from free playing, then snap notes
// to a 16th-note grid and split them into bars of notatable durations.

export const SLOTS_PER_BEAT = 4; // 16th-note grid

/** Group notes that start together (a strum) into onset events: [{ t, w, notes }]. */
export function onsetEvents(notes, window = 0.07) {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const events = [];
  for (const n of sorted) {
    const last = events[events.length - 1];
    if (last && n.start - last.t0 < window) {
      last.notes.push(n);
    } else {
      events.push({ t0: n.start, notes: [n] });
    }
  }
  return events.map((e) => {
    const amp = e.notes.reduce((s, n) => s + (n.amp ?? 0.6), 0);
    const hasBass = e.notes.some((n) => n.midi < 50);
    return {
      t: e.t0,
      w: Math.min(3, 0.5 + amp) + (hasBass ? 0.4 : 0),
      size: e.notes.length,
      notes: e.notes,
    };
  });
}

const SIGMA = 0.03; // seconds of timing slop we forgive

/** How well onset events fit a beat grid of `bpm`. Returns { score, phase }. */
export function fitTempo(events, bpm, { phaseCenter = null, phaseRange = null } = {}) {
  const p = 60 / bpm;
  const half = p / 2;
  const totalW = events.reduce((s, e) => s + e.w, 0);
  let bestS = -Infinity, bestPhase = 0;
  const PH = 32;
  for (let k = 0; k < PH; k++) {
    let phase = (k / PH) * p;
    if (phaseCenter !== null) phase = phaseCenter + ((k / (PH - 1)) * 2 - 1) * phaseRange;
    let s = 0;
    for (const e of events) {
      const x = (e.t - phase) / half; // position in eighth notes
      const n = Math.round(x);
      const d = (x - n) * half;
      const onBeat = ((n % 2) + 2) % 2 === 0;
      s += e.w * Math.exp(-0.5 * (d / SIGMA) ** 2) * (onBeat ? 1 : 0.55);
    }
    if (s > bestS) { bestS = s; bestPhase = phase; }
  }
  // Subtract what random onsets would score (denser grids fit noise more easily)
  const expected = totalW * ((Math.sqrt(2 * Math.PI) * SIGMA) / half) * 0.775;
  return { score: bestS - expected, phase: bestPhase };
}

/** Estimate tempo from free playing. Returns { bpm, beat0 } or null if too few notes. */
export function estimateTempo(events, { minBpm = 60, maxBpm = 180 } = {}) {
  if (events.length < 4) return null;
  let best = null;
  const consider = (bpm) => {
    const { score, phase } = fitTempo(events, bpm);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 100) / 0.6) ** 2);
    const s = score * (0.8 + 0.2 * prior);
    if (!best || s > best.s) best = { s, bpm, phase };
  };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 1) consider(bpm);
  const coarse = best.bpm;
  for (let bpm = coarse - 1; bpm <= coarse + 1; bpm += 0.1) consider(+bpm.toFixed(1));
  return { bpm: Math.round(best.bpm), beat0: best.phase };
}

/** Best grid phase for a fixed tempo (used when the user changes BPM). */
export function phaseFor(events, bpm, near = null) {
  if (!events.length) return near ?? 0;
  if (near !== null) return fitTempo(events, bpm, { phaseCenter: near, phaseRange: Math.min(0.12, 30 / bpm) }).phase;
  return fitTempo(events, bpm).phase;
}

/** Guess 4/4 vs 3/4 (and where bar 1 starts) from which beats get the strongest notes. */
export function detectMeter(events, bpm, beat0, forced = null) {
  const p = 60 / bpm;
  const strength = new Map();
  for (const e of events) {
    const b = Math.round((e.t - beat0) / p);
    if (Math.abs(e.t - (beat0 + b * p)) > p * 0.2) continue;
    strength.set(b, (strength.get(b) || 0) + e.w * (0.6 + 0.4 * Math.min(e.size, 4)));
  }
  const beats = [...strength.keys()];
  if (!beats.length) return { meter: forced || 4, offset: 0 };
  const lo = Math.min(...beats), hi = Math.max(...beats);
  let best = null;
  for (const m of forced ? [forced] : [4, 3]) {
    if (hi - lo + 1 < m * 2 && !forced) continue;
    for (let o = 0; o < m; o++) {
      let on = 0, onN = 0, off = 0, offN = 0;
      for (let b = lo; b <= hi; b++) {
        const s = strength.get(b) || 0;
        if ((((b - o) % m) + m) % m === 0) { on += s; onN++; } else { off += s; offN++; }
      }
      const a = on / Math.max(1, onN), z = off / Math.max(1, offN);
      let contrast = (a - z) / (a + z + 1e-9);
      if (m === 3) contrast -= 0.12; // most songs are in 4
      if (!best || contrast > best.contrast) best = { meter: m, offset: o, contrast };
    }
  }
  return best ? { meter: best.meter, offset: best.offset } : { meter: forced || 4, offset: 0 };
}

// ---------- quantize into bars ----------

// slots → [VexFlow duration, dots]
export const DUR = { 16: ['w', 0], 12: ['h', 1], 8: ['h', 0], 6: ['q', 1], 4: ['q', 0], 3: ['8', 1], 2: ['8', 0], 1: ['16', 0] };
const LENS = [16, 12, 8, 6, 4, 3, 2, 1];

function pickLen(pos, room, barSlots) {
  for (const len of LENS) {
    if (len > room) continue;
    if (len === 16 && !(pos === 0 && barSlots === 16)) continue;
    if (len === 12 && pos !== 0) continue;
    if (len === 8 && !(pos % 8 === 0 || (barSlots === 12 && pos === 4))) continue;
    if ((len === 6 || len === 4 || len === 3) && pos % 4 !== 0) continue;
    if (len === 2 && pos % 2 !== 0) continue;
    return len;
  }
  return 1;
}

/**
 * Snap notes to the grid and build bars.
 * tempo = { bpm, beat0, meter, offset } (offset = which beat is the downbeat).
 * Returns { measures: [[piece]], barStart } where a piece is
 * { slots, rest, ev, tieFromPrev, tieToNext }; ev = { slot, notes:[...] }.
 */
export function buildMeasures(notes, tempo) {
  const { bpm, beat0, meter } = tempo;
  const p = 60 / bpm;
  const slotDur = p / SLOTS_PER_BEAT;
  const barSlots = meter * SLOTS_PER_BEAT;
  if (!notes.length) return { measures: [[{ slots: barSlots, rest: true }]], barStart: beat0, barSlots };

  const first = Math.min(...notes.map((n) => n.start));
  let barStart = beat0 + (tempo.offset || 0) * p;
  const barDur = meter * p;
  while (barStart > first + slotDur / 2) barStart -= barDur;
  while (barStart + barDur <= first - slotDur / 2) barStart += barDur;

  // group notes into strums/onsets first, then snap each group to the grid as one
  const groups = new Map();
  for (const ev of onsetEvents(notes)) {
    const s = Math.max(0, Math.round((ev.t - barStart) / slotDur));
    const g = groups.get(s) || { slot: s, notes: [], end: s };
    for (const n of ev.notes) {
      if (!g.notes.some((x) => x.midi === n.midi)) g.notes.push(n);
      g.end = Math.max(g.end, s + 1, Math.round((n.end - barStart) / slotDur));
    }
    groups.set(s, g);
  }
  const evs = [...groups.values()].sort((a, b) => a.slot - b.slot);

  // timeline of notes and rests (guitar notes ring: extend to the next onset unless there's a clear gap)
  const items = [];
  let cursor = 0;
  evs.forEach((ev, i) => {
    if (ev.slot > cursor) items.push({ slot: cursor, len: ev.slot - cursor, rest: true });
    const next = i + 1 < evs.length ? evs[i + 1].slot : Infinity;
    let end = ev.end;
    if (next !== Infinity && next - end < SLOTS_PER_BEAT) end = next;
    end = Math.min(end, next);
    end = Math.max(end, ev.slot + 1);
    items.push({ slot: ev.slot, len: end - ev.slot, ev });
    cursor = end;
  });
  const bars = Math.max(1, Math.ceil(cursor / barSlots));
  if (cursor < bars * barSlots) items.push({ slot: cursor, len: bars * barSlots - cursor, rest: true });

  const measures = Array.from({ length: bars }, () => []);
  const flat = [];
  for (const it of items) {
    let pos = it.slot, remaining = it.len, firstPiece = true;
    while (remaining > 0) {
      const bar = Math.floor(pos / barSlots);
      const inBar = pos - bar * barSlots;
      const room = Math.min(remaining, barSlots - inBar);
      const len = pickLen(inBar, room, barSlots);
      const piece = { slots: len, rest: !!it.rest, ev: it.ev || null, tieFromPrev: !it.rest && !firstPiece, tieToNext: false };
      measures[bar].push(piece);
      flat.push(piece);
      pos += len; remaining -= len; firstPiece = false;
    }
  }
  for (let i = 1; i < flat.length; i++) if (flat[i].tieFromPrev) flat[i - 1].tieToNext = true;
  return { measures, barStart, barSlots };
}
