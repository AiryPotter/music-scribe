// Guitar knowledge: note names, tunings, capo, and picking a sensible string/fret.

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const VEX_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

// open strings, low → high (MIDI numbers)
export const TUNINGS = {
  standard: { name: 'Standard', strings: [40, 45, 50, 55, 59, 64] },
  dropD: { name: 'Drop D', strings: [38, 45, 50, 55, 59, 64] },
  halfDown: { name: 'Half-step down', strings: [39, 44, 49, 54, 58, 63] },
  wholeDown: { name: 'Whole-step down', strings: [38, 43, 48, 53, 57, 62] },
  dropC: { name: 'Drop C', strings: [36, 43, 48, 53, 57, 62] },
};
export const MAX_CAPO = 12;

export function noteName(midi) {
  return SHARP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
/** Name for an open string / tuning label (flats read better here: E♭ A♭ D♭…). */
export function pitchClassName(midi, flats = true) {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((midi % 12) + 12) % 12];
}
export function noteNameFlat(midi) {
  return pitchClassName(midi) + (Math.floor(midi / 12) - 1);
}
/** "D A D G B E" */
export function tuningLetters(strings) {
  return strings.map((m) => pitchClassName(m)).join(' ');
}

/** Guitar music is written an octave above how it sounds (treble clef 8vb). */
export function vexKey(midi) {
  const w = midi + 12;
  const pc = ((w % 12) + 12) % 12;
  const name = VEX_NAMES[pc];
  return { key: `${name}/${Math.floor(w / 12) - 1}`, sharp: name.includes('#') };
}

/** "low E", "A", …, "high e" for any tuning. */
export function stringName(index, strings = TUNINGS.standard.strings) {
  const n = pitchClassName(strings[index] ?? 40);
  if (index === 0) return `low ${n}`;
  if (index === strings.length - 1) return `high ${n.toLowerCase()}`;
  return n;
}

/**
 * Picks a string and fret for each note, keeping the fretting hand near where
 * it already is (so tabs don't jump all over the neck).
 * With a capo, frets are counted from the capo (capo 2 + open C shape = 0-1-0-2-3).
 */
export class FretPicker {
  constructor(strings = TUNINGS.standard.strings, capo = 0, maxFret = 19) {
    this.strings = strings;
    this.capo = capo;
    this.maxFret = Math.max(5, maxFret - capo);
    this.reset();
  }

  reset() {
    this.hand = 2; // start near open position
  }

  /** Fret for a note on a string (from the capo), or null if it can't be played there. */
  fretOn(midi, stringIndex) {
    const open = this.strings[stringIndex];
    if (open === undefined) return null;
    const fret = midi - open - this.capo;
    return fret >= 0 && fret <= this.maxFret ? fret : null;
  }

  /** Every string a note can be played on: [{ stringIndex, fret }]. */
  options(midi) {
    const out = [];
    this.strings.forEach((_, i) => {
      const fret = this.fretOn(midi, i);
      if (fret !== null) out.push({ stringIndex: i, fret });
    });
    return out;
  }

  pos(stringIndex, fret) {
    return { string: this.strings.length - stringIndex, stringIndex, fret };
  }

  /**
   * Place several notes that sound together (a chord) on different strings,
   * keeping the shape playable (small fret span) and near the hand.
   * locks: optional array (same order as midis after sorting) of a forced stringIndex per note.
   * Returns [{ midi, pos }] with pos = null for a note that couldn't be placed.
   */
  pickChord(midis, locks = []) {
    const notes = [...new Set(midis)].sort((a, b) => a - b);
    if (notes.length === 1) return [{ midi: notes[0], pos: this.pick(notes[0], locks[0]) }];
    const S = this.strings.length;
    const use = notes.slice(0, S); // a guitar has six strings
    const cands = use.map((m, k) => {
      const all = this.options(m).filter((c) => c.fret <= 15);
      const lock = locks[k];
      const locked = lock !== undefined && lock !== null ? all.filter((c) => c.stringIndex === lock) : [];
      return (locked.length ? locked : all).map((c) => ({ i: c.stringIndex, fret: c.fret, locked: locked.length > 0 }));
    });
    const used = new Array(S).fill(false);
    const cur = [];
    let best = null;
    const rec = (k) => {
      if (k === use.length) {
        const fretted = cur.filter((c) => c && c.fret > 0).map((c) => c.fret);
        const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
        const anyLocked = cur.some((c) => c?.locked);
        if (span > 4 && !anyLocked) return;
        const avg = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0;
        const dropped = cur.filter((c) => !c).length;
        const cost = dropped * 10 + Math.max(0, span - 4) * 6 + span * 1.5 + Math.abs(avg - this.hand) * 0.35 + avg * 0.15;
        if (!best || cost < best.cost) best = { cost, assign: cur.slice(), avg };
        return;
      }
      for (const c of cands[k]) {
        if (used[c.i]) continue;
        used[c.i] = true; cur.push(c);
        rec(k + 1);
        cur.pop(); used[c.i] = false;
      }
      cur.push(null); rec(k + 1); cur.pop();
    };
    rec(0);
    if (best && best.avg > 0) this.hand = Math.round(this.hand * 0.4 + best.avg * 0.6);
    return notes.map((m, k) => {
      const c = best && k < use.length ? best.assign[k] : null;
      return { midi: m, pos: c ? this.pos(c.i, c.fret) : null };
    });
  }

  /** Like pick(), but doesn't move the hand (for the live readout). */
  peek(midi) {
    const hand = this.hand;
    const res = this.pick(midi);
    this.hand = hand;
    return res;
  }

  /** Returns { string (1 = highest, VexFlow style), stringIndex, fret } or null if out of range. */
  pick(midi, lock = null) {
    if (lock !== null && lock !== undefined) {
      const fret = this.fretOn(midi, lock);
      if (fret !== null) {
        if (fret > 0) this.hand = Math.round(this.hand * 0.5 + fret * 0.5);
        return this.pos(lock, fret);
      }
    }
    let best = null;
    for (const { stringIndex: i, fret } of this.options(midi)) {
      let cost = Math.abs(fret - this.hand);
      if (fret === 0) cost -= 0.6;          // open strings are easy
      if (fret > 12) cost += 1.5;           // high up the neck is less common
      cost += fret * 0.04;                  // slight preference for lower frets
      if (!best || cost < best.cost) best = { cost, fret, stringIndex: i };
    }
    if (!best) return null;
    if (best.fret > 0) this.hand = Math.round(this.hand * 0.5 + best.fret * 0.5);
    return this.pos(best.stringIndex, best.fret);
  }
}
