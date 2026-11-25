// Drum beats for the metronome. Every drum is made here from maths (no recordings, no downloads) and
// every beat is a pattern of single hits, so it stays in time at any speed and in any time signature.
import { parseTime, timeInfo } from './time.js';

// Patterns are one bar of 4/4: 16 steps (16ths) or 12 (triplets, for swung styles).
// X = loud, x = normal, o = soft. Other time signatures get a simpler beat in the same style:
// keep = what keeps time, back = the backbeat drum, sub = slots between timekeeping hits.
const K = 'kick', S = 'snare', R = 'rim', H = 'hat', O = 'open', P = 'pedal', D = 'ride', C = 'crash', A = 'shaker', L = 'clap', T = 'tamb';
export const BEATS = [
  { id: 'rock', name: 'Basic rock', group: 'Rock & pop', keep: H, back: S, sub: 2, pat: { [H]: 'X-x-X-x-X-x-X-x-', [K]: 'X-------X-x-----', [S]: '----X-------X---' } },
  { id: 'hardrock', name: 'Hard rock', group: 'Rock & pop', keep: O, back: S, sub: 4, pat: { [O]: 'X---x---x---x---', [K]: 'X-----x-X-x-----', [S]: '----X-------X---' } },
  { id: 'pop', name: 'Pop', group: 'Rock & pop', keep: T, back: L, sub: 2, pat: { [T]: 'o-x-o-x-o-x-o-x-', [K]: 'X---x---X---x---', [L]: '----X-------X---', [S]: '----o-------o---' } },
  { id: 'ballad', name: 'Slow ballad', group: 'Rock & pop', keep: H, back: R, sub: 2, pat: { [H]: 'x-o-x-o-x-o-x-o-', [K]: 'X---------x-----', [R]: '----X-------X---' } },
  { id: 'metal', name: 'Metal double kick', group: 'Rock & pop', keep: D, back: S, sub: 2, dbl: true, pat: { [D]: 'X---X---X---X---', [K]: 'xxxxxxxxxxxxxxxx', [S]: '----X-------X---' } },
  { id: 'funk', name: 'Funk', group: 'Groove', keep: H, back: S, sub: 1, pat: { [H]: 'xoxoxoxoxoxoxoxo', [K]: 'X--x--x---x--x--', [S]: '----X--o-o--X--o' } },
  { id: 'hiphop', name: 'Hip-hop', group: 'Groove', keep: H, back: S, sub: 2, pat: { [H]: 'x-x-x-x-x-x-x-x-', [K]: 'X------x--X-----', [S]: '----X-------X---' } },
  { id: 'reggae', name: 'Reggae one-drop', group: 'Groove', keep: H, back: R, sub: 2, pat: { [H]: 'o-X-o-X-o-X-o-X-', [K]: '--------X-------', [R]: '--------X-------' } },
  { id: 'shuffle', name: 'Blues shuffle', group: 'Blues, jazz & country', keep: H, back: S, sub: 2, swing: true, pat: { [H]: 'X-xX-xX-xX-x', [K]: 'X-----X-x---', [S]: '---X-----X--' } },
  { id: 'swing', name: 'Jazz swing', group: 'Blues, jazz & country', keep: D, back: P, sub: 4, swing: true, soft: true, pat: { [D]: 'x--X-xx--X-x', [P]: '---x-----x--', [K]: 'o--o--o--o--' } },
  { id: 'train', name: 'Country train', group: 'Blues, jazz & country', keep: S, back: S, sub: 1, soft: true, pat: { [S]: 'ooXoooXoooXoooXo', [K]: 'x-------x-------', [P]: '----x-------x---' } },
  { id: 'bossa', name: 'Bossa nova', group: 'Latin', keep: A, back: R, sub: 2, soft: true, pat: { [A]: 'x-o-x-o-x-o-x-o-', [K]: 'x-----x-x-----x-', [R]: 'x--x--x---x--x--' } },
];
export const beatInfo = (id) => BEATS.find((b) => b.id === id) || null;
const VEL = { X: 1, x: 0.7, o: 0.35 };

