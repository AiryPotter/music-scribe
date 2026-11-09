// Names chords from the notes that sound together (e.g. C, Am7, G/B, E5).

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const TEMPLATES = [
  { s: '', iv: [0, 4, 7] },
  { s: 'm', iv: [0, 3, 7] },
  { s: '7', iv: [0, 4, 7, 10] },
  { s: 'maj7', iv: [0, 4, 7, 11] },
  { s: 'm7', iv: [0, 3, 7, 10] },
  { s: 'sus2', iv: [0, 2, 7] },
  { s: 'sus4', iv: [0, 5, 7] },
  { s: '6', iv: [0, 4, 7, 9] },
  { s: 'm6', iv: [0, 3, 7, 9] },
  { s: 'add9', iv: [0, 2, 4, 7] },
  { s: 'dim', iv: [0, 3, 6] },
  { s: 'm7♭5', iv: [0, 3, 6, 10] },
  { s: 'aug', iv: [0, 4, 8] },
  { s: '5', iv: [0, 7] },
];

/** Returns a chord name, or '' if the notes don't form a recognisable chord. */
export function nameChord(midis) {
  const uniq = [...new Set(midis)].sort((a, b) => a - b);
  const pcs = [...new Set(uniq.map((m) => ((m % 12) + 12) % 12))];
  if (pcs.length < 2) return '';
  const bass = ((uniq[0] % 12) + 12) % 12;
  let best = null;
  for (const root of pcs) {
    const rel = new Set(pcs.map((pc) => (pc - root + 12) % 12));
    for (const t of TEMPLATES) {
      if (t.s === '5' && pcs.length !== 2) continue;
      const hit = t.iv.filter((i) => rel.has(i)).length;
      const missing = t.iv.length - hit;
      const extra = rel.size - hit;
      // the 5th may be left out of 7th chords; nothing else may be
      const fifthOptional = missing === 1 && !rel.has(7) && t.iv.length === 4 && t.iv.includes(7);
      if (missing > 0 && !fifthOptional) continue;
      let score = hit * 2 - extra * 2.5 - (fifthOptional ? 1 : 0);
      if (root === bass) score += 1;
      if (t.s === '' || t.s === 'm') score += 0.5; // prefer simple names when tied
      if (!best || score > best.score) best = { score, root, s: t.s };
    }
  }
  if (!best || best.score < 3) return '';
  const name = NAMES[best.root] + best.s;
  return best.root === bass || best.s === '5' ? name : `${name}/${NAMES[bass]}`;
}
