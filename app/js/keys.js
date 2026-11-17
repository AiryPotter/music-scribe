// Keys: work out the key from the written notes, and spell every note in it
// (two sharps for D major, B♭ rather than A♯ in F, E♯ in F♯ major…).
// A key is { fifths: -7…7 (negative = flats), mode: 'major' | 'minor' }.

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const MAJOR_NAMES = { '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯' };
const MINOR_NAMES = { '-7': 'A♭', '-6': 'E♭', '-5': 'B♭', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F♯', 4: 'C♯', 5: 'G♯', 6: 'D♯', 7: 'A♯' };
const VEX_MAJOR = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };

const pcOf = (m) => ((m % 12) + 12) % 12;

/** "A minor", "B♭ major". */
export function keyName(key) {
  return key.mode === 'minor' ? `${MINOR_NAMES[key.fifths]} minor` : `${MAJOR_NAMES[key.fifths]} major`;
}
/** VexFlow's key-signature name for the signature (minor keys use their relative major's). */
export function vexKeySpec(fifths) { return VEX_MAJOR[fifths] || 'C'; }

/** How each letter is altered by the key signature: { F: 1, C: 1, … } (−1 flat, +1 sharp). */
export function signature(fifths) {
  const sig = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => { sig[l] = 1; });
  if (fifths < 0) [...SHARP_ORDER].reverse().slice(0, -fifths).forEach((l) => { sig[l] = -1; });
  return sig;
}

/**
 * Spell a MIDI note in a key: { letter, alter (−1/0/+1), octave }.
 * Notes in the key use the key's spelling; others are a natural where possible,
 * otherwise sharps in sharp keys (and in C) and flats in flat keys.
 */
export function spell(midi, fifths = 0) {
  const pc = pcOf(midi);
  const sig = signature(fifths);
  const options = LETTERS.map((letter) => {
    let alter = pc - NATURAL[letter];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    return { letter, alter };
  }).filter((o) => Math.abs(o.alter) <= 1);
  let pick = options.find((o) => o.alter === sig[o.letter]); // in the key
  if (!pick) { // not in the key: a natural if there is one (F♮ in D major), else ♯ in sharp keys and C, ♭ in flat keys
    const wantSharp = fifths >= 0;
    pick = options.find((o) => o.alter === 0)
      || options.find((o) => o.alter === (wantSharp ? 1 : -1))
      || options[0];
  }
  const octave = Math.floor((midi - pick.alter) / 12) - 1;
  return { letter: pick.letter, alter: pick.alter, octave };
}

const SIGN = { '-1': '♭', 0: '', 1: '♯' };
/** "B♭3" */
export function spelledName(midi, fifths = 0) {
  const s = spell(midi, fifths);
  return `${s.letter}${SIGN[s.alter]}${s.octave}`;
}
/** "B♭" (no octave), for chord roots. */
export function spelledPc(pc, fifths = 0) {
  const s = spell(60 + pc, fifths);
  return `${s.letter}${SIGN[s.alter]}`;
}

// Krumhansl–Kessler key profiles: how strongly each scale degree belongs to a major / minor key
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(hist, profile, tonic) {
  const n = 12;
  let mh = 0, mp = 0;
  for (let i = 0; i < n; i++) { mh += hist[i]; mp += profile[i]; }
  mh /= n; mp /= n;
  let num = 0, dh = 0, dp = 0;
  for (let i = 0; i < n; i++) {
    const h = hist[(tonic + i) % 12] - mh, p = profile[i] - mp;
    num += h * p; dh += h * h; dp += p * p;
  }
  return dh && dp ? num / Math.sqrt(dh * dp) : 0;
}

/** Signature for a tonic: majors as written below; minors use their relative major's signature. */
function fifthsFor(tonicPc, mode) {
  const majorPc = mode === 'minor' ? (tonicPc + 3) % 12 : tonicPc;
  let f = (majorPc * 7) % 12; // C=0, G=1, D=2…
  if (f > 6) f -= 12;          // F=-1, B♭=-2…
  if (mode === 'minor' && f === 6) f = -6; // E♭ minor rather than D♯ minor
  return f;
}

/**
 * Work out the key from score events [{ slot, len, notes:[{ midi }] }].
 * Longer and bass notes count more; the last bass note leans the choice towards its key.
 * Returns { fifths, mode, confidence } or C major if there's nothing to go on.
 */
export function detectKey(events) {
  const hist = new Array(12).fill(0);
  let total = 0;
  for (const ev of events) {
    const lowest = Math.min(...ev.notes.map((n) => n.midi));
    for (const n of ev.notes) {
      const w = Math.min(ev.len, 8) * (n.midi === lowest ? 1.5 : 1);
      hist[pcOf(n.midi)] += w;
      total += w;
    }
  }
  if (!total) return { fifths: 0, mode: 'major', confidence: 0 };
  const lastBass = events.length ? pcOf(Math.min(...events[events.length - 1].notes.map((n) => n.midi))) : -1;
  const firstBass = events.length ? pcOf(Math.min(...events[0].notes.map((n) => n.midi))) : -1;
  const scored = [];
  for (let t = 0; t < 12; t++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
      let s = correlate(hist, prof, t);
      if (t === lastBass) s += 0.08;  // pieces tend to end on the home note
      if (t === firstBass) s += 0.04;
      if (mode === 'major') s += 0.01; // tie-break: major is more common
      scored.push({ s, fifths: fifthsFor(t, mode), mode });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0];
  return { fifths: best.fifths, mode: best.mode, confidence: +(best.s - scored[1].s).toFixed(3) };
}

/** Every key for the Key picker: [{ value: "2:major", label: "D major (2♯)" }, …] */
export function keyChoices() {
  const out = [];
  for (const mode of ['major', 'minor']) {
    for (let f = -6; f <= 6; f++) {
      const sig = f > 0 ? ` (${f}♯)` : f < 0 ? ` (${-f}♭)` : '';
      out.push({ value: `${f}:${mode}`, label: `${keyName({ fifths: f, mode })}${sig}` });
    }
  }
  return out;
}