/** How a bar is felt, in slots: quarter-note bars go in twos (a three at the end), others in their own groups. */
function feltGroups(t) {
  if (t.own || t.den >= 8) return t.groups;
  const out = [], n = t.num, unit = 16 / t.den;
  for (let left = n; left > 0;) { const g = left === 3 || left === 1 ? left : 2; out.push(g * unit); left -= g; }
  return out;
}
/** A beat for any bar: kick on each group, the backbeat between, something keeping time. */
function simpleBar(b, t) {
  const hits = [], unit = 16 / t.den;
  const sub = b.sub === 1 && t.den < 16 ? 1 : t.den === 16 ? 1 : Math.min(unit, b.sub);
  const groups = feltGroups(t), starts = [];
  let at = 0;
  for (const g of groups) { starts.push([at, g]); at += g; }
  for (let s = 0; s < t.barSlots; s += sub) {
    const off = b.swing && t.den <= 4 && s % 4 === 2 ? 2 / 3 : 0; // swung off-beats land on the last triplet
    hits.push({ slot: s + off, drum: b.keep, vel: starts.some(([x]) => x === s) ? 0.9 : s % unit === 0 ? 0.6 : 0.35 });
  }
  const eighths = t.own || t.den >= 8;
  starts.forEach(([x, g], i) => {
    if (eighths) { // 6/8, 7/8, 3+3+2…: kick and backbeat take turns on the groups
      const last = i === starts.length - 1;
      const kick = i % 2 === 0;
      hits.push({ slot: x, drum: kick ? K : b.back, vel: kick ? (i ? 0.85 : 1) : 0.95 });
      if (kick && last && i > 0 && g > unit) hits.push({ slot: x + unit, drum: b.back, vel: 0.8 });
      if (starts.length === 1 && g > unit) hits.push({ slot: x + unit, drum: b.back, vel: 0.7 });
    } else { // quarters and halves: kick, back (kick, back, back for a three)
      hits.push({ slot: x, drum: K, vel: i ? 0.85 : 1 });
      if (g > unit) hits.push({ slot: x + unit, drum: b.back, vel: 0.95 });
      if (g > 2 * unit) hits.push({ slot: x + 2 * unit, drum: b.back, vel: 0.55 });
    }
  });
  if (b.dbl) for (let s = 0; s < t.barSlots; s++) if (!hits.some((h) => h.drum === K && h.slot === s)) hits.push({ slot: s, drum: K, vel: 0.6 });
  return hits;
}

