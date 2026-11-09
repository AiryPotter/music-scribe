// YIN pitch detection (de Cheveigné & Kawahara, 2002), tuned for guitar.
// Returns { freq, clarity } where clarity is 0..1 (1 = very clean periodic tone).

let scratch = new Float32Array(0);

export function detectPitch(buf, sampleRate, { minFreq = 65, maxFreq = 1400, threshold = 0.15 } = {}) {
  const half = buf.length >> 1;
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxTau = Math.min(half - 2, Math.ceil(sampleRate / minFreq));
  if (scratch.length < maxTau + 2) scratch = new Float32Array(maxTau + 2);
  const d = scratch;

  // 1. Difference function
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const x = buf[i] - buf[i + tau];
      sum += x * x;
    }
    d[tau] = sum;
  }

  // 2. Cumulative mean normalized difference
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 3. First dip under the threshold (then walk to its bottom)
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  // Fallback: global minimum, if it's reasonably periodic
  if (tau < 0) {
    let best = minTau;
    for (let t = minTau + 1; t <= maxTau; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.35) return { freq: 0, clarity: Math.max(0, 1 - d[best]) };
    tau = best;
  }

  // 4. Parabolic interpolation for sub-sample accuracy
  const a = d[tau - 1], b = d[tau], c = d[tau + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const period = tau + (Math.abs(shift) < 1 ? shift : 0);

  return { freq: sampleRate / period, clarity: Math.max(0, Math.min(1, 1 - b)) };
}

export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}
