// A plucked-string sound (Karplus–Strong) so tapped notes sound like a guitar, not a beep.
// Each pitch is synthesised once into an AudioBuffer and cached.

const cache = new Map(); // `${sampleRate}:${midi}` → AudioBuffer

function pluckBuffer(ctx, midi) {
  const key = `${ctx.sampleRate}:${midi}`;
  if (cache.has(key)) return cache.get(key);
  const sr = ctx.sampleRate;
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  const secs = midi < 52 ? 2.2 : 1.6;
  const len = Math.floor(sr * secs);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);
  // loop delay = N (whole samples) + d (fraction, by interpolation) + 0.5 (the averaging filter) = one period
  const D = sr / freq - 0.5;
  const N = Math.max(2, Math.floor(D));
  const d = D - N;
  const size = N + 2;
  const line = new Float32Array(size);
  // the "pluck": a short burst of noise, softened so it isn't harsh
  let prev = 0;
  for (let i = 0; i < size; i++) {
    prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5;
    line[i] = prev;
  }
  // low strings ring longer than high ones
  const decay = Math.min(0.9985, 0.994 + (64 - midi) * 0.00012);
  let w = N + 1;      // write position (circular)
  let xPrev = 0;
  for (let i = 0; i < len; i++) {
    const a = line[(w - N + size) % size];       // delayed by N
    const b = line[(w - N - 1 + size) % size];   // delayed by N + 1
    const x = a + d * (b - a);                   // delayed by N + d
    out[i] = x;
    line[w] = decay * 0.5 * (x + xPrev);         // averaging adds half a sample
    xPrev = x;
    w = (w + 1) % size;
  }
  // gentle fade at the end so it never clicks
  const fade = Math.floor(sr * 0.08);
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  cache.set(key, buf);
  return buf;
}

/**
 * Play one note or a strummed chord (lowest string first).
 * midis: [midi]; at: AudioContext time; returns the time the sound has mostly died away.
 */
export function playPluck(ctx, midis, { at = ctx.currentTime + 0.03, strum = 0.028, volume = 0.5 } = {}) {
  const sorted = [...midis].sort((a, b) => a - b);
  const level = volume / Math.sqrt(Math.max(1, sorted.length));
  let end = at;
  sorted.forEach((m, k) => {
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(ctx, m);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    g.gain.value = level;
    src.connect(lp).connect(g).connect(ctx.destination);
    const t = at + k * strum;
    src.start(t);
    end = Math.max(end, t + src.buffer.duration);
  });
  return end;
}
