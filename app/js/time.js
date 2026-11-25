// Time signatures. Everything is counted in 16th-note slots; tempo.meter is the bar's length in
// quarter notes (6/8 → 3, 7/8 → 3.5) and tempo.time is its name, so 6/8 and 3/4 stay different.
// A name is "7/8" (the usual grouping) or "3+2+2/8" (counted in your own groups).

export const TIMES = ['2/4', '3/4', '4/4', '5/4', '3/2', '3/8', '6/8', '7/8', '9/8', '12/8', '15/8'];
export const DEFAULT_TIME = '4/4';
export const MAX_TOP = 32, MAX_BAR = 128; // (a bar of 128 sixteenths is already 8 bars of 4/4)
const WRITABLE = [16, 12, 8, 6, 4, 3, 2, 1]; // lengths one note or rest can have, in slots

/** The usual way to count n: threes if it divides (6/8, 9/8…), else twos with a three at the end (7/8 = 2+2+3). */
function usualGroups(num, den) {
  if (den < 8) return Array(num).fill(1);
  if (num % 3 === 0) return Array(num / 3).fill(3);
  if (num === 1) return [1];
  const out = Array(Math.floor(num / 2)).fill(2);
  if (num % 2) out[out.length - 1] = 3;
  return out;
}

const made = new Map();
/** Read a time signature's name → its details, or null if it isn't one.
 * pulse: slots between metronome ticks · groups: how the bar is felt and beamed (in slots) ·
 * accents: ticks that start a group (your own grouping only) · rests: an empty bar, in writable lengths */
export function parseTime(id) {
  const key = String(id ?? '').replace(/\s/g, '');
  if (made.has(key)) return made.get(key);
  const m = /^(\d{1,2}(?:\+\d{1,2})*)\/(2|4|8|16)$/.exec(key);
  if (!m) return null;
  const parts = m[1].split('+').map(Number), den = Number(m[2]);
  const num = parts.reduce((a, b) => a + b, 0), unit = 16 / den;
  if (parts.some((p) => p < 1) || num > MAX_TOP || num * unit > MAX_BAR) return null;
  const usual = usualGroups(num, den);
  const own = parts.length > 1 && parts.join() !== usual.join();
  const beats = own ? parts : usual;
  const groups = beats.map((b) => b * unit);
  // 6/8, 9/8, 12/8… tick once per group of three; everything else ticks every beat
  const pulse = !own && den >= 8 && num > 3 && usual.every((g) => g === 3) ? 3 * unit : unit;
  const accents = [];
  if (own) { let at = 0; for (const g of groups) { accents.push(at / pulse); at += g; } }
  const rests = groups.flatMap((g) => { const out = []; for (let left = g; left > 0;) { const w = WRITABLE.find((x) => x <= left); out.push(w); left -= w; } return out; });
  const t = { id: own ? `${parts.join('+')}/${den}` : `${num}/${den}`, num, den, top: own ? parts.join('+') : String(num), own, pulse, groups, accents, rests,
    grouped: own || den !== 4, meter: num * unit / 4, barSlots: num * unit, ticks: num * unit / pulse };
  if (made.size > 500) made.clear();
  made.set(key, t);
  return t;
}

/** Everything about a time signature by name. */
export function timeInfo(id) { return parseTime(id) || parseTime(DEFAULT_TIME); }
/** The time signature of a tempo ({ meter, time? }); older songs only have meter (always over 4). */
export function timeOf(tempo) {
  const meter = Number(tempo?.meter), t = parseTime(tempo?.time);
  if (t && t.meter === meter) return t.id;
  return TIMES.find((x) => x.endsWith('/4') && timeInfo(x).meter === meter) || TIMES.find((x) => timeInfo(x).meter === meter) || DEFAULT_TIME;
}
