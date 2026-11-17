// Rhythm: find the tempo and time signature from free playing, then snap notes
// to a 16th-note grid and split them into bars of notatable durations.

export const SLOTS_PER_BEAT = 4; // 16th-note grid

/** Group notes that start together (a strum) into onset events: [{ t, w, notes }]. */
export function onsetEvents(notes, window = 0.07, span = onsetEvents.span) {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const events = [];
  for (const n of sorted) {
    const last = events[events.length - 1];
    // a strum is a chain: each string within `window` of the one before, and the whole sweep within `span`
    // (low strings are heard a little late, so the bass of a chord can trail the rest)
    if (last && n.start - last.tLast < window && n.start - last.t0 < span) {
      last.notes.push(n);
      last.tLast = n.start;
    } else {
      events.push({ t0: n.start, tLast: n.start, notes: [n] });
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

/**
 * How much an onset sounds like a strong beat. Bass notes mark downbeats on a guitar
 * (the thumb plays them), far more than how many strings were hit.
 */
export function accent(e, ref = 55) {
  const bass = Math.max(0, Math.min(1.5, (ref - lowestOf(e)) / 7)); // a fifth or more below the usual register = full weight
  return 0.5 + 0.25 * Math.min(e.size, 4) + 1.5 * bass;
}
const lowestOf = (e) => Math.min(...e.notes.map((n) => n.midi));
/** The piece's usual register: the middle value of each onset's lowest note. */
export function registerOf(events) {
  const v = events.map(lowestOf).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 55;
}
function median(v) { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; }

export const STRUM_SPAN = 0.12; // longest strum sweep (seconds)
onsetEvents.span = STRUM_SPAN;  // (a property so the accuracy bench can compare values)

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
export function estimateTempo(events, { minBpm = 60, maxBpm = 180, halfCheck = true } = {}) {
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

  // Steady eighth notes fit a grid at twice the real tempo just as well. If half the tempo also fits
  // and its beats carry the accents (bass notes) while the off-beats don't, half is the real tempo.
  const half = best.bpm / 2;
  if (halfCheck && best.bpm >= 120 && half >= minBpm) {
    const h = fitTempo(events, half);
    const prior = Math.exp(-0.5 * (Math.log2(half / 100) / 0.6) ** 2);
    if (h.score * (0.8 + 0.2 * prior) >= 0.85 * best.s) {
      const eighth = 30 / half;
      const ref = registerOf(events);
      // a melody with no bass has no accents to go by: there, beats are about one note long, not two
      const gaps = events.slice(1).map((e, i) => e.t - events[i].t);
      if (gaps.length >= 4 && median(gaps) >= 1.75 * (60 / best.bpm)) return { bpm: Math.round(half), beat0: h.phase };
      let on = 0, onN = 0, off = 0, offN = 0;
      for (const e of events) {
        const x = (e.t - h.phase) / eighth;
        const n = Math.round(x);
        if (Math.abs(x - n) * eighth > 0.05) continue;
        if (((n % 2) + 2) % 2 === 0) { on += accent(e, ref); onN++; } else { off += accent(e, ref); offN++; }
      }
      if (onN && offN) {
        const a = on / onN, z = off / offN;
        if ((a - z) / (a + z) >= 0.1) return { bpm: Math.round(half), beat0: h.phase };
      }
    }
  }
  return { bpm: Math.round(best.bpm), beat0: best.phase };
}

/** Best grid phase for a fixed tempo (used when the user changes BPM). */
export function phaseFor(events, bpm, near = null) {
  if (!events.length) return near ?? 0;
  if (near !== null) return fitTempo(events, bpm, { phaseCenter: near, phaseRange: Math.min(0.12, 30 / bpm) }).phase;
  return fitTempo(events, bpm).phase;
}

/** Guess 4/4 vs 3/4 (and where bar 1 starts) from which beats get the strongest notes. */
export function detectMeter(events, bpm, beat0, forced = null, { bassAccent = true } = {}) {
  const p = 60 / bpm;
  const strength = new Map();
  const ref = registerOf(events);
  for (const e of events) {
    const b = Math.round((e.t - beat0) / p);
    if (Math.abs(e.t - (beat0 + b * p)) > p * 0.2) continue;
    strength.set(b, (strength.get(b) || 0) + (bassAccent ? accent(e, ref) : e.w * (0.6 + 0.4 * Math.min(e.size, 4))));
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
 * Snap notes to the grid. Returns the editable score events:
 * [{ slot, len, keys: [midi] }] (slots are 16ths from the start of bar 1; events never overlap).
 * tempo = { bpm, beat0, meter, offset } (offset = which beat is the downbeat).
 */
export function quantize(notes, tempo, { simple = false, openStrings = [], releaseFilter = true } = {}) {
  if (simple) return quantizeSimple(releaseFilter ? dropReleaseNoise(notes, openStrings) : notes, tempo);
  const { bpm, beat0, meter } = tempo;
  const p = 60 / bpm;
  const slotDur = p / SLOTS_PER_BEAT;
  if (!notes.length) return { events: [], barStart: beat0 };

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

  // guitar notes ring: extend to the next onset unless there's a clear gap
  const events = evs.map((ev, i) => {
    const next = i + 1 < evs.length ? evs[i + 1].slot : Infinity;
    let end = ev.end;
    if (next !== Infinity && next - end < SLOTS_PER_BEAT) end = next;
    end = Math.min(end, next);
    end = Math.max(end, ev.slot + 1);
    const keys = [...new Set(ev.notes.map((n) => n.midi))].sort((a, b) => a - b);
    return { slot: ev.slot, len: end - ev.slot, keys };
  });
  return { events, barStart };
}

/**
 * Lifting a finger off a fretted string makes noise the mic hears as notes: the open string
 * sounding for a moment, a short scratch, or the same note "starting again" as it's released.
 * They all begin just as a louder note ends. This drops them (and merges a quieter repeat of
 * the same note into the note it came from). Used by Simple detail.
 */
export function dropReleaseNoise(notes, openStrings = [], { window = 0.8 } = {}) {
  const sorted = [...notes].sort((a, b) => a.start - b.start).map((n) => ({ ...n }));
  const amp = (n) => n.amp ?? 0.6;
  const { chordy, overtone } = noteRoles(sorted);
  const out = [];
  sorted.forEach((n, i) => {
    if (chordy[i] || overtone[i]) { out.push(n); return; } // chords and strums are never finger-lift noise (overtones: see below)
    // the note played just before (the transcriber often ends a note early, as it fades)
    const parent = [...out].reverse().find((p) => p.start < n.start - 0.02);
    const gap = parent ? n.start - parent.end : Infinity;
    if (parent && gap >= -0.1 && gap <= window && amp(parent) > amp(n)) {
      const ratio = amp(n) / amp(parent);
      if (n.midi === parent.midi && ratio < 0.85 && gap <= 0.15) { parent.end = Math.max(parent.end, n.end); return; } // same note ringing on
      if (ratio < 0.65 && n.end - n.start < 0.25) return;                                                          // a short scratch
    }
    out.push(n);
  });
  // then the intention scale decides about every lone note (open strings ringing as a finger lifts...)
  const scores = intentionScores(out, openStrings);
  const roles = noteRoles(out);
  const gone = new Set();
  let dropped = null;
  out.forEach((n, i) => {
    if (roles.overtone[i]) return;
    // the same ghost sounding twice in a row (0, 0) goes with the first
    const twice = dropped && n.midi === dropped.midi && n.start - dropped.start < 0.6 && !scores[i].chord;
    if (scores[i].intent < INTENT_KEEP || twice) { gone.add(n); dropped = n; }
  });
  // an overtone goes with the note it belongs to
  // and the note before flickering back on at the moment of a lift (a short blip with the ghost) is just that note
  const ghostAt = (t) => [...gone].some((d) => Math.abs(d.start - t) < TOGETHER);
  return out.filter((n, i) => {
    if (gone.has(n)) return false;
    if (roles.overtone[i]) return !gone.has(out[roles.base[i]]);
    const p = out.slice(0, i).reverse().find((o) => o.midi === n.midi);
    if (p && n.end - n.start < 0.3 && amp(n) < amp(p) && Math.abs(n.start - p.end) < 0.1 && ghostAt(n.start)) { p.end = Math.max(p.end, n.end); return false; }
    return true;
  });
}

/** Below this intention score a lone note is treated as an accident (finger-lift noise) and dropped. */
export const INTENT_KEEP = 0.55;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const TOGETHER = 0.06; // notes starting this close together sound as one
const HARMONICS = [12, 19, 24, 28, 31, 36]; // semitones above a note where its overtones sit

/**
 * For notes sorted by start: which are faint overtones (echoes) of a louder, lower note that is
 * sounding when they start (base = that note's index), and which are part of a real chord or strum
 * (another real note starts with them; a lower octave counts, as in a power chord; a tiny blip doesn't).
 */
function noteRoles(notes) {
  const amp = (n) => n.amp ?? 0.6;
  const base = notes.map((n) => {
    const j = notes.findIndex((o) => {
      if (o === n || n.start - o.start > 1.5 || o.start >= n.start + TOGETHER) return false;
      const r = amp(n) / amp(o), dur = n.end - n.start;
      if (!HARMONICS.includes(n.midi - o.midi) || o.end <= n.start) return false;
      // starting with the note: a fainter copy; starting later (re-sounding as it rings): much fainter, or a blip
      return Math.abs(n.start - o.start) < TOGETHER ? r < 0.65 : r < 0.5 || (r < 0.65 && dur < 0.3 && n.start - o.start < 0.6);
    });
    return j >= 0 ? j : null;
  });
  const overtone = base.map((j) => j != null);
  const chordy = notes.map((n, i) => !overtone[i] && notes.some((o, j) => o !== n && !overtone[j] && Math.abs(o.start - n.start) < TOGETHER
    && ((o.midi - n.midi) % 12 !== 0 || o.midi < n.midi) && (o.end - o.start >= 0.1 || amp(o) >= 0.5 * amp(n))));
  return { overtone, chordy, base };
}

/**
 * The intention scale: how intentional does each note look? 1 = clearly played on purpose,
 * 0 = clearly an accident. Finger-lift noise can be as loud and as sharp as a real note, so the
 * main evidence is whether it FITS. Timing is judged on onsets (notes struck together = one onset).
 *  misfit (needed before a note can be called an accident):
 *   - late: it lands late between its neighbours, just before the next note
 *   - squeezed: late inside a gap that the rest of the rhythm treats as one beat (stronger)
 *     (a scale of even notes with an extra one just before the next fret)
 *   - spike: it leaps away from the tune and the tune carries on where it was (14, 0, 15);
 *     weaker evidence, since real riffs leap too
 *   - trailing: the last sound of the take is an open string ringing as the finger comes off
 *   - intrusion: in a single-note line, an open string sounding together with the next note
 *     (the finger lifted just as the next note was played), so it looks like a 2-note chord
 *  support (makes a misfit more convincing):
 *   - openLift: it's the open pitch of a string the note before could have been fretted on
 *     (lifting the finger lets that string ring open)
 *   - release: it starts about when the note before ends
 *  weakness (how was it played?): quieter than the notes around it, a softer attack than its
 *   neighbours (the transcriber's onset confidence), or very short
 * A pedal note (the same pitch coming back like clockwork, in the middle of the beat) is a pattern: misfit halved.
 * Chords and overtones score 1 (overtones go with their note).
 * Returns [{ intent, misfit, support, weakness, chord? }] in the same order as `notes` (sorted by start).
 */
export function intentionScores(notes, openStrings = []) {
  const opens = [...new Set(openStrings)];
  const amp = (n) => n.amp ?? 0.6;
  const { overtone, chordy } = noteRoles(notes);
  // onsets: the real notes (no overtones) grouped by when they start
  const groups = [];
  notes.forEach((n, i) => {
    if (overtone[i]) return;
    const g = groups[groups.length - 1];
    if (g && n.start - g.start < TOGETHER) g.notes.push(n); else groups.push({ start: n.start, notes: [n] });
  });
  const groupOf = new Map();
  groups.forEach((g, k) => g.notes.forEach((n) => groupOf.set(n, k)));
  const top = (g) => g.notes.reduce((a, b) => (amp(b) > amp(a) ? b : a));
  return notes.map((n, i) => {
    if (overtone[i]) return { intent: 1, misfit: 0, support: 0, weakness: 0, chord: true };
    const k = groupOf.get(n);
    // neighbouring onsets, skipping ones that are only this same pitch again (a doubled ghost 0, 0)
    let pk = k - 1; while (pk >= 0 && groups[pk].notes.every((o) => o.midi === n.midi)) pk--;
    let nk = k + 1; while (nk < groups.length && groups[nk].notes.every((o) => o.midi === n.midi)) nk++;
    const pg = groups[pk], ng = groups[nk];
    // intrusion: in a single-note line, an open string arriving together with the next note, well
    // below a tune that just carries on (54 → 52+0 → 51): the finger lifted as the next note was played
    let intrusion = 0;
    const g = groups[k].notes;
    if (g.length === 2) {
      const other = g.find((o) => o !== n), prev = pg?.notes[0];
      // a single-note line leads up to it (a pair holding this same ghost pitch counts: 0, 0)
      const g2 = pk >= 1 ? groups[pk - 1].notes : [];
      const line = g2.length === 1 || (g2.length === 2 && g2.some((o) => o.midi === n.midi));
      if (other.midi > n.midi && opens.includes(n.midi) && line && pg?.notes.length === 1 && (!ng || ng.notes.length === 1)
        && prev.midi - n.midi >= 5 && prev.midi - n.midi <= 24 && Math.abs(other.midi - prev.midi) <= 4
        // the tune moves on, or the note before just flickers back on for a moment as the finger lifts
        && (other.midi !== prev.midi || (other.end - other.start < 0.3 && amp(other) < amp(prev)))) intrusion = 0.8;
    }
    if (chordy[i] && !intrusion) return { intent: 1, misfit: 0, support: 0, weakness: 0, chord: true };
    const lo = Math.max(0, k - 4), hi = Math.min(groups.length, k + 5);
    const around = groups.slice(lo, hi).flatMap((g) => g.notes).filter((o) => o !== n);

    let spike = 0, squeezed = 0, late = 0, openLift = 0, release = 0, frac = null;
    if (pg && ng) {
      frac = (n.start - pg.start) / (ng.start - pg.start);               // where it lands between its neighbours
      late = clamp01((frac - 0.6) / 0.25);                                // a lift comes just before the next note
      // a leap only means something between lone notes (a melody), not around chords
      if (pg.notes.length === 1 && ng.notes.length === 1) {
        const prev = pg.notes[0], next = ng.notes[0];
        const step = Math.abs(next.midi - prev.midi);
        const away = Math.min(Math.abs(n.midi - prev.midi), Math.abs(n.midi - next.midi));
        spike = step <= 4 ? clamp01((away - 4) / 6) : 0;
      }
      // gaps between onsets nearby (with this note in, so a regular pedal note sets its own pulse)
      const iois = [];
      for (let j = lo + 1; j < hi; j++) iois.push(groups[j].start - groups[j - 1].start);
      const med = median(iois);
      const span = ng.start - pg.start;
      if (med > 0 && Math.abs(span / med - 1) < 0.3) {                   // without this note, the rhythm is even
        squeezed = clamp01(((n.start - pg.start) / span - 0.5) / 0.3);   // and it lands late in that gap
      }
    }
    if (pg) {
      const held = pg.notes.filter((p) => p.midi > n.midi);
      if (held.some((p) => opens.some((o) => o === n.midi && p.midi - o >= 1 && p.midi - o <= 24))) openLift = 1;
      const gap = n.start - Math.max(...pg.notes.map((p) => p.end));
      if (held.length && gap >= -0.4 && gap <= 0.8) release = 1;
    }
    // trailing: the very last thing heard is an open string ringing as the finger comes off at the end
    const trailing = !ng && k === groups.length - 1 && k > 0 && openLift && release && n.end - n.start < 2.5 ? 0.7 : 0;
    let misfit = Math.max(squeezed, 0.75 * late, 0.6 * spike, intrusion, trailing);
    // a pedal note: the same pitch comes back like clockwork (equal gaps before and after) and sits
    // in the middle of the beat. Ghosts come back irregularly and land late.
    const same = notes.filter((o, j) => o.midi === n.midi && !overtone[j]);
    const before = [...same].reverse().find((o) => o.start < n.start - 0.4), after = same.find((o) => o.start > n.start + 0.4);
    const d1 = before ? n.start - before.start : 0, d2 = after ? after.start - n.start : 0;
    const pedal = !!(before && after) && Math.abs(d1 - d2) <= 0.15 * Math.max(d1, d2) && (frac == null || Math.abs(frac - 0.5) < 0.15);
    if (pedal) misfit *= 0.5;
    const support = openLift * 0.7 + release * 0.3;

    const ref = Math.max(pg ? amp(top(pg)) : 0, median(around.map(amp))) || amp(n);
    const quiet = clamp01((1.05 - amp(n) / ref) / 0.45);
    const ons = around.map((o) => o.onset).filter((x) => x != null);
    const soft = n.onset == null || !ons.length ? 0.3 : clamp01((median(ons) - n.onset) / 0.2);
    const short = clamp01((0.3 - (n.end - n.start)) / 0.25);
    const weakness = clamp01(quiet * 0.5 + soft * 0.3 + short * 0.2);

    const doubt = misfit * (0.35 + 0.65 * support) * (0.6 + 0.4 * weakness) / 0.6; // 0 ... 1.67
    return { intent: clamp01(1 - doubt * 0.6), misfit, support, weakness,
      why: { spike, squeezed, late, intrusion, trailing, pedal, openLift, release, quiet, soft, short, sizes: [pk > 0 ? groups[pk - 1].notes.length : 0, pg?.notes.length ?? 0, g.length, ng?.notes.length ?? 0] } };
  });
}

/**
 * "Simple" detail, for capturing ideas while practising: a clean page with few notes and no rests.
 *  - notes snap to 8th notes (not 16ths)
 *  - each note lasts until the next one: no rests are written (you add your own where you want them)
 *  - a long pause just starts the next phrase at the next bar, instead of bars of rests
 *  - octave and overtone "notes" stacked on a single played note are dropped
 *  - very short, quiet blips are dropped
 * Returns { events, barStart } like quantize().
 */
function quantizeSimple(notes, tempo) {
  const { bpm, beat0, meter } = tempo;
  const p = 60 / bpm;
  const slotDur = p / SLOTS_PER_BEAT;
  const GRID = 2; // slots: an 8th note
  const barSlots = meter * SLOTS_PER_BEAT;
  const kept = notes.filter((n) => !(n.end - n.start < 0.1 && (n.amp ?? 0.6) < 0.5));
  if (!kept.length) return { events: [], barStart: beat0 };

  const first = Math.min(...kept.map((n) => n.start));
  let barStart = beat0 + (tempo.offset || 0) * p;
  const barDur = meter * p;
  while (barStart > first + slotDur) barStart -= barDur;
  while (barStart + barDur <= first - slotDur) barStart += barDur;

  // one pluck at a time (a strum is one pluck of several strings)
  const OVERTONE = [12, 19, 24, 28, 31];
  const oes = onsetEvents(kept);
  let ringing = []; // notes from the last two plucks, probably still sounding
  const plucks = oes.map((oe, oi) => {
    let notesIn = [...oe.notes].sort((a, b) => a.midi - b.midi);
    // a strum: three or more strings sounding loud together, with three different note names
    // (a single note's overtones are much quieter than the note itself)
    const loudest = Math.max(...notesIn.map((n) => n.amp ?? 0.6));
    const strong = notesIn.filter((n) => (n.amp ?? 0.6) >= 0.55 * loudest);
    const strum = strong.length >= 3 && new Set(strong.map((n) => ((n.midi % 12) + 12) % 12)).size >= 3;
    const prevKeys = ringing;
    if (!strum) {
      // the string played just before is still ringing: not a new note
      const fresh = notesIn.filter((n) => !prevKeys.includes(n.midi));
      if (fresh.length) notesIn = fresh;
      // overtones of the lowest note (octave, octave + 5th, two octaves…) aren't notes you played
      const low = notesIn[0].midi;
      notesIn = notesIn.filter((n) => n.midi === low || !OVERTONE.includes(n.midi - low));
      // neighbouring notes heard together (a run, not a chord): keep the loudest
      if (notesIn.length > 1 && (notesIn[notesIn.length - 1].midi - notesIn[0].midi <= 4 || notesIn.length > 2)) {
        notesIn = [notesIn.reduce((a, b) => ((b.amp ?? 0.6) > (a.amp ?? 0.6) ? b : a))];
      }
    }
    const keys = [...new Set(notesIn.map((n) => n.midi))].sort((a, b) => a - b);
    const last = oes[oi - 1] ? oes[oi - 1].notes.map((n) => n.midi) : [];
    ringing = [...new Set([...oe.notes.map((n) => n.midi), ...(oe.t - (oes[oi - 1]?.t ?? -9) < 1 ? last : [])])];
    return { t: oe.t, keys };
  });

  // snap to the 8th-note grid; two quick notes that land on the same 8th go one after the other
  const taken = new Map(); // slot → event
  const snapped = plucks.map((pl) => ({ ...pl, s: Math.max(0, Math.round((pl.t - barStart) / (slotDur * GRID)) * GRID) }));
  snapped.forEach((pl, i) => {
    let s = pl.s;
    if (taken.has(s)) {
      const nextS = i + 1 < snapped.length ? snapped[i + 1].s : Infinity;
      if (!taken.has(s + GRID) && s + GRID < nextS) s += GRID;          // the next 8th is free
      else if (!taken.has(s + 1) && s + 1 < nextS) s += 1;              // otherwise a 16th: notes this fast are real
    }
    const ev = taken.get(s);
    if (ev) { for (const k of pl.keys) if (!ev.keys.includes(k)) ev.keys.push(k); ev.keys.sort((a, b) => a - b); }
    else taken.set(s, { slot: s, keys: [...pl.keys] });
  });
  let evs = [...taken.values()].sort((a, b) => a.slot - b.slot);

  // the first note starts bar 1 (no lead-in rest)
  const shift0 = evs[0].slot;
  evs = evs.map((e) => ({ ...e, slot: e.slot - shift0 }));

  // each note lasts until the next; a long pause moves the next phrase up to the next bar line
  const events = [];
  let shift = 0;
  evs.forEach((e, i) => {
    const slot = e.slot - shift;
    const barEnd = (Math.floor(slot / barSlots) + 1) * barSlots;
    let end;
    if (i + 1 < evs.length) {
      const next = evs[i + 1].slot - shift;
      if (next - barEnd > barSlots) { // more than a whole empty bar: close the gap
        shift += next - barEnd;
        end = barEnd;
      } else end = next;
    } else end = barEnd; // the last note rings to the end of its bar
    events.push({ slot, len: Math.max(GRID, end - slot), keys: e.keys });
  });
  return { events, barStart: barStart + shift0 * slotDur };
}

/**
 * Lay score events out into bars of notatable pieces (splitting long notes with ties,
 * filling gaps with rests). events = [{ slot, len, ... }] sorted, non-overlapping.
 * Returns measures: [[piece]] with piece = { slots, at, rest, evIdx, tieFromPrev, tieToNext,
 * restAt, restLen } (restAt/restLen = the whole gap a rest piece belongs to).
 */
export function layoutBars(events, barSlots) {
  const items = [];
  let cursor = 0;
  events.forEach((ev, idx) => {
    if (ev.slot > cursor) items.push({ slot: cursor, len: ev.slot - cursor, rest: true });
    const start = Math.max(ev.slot, cursor);
    const end = ev.slot + ev.len;
    if (end > start) items.push({ slot: start, len: end - start, evIdx: idx });
    cursor = Math.max(cursor, end);
  });
  const bars = Math.max(1, Math.ceil(cursor / barSlots));
  if (cursor < bars * barSlots) items.push({ slot: cursor, len: bars * barSlots - cursor, rest: true });

  const measures = Array.from({ length: bars }, () => []);
  const flat = [];
  for (const it of items) {
    // rests are split per bar so each bar's rest can be tapped on its own
    let pos = it.slot, remaining = it.len, firstPiece = true;
    while (remaining > 0) {
      const bar = Math.floor(pos / barSlots);
      const inBar = pos - bar * barSlots;
      const room = Math.min(remaining, barSlots - inBar);
      const len = pickLen(inBar, room, barSlots);
      const piece = {
        slots: len, at: pos, rest: !!it.rest, evIdx: it.rest ? null : it.evIdx,
        tieFromPrev: !it.rest && !firstPiece, tieToNext: false,
      };
      measures[bar].push(piece);
      flat.push(piece);
      pos += len; remaining -= len; firstPiece = false;
    }
  }
  // tapping a rest offers the silence from there to the end of that gap in the bar
  for (const bar of measures) {
    let acc = 0;
    for (let i = bar.length - 1; i >= 0; i--) {
      const p = bar[i];
      if (!p.rest) { acc = 0; continue; }
      acc += p.slots;
      p.restAt = p.at;
      p.restLen = acc;
    }
  }
  for (let i = 1; i < flat.length; i++) if (flat[i].tieFromPrev) flat[i - 1].tieToNext = true;
  return measures;
}
