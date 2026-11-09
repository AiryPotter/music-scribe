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