const cache = new Map();
/** One bar of a beat: [{ slot (may be fractional), drum, vel }] in time order. bar counts from 0. */
export function drumBar(id, timeId, bar = 0, fills = true) {
  const b = beatInfo(id), t = parseTime(timeId) || timeInfo(timeId);
  if (!b) return [];
  const fill = fills && bar % 4 === 3 && t.barSlots >= 8, crash = fills && bar > 0 && bar % 4 === 0;
  const key = `${id}|${t.id}|${fill}|${crash}`;
  if (cache.has(key)) return cache.get(key);
  let hits = [];
  const fits = !t.own && (t.barSlots % 16 === 0 || t.barSlots === 8) && t.den <= 4;
  if (fits) {
    for (const drum in b.pat) {
      const p = b.pat[drum], step = 16 / p.length;
      for (let at = 0; at < t.barSlots; at += 16) {
        [...p].forEach((ch, i) => { const s = at + i * step; if (VEL[ch] && s < t.barSlots - 1e-6) hits.push({ slot: s, drum, vel: VEL[ch] }); });
      }
    }
  } else hits = simpleBar(b, t);
  // two sounds of the same drum at one moment: keep the louder
  hits = hits.filter((h, i) => !hits.some((x, j) => j !== i && x.drum === h.drum && Math.abs(x.slot - h.slot) < 0.01 && (x.vel > h.vel || (x.vel === h.vel && j < i))));
  if (fill) {
    const from = t.barSlots - 4, run = b.swing ? [0, 4 / 3, 8 / 3] : [0, 1, 2, 3];
    hits = hits.filter((h) => h.slot < from - 1e-6 || h.drum === K);
    const drums = b.swing ? [S, 'tomM', 'tomL'] : [S, 'tomH', 'tomM', 'tomL'];
    run.forEach((r, i) => hits.push({ slot: from + r, drum: drums[i], vel: (b.soft ? 0.5 : 0.75) + 0.06 * i }));
  }
  if (crash) hits.push({ slot: 0, drum: C, vel: b.soft ? 0.35 : 0.7 });
  hits.sort((x, y) => x.slot - y.slot);
  if (cache.size > 300) cache.clear();
  cache.set(key, hits);
  return hits;
}
/** When each drum sounds (seconds), from bar 1 at `start` until `until`: { kick: [...], snare: [...] … } */
export function drumTimes({ id, time, fills }, bpm, start, until, { fromBar = 0, bars = Infinity } = {}) {
  const t = parseTime(time) || timeInfo(time), slot = 15 / bpm, out = {};
  for (let k = 0; start + k * t.barSlots * slot < until; k++) {
    const bar = fromBar + (Number.isFinite(bars) ? k % bars : k);
    for (const h of drumBar(id, time, bar, fills)) (out[h.drum] ||= []).push(start + (k * t.barSlots + h.slot) * slot);
  }
  return out;
}
/** Drums with a thump or a ring that a microphone could take for a note (the rest is hiss). */
export const PITCHED = [K, S, R, 'tomH', 'tomM', 'tomL'];

