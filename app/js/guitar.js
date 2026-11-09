// Guitar knowledge: note names, tunings, and picking a sensible string/fret.

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const VEX_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

export const TUNINGS = {
  standard: { name: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] }, // low E → high e
};

const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high e'];

export function noteName(midi) {
  return SHARP_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** Guitar music is written an octave above how it sounds (treble clef 8vb). */
export function vexKey(midi) {
  const w = midi + 12;
  const pc = ((w % 12) + 12) % 12;
  const name = VEX_NAMES[pc];
  return { key: `${name}/${Math.floor(w / 12) - 1}`, sharp: name.includes('#') };
}

export function stringName(index) {
  return STRING_NAMES[index] || '';
}

/**
 * Picks a string and fret for each note, keeping the fretting hand near where
 * it already is (so tabs don't jump all over the neck).
 */
export class FretPicker {
  constructor(tuning = TUNINGS.standard, maxFret = 19) {
    this.tuning = tuning;
    this.maxFret = maxFret;
    this.reset();
  }

  reset() {
    this.hand = 2; // start near open position
  }

  /**
   * Place several notes that sound together (a chord) on different strings,
   * keeping the shape playable (small fret span) and near the hand.
   * Returns [{ midi, pos }] with pos = null for a note that couldn't be placed.
   */
  pickChord(midis) {
    const notes = [...new Set(midis)].sort((a, b) => a - b);
    if (notes.length === 1) return [{ midi: notes[0], pos: this.pick(notes[0]) }];
    const strings = this.tuning.strings;
    const S = strings.length;
    const use = notes.slice(0, S); // a guitar has six strings
    const cands = use.map((m) => strings
      .map((open, i) => ({ i, fret: m - open }))
      .filter((c) => c.fret >= 0 && c.fret <= 15));
    const used = new Array(S).fill(false);
    const cur = [];
    let best = null;
    const rec = (k) => {
      if (k === use.length) {
        const fretted = cur.filter((c) => c && c.fret > 0).map((c) => c.fret);
        const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
        if (span > 4) return;
        const avg = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0;
        const dropped = cur.filter((c) => !c).length;
        const cost = dropped * 10 + span * 1.5 + Math.abs(avg - this.hand) * 0.35 + avg * 0.15;
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
      return { midi: m, pos: c ? { string: S - c.i, stringIndex: c.i, fret: c.fret } : null };
    });
  }

  /** Like pick(), but doesn't move the hand (for the live readout). */
  peek(midi) {
    const hand = this.hand;
    const res = this.pick(midi);
    this.hand = hand;
    return res;
  }

  /** Returns { string (1 = high e, 6 = low E, VexFlow style), stringIndex, fret } or null if out of range. */
  pick(midi) {
    let best = null;
    this.tuning.strings.forEach((open, i) => {
      const fret = midi - open;
      if (fret < 0 || fret > this.maxFret) return;
      let cost = Math.abs(fret - this.hand);
      if (fret === 0) cost -= 0.6;          // open strings are easy
      if (fret > 12) cost += 1.5;           // high up the neck is less common
      cost += fret * 0.04;                  // slight preference for lower frets
      if (!best || cost < best.cost) best = { cost, fret, stringIndex: i };
    });
    if (!best) return null;
    if (best.fret > 0) this.hand = Math.round(this.hand * 0.5 + best.fret * 0.5);
    return { string: this.tuning.strings.length - best.stringIndex, stringIndex: best.stringIndex, fret: best.fret };
  }
}
