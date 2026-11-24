// Time signatures. Everything is counted in 16th-note slots; tempo.meter is the bar's length in
// quarter notes (6/8 → 3, 7/8 → 3.5) and tempo.time is its name, so 6/8 and 3/4 stay different.

// pulse: slots between metronome ticks · groups: how the bar is felt and beamed (in slots)
const LIST = [
  { id: '2/4', num: 2, den: 4, pulse: 4, groups: [4, 4] },
  { id: '3/4', num: 3, den: 4, pulse: 4, groups: [4, 4, 4] },
  { id: '4/4', num: 4, den: 4, pulse: 4, groups: [4, 4, 4, 4] },
  { id: '5/4', num: 5, den: 4, pulse: 4, groups: [4, 4, 4, 4, 4] },
  { id: '6/8', num: 6, den: 8, pulse: 6, groups: [6, 6] },
  { id: '7/8', num: 7, den: 8, pulse: 2, groups: [4, 4, 6] },
  { id: '9/8', num: 9, den: 8, pulse: 6, groups: [6, 6, 6] },
  { id: '12/8', num: 12, den: 8, pulse: 6, groups: [6, 6, 6, 6] },
].map((t) => ({ ...t, meter: (t.num * 4) / t.den, barSlots: (t.num * 16) / t.den, ticks: (t.num * 16) / t.den / t.pulse }));

export const TIMES = LIST.map((t) => t.id);
export const DEFAULT_TIME = '4/4';

/** Everything about a time signature by name. */
export function timeInfo(id) { return LIST.find((t) => t.id === id) || LIST.find((t) => t.id === DEFAULT_TIME); }
/** The time signature of a tempo ({ meter, time? }); older songs only have meter (always over 4). */
export function timeOf(tempo) {
  const t = LIST.find((x) => x.id === tempo?.time);
  if (t && t.meter === Number(tempo.meter)) return t.id;
  return LIST.find((x) => x.den === 4 && x.meter === Number(tempo?.meter))?.id
    || LIST.find((x) => x.meter === Number(tempo?.meter))?.id || DEFAULT_TIME;
}
