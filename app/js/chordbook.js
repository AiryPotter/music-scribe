// The chord menu: which chords there are, which fit a key, and a playable shape for each one
// in whatever tuning and capo is set.
import { spelledPc } from './keys.js';
import { scaleOf } from './edits.js';

export const CHORD_KINDS = [
  { s: '', name: 'major', iv: [0, 4, 7] },
  { s: 'm', name: 'minor', iv: [0, 3, 7] },
  { s: '7', name: '7', iv: [0, 4, 7, 10] },
  { s: 'maj7', name: 'maj7', iv: [0, 4, 7, 11] },
  { s: 'm7', name: 'm7', iv: [0, 3, 7, 10] },
  { s: 'sus2', name: 'sus2', iv: [0, 2, 7] },
  { s: 'sus4', name: 'sus4', iv: [0, 5, 7] },
  { s: '5', name: '5 (power)', iv: [0, 7] },
  { s: 'dim', name: 'dim', iv: [0, 3, 6] },
  { s: 'aug', name: 'aug', iv: [0, 4, 8] },
  { s: 'add9', name: 'add9', iv: [0, 2, 4, 7] },
];
const kindOf = (s) => CHORD_KINDS.find((k) => k.s === s);
const mod = (x) => ((x % 12) + 12) % 12;

/** "9:m7" ↔ root 9 (A), kind m7 */
export const chordId = (root, s) => `${root}:${s}`;
export function parseChordId(id) {
  const m = /^(\d+):(.*)$/.exec(String(id));
  const root = m ? Number(m[1]) : NaN;
  return m && root < 12 && kindOf(m[2]) ? { root, kind: m[2] } : null;
}
export const chordLabel = (root, s, fifths = 0) => `${spelledPc(root, fifths)}${s}`;

/** The chords built on each step of the key. */
export function chordsInKey({ fifths = 0, mode = 'major' } = {}) {
  const tonic = mod(fifths * 7 + (mode === 'minor' ? 9 : 0)), scale = scaleOf(fifths);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const root = mod(tonic + i);
    if (!scale.has(root)) continue;
    const has = (n) => scale.has(mod(root + n));
    const s = has(4) && has(7) ? '' : has(3) && has(7) ? 'm' : has(3) && has(6) ? 'dim' : null;
    if (s !== null) out.push({ root, kind: s });
  }
  return out;
}

/**
 * A playable shape: [{ midi, str }] low → high (str = string index, 0 = lowest), or null.
 * strings: open pitches low → high (before the capo); the root is always the lowest note.
 */
export function chordShape(root, kind, strings, capo = 0, maxFret = 14) {
  const k = kindOf(kind);
  if (!k) return null;
  const open = strings.map((m) => m + capo), tones = new Set(k.iv.map((i) => mod(root + i)));
  const top = Math.max(5, maxFret - capo);
  let best = null;
  for (let base = 1; base <= top - 3; base++) {
    const cand = open.map((o) => {
      const f = [];
      for (const fret of [0, base, base + 1, base + 2, base + 3]) if (tones.has(mod(o + fret))) f.push(fret);
      return f;
    });
    const cur = new Array(strings.length).fill(null);
    const finish = () => {
      const on = cur.map((f, i) => ({ f, i })).filter((x) => x.f !== null);
      if (on.length < (kind === '5' ? 2 : 3)) return;
      const pcs = new Set(on.map((x) => mod(open[x.i] + x.f)));
      if (pcs.size < tones.size) return;
      const fretted = on.filter((x) => x.f > 0), low = fretted.length ? Math.min(...fretted.map((x) => x.f)) : 0;
      const span = fretted.length ? Math.max(...fretted.map((x) => x.f)) - low : 0;
      // one finger can hold down several strings at the lowest fret (a barre), if no open string lies under it
      const bar = fretted.filter((x) => x.f === low);
      const barOk = bar.length > 1 && !on.some((x) => x.f === 0 && x.i > bar[0].i);
      const fingers = fretted.length - (barOk ? bar.length - 1 : 0);
      if (fingers > 4) return;
      const want = kind === '5' ? 3 : 6;
      const score = 3 * Math.min(on.length, want) - (on.length > want ? 8 : 0)
        - 1.2 * (fretted.length ? fretted.reduce((s, x) => s + x.f, 0) / fretted.length : 0)
        - (kind === '5' ? 4 * on[0].i : 0) - 1.7 * span - 0.7 * fingers - (barOk ? 1.5 : 0) + 0.5 * on.filter((x) => x.f === 0).length;
      if (!best || score > best.score) best = { score, shape: on.map((x) => ({ midi: open[x.i] + x.f, str: x.i })) };
    };
    // strings sound in one unbroken run: muted ones only below or above it
    const rec = (i, state, last) => {
      if (i === strings.length) { finish(); return; }
      if (state !== 'on') { cur[i] = null; rec(i + 1, state, last); }
      if (state === 'after') return;
      for (const f of cand[i]) {
        const m = open[i] + f;
        if (state === 'before' ? mod(m) !== root : m <= last) continue;
        cur[i] = f;
        rec(i + 1, 'on', m);
      }
      cur[i] = null;
      if (state === 'on') rec(i + 1, 'after', last);
    };
    rec(0, 'before', -1);
  }
  return best?.shape || null;
}
