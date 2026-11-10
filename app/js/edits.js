// Editing the written score. All functions change `score` in place and return the new selection.
//
// score = { tempo: { bpm, beat0, meter, offset }, events: [ev] }
// ev    = { slot, len, notes: [{ midi, str? }], chord? }
//   slot/len in 16th notes from the start of bar 1; events are sorted and never overlap.
//   note.str = string the user locked the note to (index, 0 = lowest string).
//   ev.chord: undefined = name it automatically, '' = hide, 'text' = the user's own name.
// selection = { kind: 'ev', idx, focus } | { kind: 'rest', at, len }

export const MIN_MIDI = 28;  // E1, lowest note we allow (below a drop-tuned guitar's range)
export const MAX_MIDI = 88;  // E6

// [slots, name]
export const LENGTHS = [
  [1, '16th'], [2, 'eighth'], [3, 'dotted eighth'], [4, 'quarter'],
  [6, 'dotted quarter'], [8, 'half'], [12, 'dotted half'], [16, 'whole'],
];

/** Tiny inline SVG of a note value (fonts on phones often lack the musical-symbol glyphs). */
export function noteIcon(slots) {
  const dotted = slots === 3 || slots === 6 || slots === 12;
  const base = dotted ? slots / 1.5 : slots;
  const hollow = base >= 8;
  const stem = base < 16;
  const flags = base === 2 ? 1 : base === 1 ? 2 : 0;
  let s = '<svg viewBox="0 0 22 26" width="18" height="22" aria-hidden="true">';
  s += `<ellipse cx="8" cy="20" rx="5" ry="3.6" transform="rotate(-22 8 20)" ${hollow ? 'fill="none" stroke="currentColor" stroke-width="1.8"' : 'fill="currentColor"'}/>`;
  if (stem) s += '<path d="M12.3 19 V3" stroke="currentColor" stroke-width="1.6"/>';
  for (let f = 0; f < flags; f++) s += `<path d="M12.3 ${3 + f * 5} q6 3 4 9" fill="none" stroke="currentColor" stroke-width="1.8"/>`;
  if (dotted) s += '<circle cx="18.5" cy="20" r="1.8" fill="currentColor"/>';
  return s + '</svg>';
}

export function sortNotes(ev) {
  ev.notes.sort((a, b) => a.midi - b.midi);
}

/** Longest this event can be without running into the next one. */
export function maxLen(score, idx) {
  const ev = score.events[idx], next = score.events[idx + 1];
  return next ? next.slot - ev.slot : 64;
}

/** Move one note of a chord up/down by `delta` semitones (skipping notes already in the chord). */
export function shiftPitch(score, sel, delta) {
  const ev = score.events[sel.idx];
  const note = ev.notes[sel.focus];
  if (!note) return sel;
  const taken = new Set(ev.notes.filter((n) => n !== note).map((n) => n.midi));
  let m = note.midi + delta;
  const step = Math.abs(delta) === 12 ? delta : Math.sign(delta) || 1; // octave jumps stay on the same note name
  while (taken.has(m)) m += step;
  if (m < MIN_MIDI || m > MAX_MIDI) return sel;
  note.midi = m;
  sortNotes(ev);
  return { ...sel, focus: ev.notes.indexOf(note) };
}

/** Lock a note to a string. */
export function setString(score, sel, stringIndex) {
  const note = score.events[sel.idx]?.notes[sel.focus];
  if (note) note.str = stringIndex;
  return sel;
}

/** Add a note to the chord: the selected note doubled an octave up (or down), else a nearby note. */
export function addNote(score, sel) {
  const ev = score.events[sel.idx];
  const top = ev.notes[ev.notes.length - 1]?.midi ?? 52;
  const have = new Set(ev.notes.map((n) => n.midi));
  const base = ev.notes[sel.focus]?.midi ?? top;
  const tries = [base + 12, base - 12, base + 24, base + 7, base + 5, base + 4, base + 3, base + 1, base - 1];
  const m = tries.find((x) => x >= MIN_MIDI && x <= MAX_MIDI && !have.has(x));
  if (m === undefined || ev.notes.length >= 6) return sel;
  const note = { midi: m };
  ev.notes.push(note);
  sortNotes(ev);
  return { ...sel, focus: ev.notes.indexOf(note) };
}

/** Remove one note from a chord; removing the last note leaves a rest. */
export function removeNote(score, sel) {
  const ev = score.events[sel.idx];
  if (ev.notes.length <= 1) return makeRest(score, sel);
  ev.notes.splice(sel.focus, 1);
  return { ...sel, focus: Math.min(sel.focus, ev.notes.length - 1) };
}

/** Turn a note/chord into silence. */
export function makeRest(score, sel) {
  const ev = score.events[sel.idx];
  score.events.splice(sel.idx, 1);
  return { kind: 'rest', at: ev.slot, len: ev.len };
}

/** Change how long a note lasts (clamped so it doesn't run into the next note). */
export function setLength(score, sel, len) {
  const ev = score.events[sel.idx];
  ev.len = Math.max(1, Math.min(len, maxLen(score, sel.idx)));
  return sel;
}

/** Put a new note into a silence. */
export function fillRest(score, at, len, midi) {
  const ev = { slot: at, len, notes: [{ midi }] };
  let idx = score.events.findIndex((e) => e.slot > at);
  if (idx < 0) idx = score.events.length;
  const next = score.events[idx];
  if (next) ev.len = Math.min(ev.len, next.slot - at);
  ev.len = Math.max(1, ev.len);
  score.events.splice(idx, 0, ev);
  return { kind: 'ev', idx, focus: 0 };
}

/** A sensible pitch for a note added into a rest: the nearest note before it, else low E. */
export function guessPitch(score, at) {
  let best = null;
  for (const e of score.events) {
    if (e.slot < at) best = e;
    else if (!best) { best = e; break; } else break;
  }
  return best ? best.notes[best.notes.length - 1].midi : 52;
}

const sameNotes = (a, b) => a.notes.length === b.notes.length && a.notes.every((n, i) => n.midi === b.notes[i].midi);

/** Can this note be tied to the next one (same notes, straight after)? */
export function canJoin(score, idx) {
  const ev = score.events[idx], next = score.events[idx + 1];
  return !!(ev && next && next.slot === ev.slot + ev.len && sameNotes(ev, next));
}

/** Tie into the next note: one longer note instead of two. */
export function join(score, sel) {
  if (!canJoin(score, sel.idx)) return sel;
  const ev = score.events[sel.idx];
  ev.len += score.events[sel.idx + 1].len;
  score.events.splice(sel.idx + 1, 1);
  return sel;
}

/** Untie: split a tied note into separately played notes at the given slot boundaries. */
export function split(score, sel, cuts) {
  const ev = score.events[sel.idx];
  const end = ev.slot + ev.len;
  const points = [...new Set(cuts)].filter((c) => c > ev.slot && c < end).sort((a, b) => a - b);
  if (!points.length) return sel;
  const bounds = [ev.slot, ...points, end];
  const parts = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const part = { slot: bounds[i], len: bounds[i + 1] - bounds[i], notes: ev.notes.map((n) => ({ ...n })) };
    if (i === 0 && ev.chord !== undefined) part.chord = ev.chord;
    parts.push(part);
  }
  score.events.splice(sel.idx, 1, ...parts);
  return sel;
}

/** Set (text), hide ('') or go back to automatic (undefined) chord naming. */
export function setChord(score, sel, name) {
  const ev = score.events[sel.idx];
  if (name === undefined) delete ev.chord;
  else ev.chord = name;
  return sel;
}