// ---------- the drum sounds ----------
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
/** high-pass (one pole, applied twice) */
function highpass(x, sr, fc, times = 2) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
  for (let n = 0; n < times; n++) { let y = 0; for (let i = 0; i < x.length; i++) { y += k * (x[i] - y); x[i] -= y; } }
}
const METAL = [2, 3, 4.16, 5.43, 6.79, 8.21];
const metal = (t, f) => METAL.reduce((s, r) => s + Math.sign(Math.sin(2 * Math.PI * f * r * t)), 0) / 6;
function tone(o, sr, f, amp, fall) { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] += amp * Math.sin(2 * Math.PI * f * t) * Math.exp(-fall * t); } }
function sweep(o, sr, f0, f1, rate, amp, fall) {
  let ph = 0;
  for (let i = 0; i < o.length; i++) { const t = i / sr; ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-rate * t))) / sr; o[i] += amp * Math.sin(ph) * Math.exp(-fall * t); }
}
const hiss = (o, sr, amp, fall, from = 0) => { for (let i = Math.floor(from * sr); i < o.length; i++) o[i] += amp * rnd() * Math.exp(-fall * (i / sr - from)); };
const MAKE = {
  kick: [0.4, 1, (o, sr) => { sweep(o, sr, 170, 47, 38, 1, 9); hiss(o, sr, 0.35, 260); }],
  snare: [0.32, 0.8, (o, sr) => { const n = new Float32Array(o.length); hiss(n, sr, 1, 17); highpass(n, sr, 1400, 1); sweep(o, sr, 260, 188, 60, 0.6, 24); tone(o, sr, 331, 0.28, 30); for (let i = 0; i < o.length; i++) o[i] += 0.75 * n[i]; }],
  rim: [0.09, 0.55, (o, sr) => { tone(o, sr, 1720, 0.6, 70); tone(o, sr, 830, 0.4, 80); hiss(o, sr, 0.5, 300); }],
  hat: [0.1, 0.4, (o, sr) => { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = (0.6 * metal(t, 1080) + 0.6 * rnd()) * Math.exp(-48 * t); } highpass(o, sr, 6500); }],
  pedal: [0.08, 0.3, (o, sr) => { hiss(o, sr, 1, 60); highpass(o, sr, 5000); }],
  open: [0.6, 0.4, (o, sr) => { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = (0.6 * metal(t, 1080) + 0.6 * rnd()) * Math.exp(-7 * t); } highpass(o, sr, 6000); }],
  ride: [1, 0.42, (o, sr) => { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = (0.5 * metal(t, 920) + 0.35 * rnd()) * Math.exp(-5 * t) + 0.5 * rnd() * Math.exp(-120 * t); } highpass(o, sr, 5200); tone(o, sr, 4730, 0.12, 9); }],
  crash: [1.6, 0.6, (o, sr) => { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = (0.45 * metal(t, 760) + 0.8 * rnd()) * Math.exp(-2.8 * t); } highpass(o, sr, 3200); }],
  tomH: [0.4, 0.75, (o, sr) => { sweep(o, sr, 260, 178, 22, 1, 11); hiss(o, sr, 0.2, 150); }],
  tomM: [0.45, 0.8, (o, sr) => { sweep(o, sr, 205, 134, 20, 1, 10); hiss(o, sr, 0.2, 150); }],
  tomL: [0.5, 0.85, (o, sr) => { sweep(o, sr, 160, 98, 18, 1, 9); hiss(o, sr, 0.2, 150); }],
  clap: [0.25, 0.6, (o, sr) => { for (const at of [0, 0.011, 0.022]) hiss(o, sr, 0.6, at === 0.022 ? 22 : 160, at); highpass(o, sr, 900, 2); }],
  shaker: [0.09, 0.3, (o, sr) => { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = rnd() * Math.min(1, t / 0.012) * Math.exp(-45 * t); } highpass(o, sr, 5500); }],
  tamb: [0.16, 0.32, (o, sr) => { for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] = (0.7 * metal(t, 1400) + 0.5 * rnd()) * Math.exp(-26 * t); } highpass(o, sr, 6800); }],
};
export const DRUMS = Object.keys(MAKE);
const buffers = new Map();
function drumBuffer(ctx, drum) {
  const key = `${drum}:${ctx.sampleRate}`;
  if (buffers.has(key)) return buffers.get(key);
  const [secs, peak, make] = MAKE[drum], sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(sr * secs), sr), o = buf.getChannelData(0);
  seed = 1 + DRUMS.indexOf(drum) * 7919; // the same drum every time
  make(o, sr);
  let top = 0;
  for (const x of o) top = Math.max(top, Math.abs(x));
  const fade = Math.floor(sr * 0.02);
  for (let i = 0; i < o.length; i++) o[i] *= (peak / (top || 1)) * Math.min(1, (o.length - i) / fade);
  buffers.set(key, buf);
  return buf;
}
/** Make every drum of a beat ready, so the first bar doesn't stutter. */
export function prepareDrums(ctx, id) {
  const b = beatInfo(id);
  if (b) for (const d of new Set([...Object.keys(b.pat), b.keep, b.back, K, S, C, 'tomH', 'tomM', 'tomL'])) drumBuffer(ctx, d);
}
/** One hit at audio time t. */
export function playDrum(ctx, drum, t, vel = 0.7, dest = ctx.destination, volume = 1) {
  if (!MAKE[drum] || volume <= 0) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = drumBuffer(ctx, drum);
  g.gain.value = 0.5 * vel * volume;
  src.connect(g).connect(dest);
  src.start(t);
}

/** A filter that keeps only the top of the drums (stick, snare wires, cymbals): what's left can't be taken for guitar notes. */
export function thinFilter(ctx, dest) {
  let first = null, last = null;
  for (let i = 0; i < 4; i++) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 3800; f.Q.value = 0.7;
    if (last) last.connect(f); else first = f;
    last = f;
  }
  const g = ctx.createGain();
  g.gain.value = 1.6; // (there's less of it, so a little louder)
  last.connect(g).connect(dest);
  return first;
}
