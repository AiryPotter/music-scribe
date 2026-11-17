// "Mozart's mistakes": a log of the corrections you make, so we can see what the
// transcription gets wrong most and re-tune it. Kept on this device only.
// It holds kinds of fix and the notes involved: no audio, no song titles, no timing of your playing.

const KEY = 'musicScribe.fixlog';
const MAX_FIXES = 3000;
const OVERTONES = [12, 19, 24, 28, 31];

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && Array.isArray(d.fixes) && d.takes && typeof d.takes === 'object') return d;
  } catch { /* fall through */ }
  return { fixes: [], takes: {} };
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage full or blocked: the log just stops growing */ }
}

const day = () => new Date().toISOString().slice(0, 10);

/** Note a newly written take, so mistakes can be counted per note Mozart wrote. */
export function registerTake(id, { source, notes, bpm, meter, tuning, capo }) {
  if (!id) return;
  const d = load();
  if (d.takes[id]) return;
  d.takes[id] = { source, notes, bpm: Math.round(bpm), meter, tuning, capo, day: day() };
  save(d);
}

/** Record one correction. step = the undo position it belongs to (so Undo can remove it). */
export function record(takeId, step, fix) {
  if (!takeId || !fix) return;
  const d = load();
  d.fixes.push({ take: takeId, step, day: day(), ...fix });
  if (d.fixes.length > MAX_FIXES) d.fixes.splice(0, d.fixes.length - MAX_FIXES);
  save(d);
}

/** Undo took back the edit at this step: forget it. */
export function unrecord(takeId, step) {
  const d = load();
  const left = d.fixes.filter((f) => !(f.take === takeId && f.step === step)); // an edit of several notes logs several fixes
  if (left.length === d.fixes.length) return;
  d.fixes = left;
  save(d);
}

export function clearLog() { const d = load(); save({ fixes: [], takes: {} }); return d; }
export function restoreLog(d) { save(d); }
export function fixCount() { return load().fixes.length; }

/** How a note relates to the other notes in its chord (for added/removed notes). */
export function relation(midi, others) {
  const below = others.filter((m) => m < midi);
  if (below.some((m) => OVERTONES.includes(midi - m))) return 'overtone'; // an octave, twelfth… above a note that's there
  if (others.some((m) => (m - midi) % 12 === 0 && m !== midi)) return 'octave';
  return 'other';
}

/**
 * Work out what kind of fix an edit was, from the event before and after.
 * what: 'pitch' | 'add' | 'remove' | 'rest' | 'fill' | 'length' | 'join' | 'split' | 'string' | 'chord'
 */
export function describe(what, before, after, focusBefore) {
  const mids = (ev) => (ev ? ev.notes.map((n) => n.midi) : []);
  const b = mids(before), a = mids(after);
  switch (what) {
    case 'pitch': {
      const from = before?.notes[focusBefore]?.midi;
      const added = a.filter((m) => !b.includes(m));
      const to = added[0];
      if (from === undefined || to === undefined) return null;
      return { kind: 'pitch', from, to, by: to - from };
    }
    case 'add': {
      const m = a.find((x) => !b.includes(x));
      return m === undefined ? null : { kind: 'missed', notes: [m], rel: relation(m, b), inChord: b.length };
    }
    case 'fill':
      return { kind: 'missed', notes: a, rel: 'alone', inChord: 0 };
    case 'remove': {
      const gone = b.filter((x) => !a.includes(x));
      if (!gone.length) return null;
      const rest = b.filter((x) => !gone.includes(x));
      return { kind: 'extra', notes: gone, rel: relation(gone[0], rest), inChord: b.length };
    }
    case 'rest':
      return { kind: 'extra', notes: b, rel: b.length > 1 ? 'chord' : 'alone', inChord: b.length };
    case 'length':
      return before && after ? { kind: 'length', from: before.len, to: after.len } : null;
    case 'join': return { kind: 'join', notes: b };   // one note had been written as two
    case 'split': return { kind: 'split', notes: b }; // two plucks had been written as one
    case 'string': return { kind: 'string', notes: b };
    case 'chord': return { kind: 'chord', notes: b };
    default: return null;
  }
}

const NAMES = {
  extra: 'Wrong extra notes', missed: 'Missed notes', pitch: 'Wrong pitch', length: 'Wrong length',
  join: 'One note written as two', split: 'Two notes written as one', tempo: 'Wrong tempo', meter: 'Wrong time signature',
  string: 'Different string/fret', chord: 'Chord name changed',
};
const REL = {
  overtone: 'an overtone (octave or 12th above a real note)', octave: 'an octave of a note in the chord',
  other: 'a different note', alone: 'on its own', chord: 'a whole chord',
};

/** Summary for the screen: totals by kind, and the most common details. */
export function summary() {
  const d = load();
  const takes = Object.values(d.takes);
  const written = takes.reduce((s, t) => s + (t.notes || 0), 0);
  // ▲▲ on the same note is one fix ("off by 2"), not two: join pitch steps that follow on from each other
  const fixes = [];
  for (const f of d.fixes) {
    const p = fixes[fixes.length - 1];
    if (f.kind === 'pitch' && p?.kind === 'pitch' && p.take === f.take && p.to === f.from && f.step === p.step + 1) {
      fixes[fixes.length - 1] = { ...p, to: f.to, by: f.to - p.from, step: f.step };
    } else fixes.push(f);
  }
  const groups = {};
  for (const f of fixes) {
    const g = (groups[f.kind] ||= { count: 0, notes: 0, details: {} });
    g.count++;
    g.notes += f.notes ? f.notes.length : 1;
    let det = '';
    if (f.kind === 'missed' && f.rel === 'overtone') det = 'an octave or 12th above a chord note (thrown away as an overtone)';
    else if (f.kind === 'extra' || f.kind === 'missed') det = REL[f.rel] || f.rel;
    else if (f.kind === 'pitch') det = f.by % 12 === 0 ? `off by ${Math.abs(f.by / 12)} octave${Math.abs(f.by) > 12 ? 's' : ''}` : `off by ${Math.abs(f.by)} semitone${Math.abs(f.by) === 1 ? '' : 's'}`;
    else if (f.kind === 'length') det = f.to > f.from ? 'should be longer' : 'should be shorter';
    else if (f.kind === 'tempo') det = f.ratio === 0.5 ? 'was double (halved)' : f.ratio === 2 ? 'was half (doubled)' : 'nudged';
    else if (f.kind === 'meter') det = `${f.from}/4 → ${f.to}/4`;
    if (det) g.details[det] = (g.details[det] || 0) + 1;
  }
  const rows = Object.entries(groups)
    .map(([kind, g]) => ({ kind, name: NAMES[kind] || kind, count: g.count, notes: g.notes, details: Object.entries(g.details).sort((x, y) => y[1] - x[1]) }))
    .sort((x, y) => y.count - x.count);
  const editedTakes = new Set(fixes.map((f) => f.take)).size;
  return { fixes: fixes.length, takes: takes.length, editedTakes, written, rows };
}

/** The log as a small file to share for re-tuning (you choose whether to send it). */
export function exportLog() {
  const d = load();
  const out = {
    format: 'music-scribe-fixlog', version: 1, app: 'Music Scribe', savedAt: day(),
    note: 'Corrections made to Mozart\'s transcriptions. No audio, no titles.',
    summary: summary(),
    takes: d.takes,
    fixes: d.fixes,
  };
  return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
}
