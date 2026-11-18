// Accurate pass: Spotify's Basic Pitch (polyphonic, handles chords), running on-device
// in a background worker (transcribe-worker.js) so the page never freezes.

const MODEL_URL = new URL('../model/model.json', import.meta.url).href;
const WORKER_URL = new URL('./transcribe-worker.js', import.meta.url);
const MODEL_RATE = 22050;
const FORCE_CPU = new URLSearchParams(location.search).has('cpu'); // testing: ?cpu forces slow mode

let worker = null;
let current = null; // { id, resolve, reject, onProgress }
let liveStream = null; // a take being written out while it's played (see startStream)
let nextId = 1;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (!current || m.id !== current.id) return;
    if (m.type === 'progress') current.onProgress(m.p, m.mode);
    else if (m.type === 'done') { const c = current; current = null; c.resolve(m.raw || m.notes); }
    else if (m.type === 'error') { const c = current; current = null; c.reject(new Error(m.message)); }
  };
  worker.onerror = (e) => {
    const c = current; current = null;
    worker?.terminate(); worker = null;
    c?.reject(new Error(e.message || 'The transcriber stopped unexpectedly.'));
  };
  return worker;
}

/** Start downloading the model in the background so the first transcription is quicker. */
export function preloadTranscriber() {
  try { getWorker().postMessage({ type: 'preload', modelUrl: MODEL_URL }); } catch { /* no workers: run() will say */ }
}

/** Stop a transcription that's running (e.g. the person pressed Clear or Begin). */
export function cancelTranscription() {
  if (!current && !liveStream) return;
  const c = current; current = null;
  if (liveStream) { liveStream.dead = true; liveStream = null; }
  worker?.terminate(); worker = null; // the only way to stop TensorFlow mid-run
  if (!c) return;
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  c.reject(err);
}

async function resample(samples, fromRate) {
  if (fromRate === MODEL_RATE) return samples.slice();
  const len = Math.max(1, Math.ceil((samples.length * MODEL_RATE) / fromRate));
  const oc = new OfflineAudioContext(1, len, MODEL_RATE);
  const buf = oc.createBuffer(1, samples.length, fromRate);
  buf.copyToChannel(samples, 0);
  const src = oc.createBufferSource();
  src.buffer = buf;
  src.connect(oc.destination);
  src.start();
  const out = await oc.startRendering();
  return out.getChannelData(0).slice();
}

/**
 * Transcribe a take. Returns [{ midi, start, end, amp }] with times in seconds from the start of `samples`.
 * onProgress(0..1, mode) is called as it works; mode is 'fast' (graphics chip) or 'slow' (CPU).
 */
export async function transcribe(samples, sampleRate, onProgress = () => {}, { raw = false, clickTimes = null } = {}) {
  cancelTranscription();
  onProgress(0, 'fast');
  const audio = await resample(samples, sampleRate);
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    current = { id, resolve, reject, onProgress };
    w.postMessage({ type: 'run', id, audio, modelUrl: MODEL_URL, forceCpu: FORCE_CPU, raw, clickTimes }, [audio.buffer]);
  });
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * Write the take out WHILE it's being played, so Cease only has the last few seconds left to do.
 * feed(samples) as the recording grows (any rate; resampled here in pieces that join seamlessly);
 * finish(allSamples, onProgress, opts) → the same notes transcribe() would give. The audio only
 * ever lives in memory, and is dropped when the notes are written.
 */
export function startStream(sampleRate, { hop } = {}) {
  cancelTranscription();
  const w = getWorker();
  const id = nextId++;
  w.postMessage({ type: 'stream-start', id, modelUrl: MODEL_URL, forceCpu: FORCE_CPU, hop });
  const g = gcd(Math.round(sampleRate), MODEL_RATE);
  const step = Math.round(sampleRate) / g, outStep = MODEL_RATE / g; // input/output samples that line up exactly
  const pad = step * Math.ceil((0.05 * sampleRate) / step);         // context either side of a piece
  const st = { id, dead: false, fed: 0, sent: 0, bufStart: 0, buf: new Float32Array(0), chain: Promise.resolve() };
  liveStream = st;

  const send = async (final) => {
    if (st.dead) return;
    const have = st.bufStart + st.buf.length;
    const end = final ? have : Math.floor((have - pad) / step) * step;
    if (end <= st.sent) return;
    const r0 = Math.max(0, st.sent - pad), r1 = final ? have : end + pad;
    const out = await resample(st.buf.subarray(r0 - st.bufStart, r1 - st.bufStart), sampleRate);
    if (st.dead) return;
    const from = ((st.sent - r0) / step) * outStep;
    const piece = final ? out.slice(from) : out.slice(from, from + ((end - st.sent) / step) * outStep);
    st.sent = end;
    const keep = Math.max(st.bufStart, st.sent - pad); // drop what's no longer needed
    st.buf = st.buf.slice(keep - st.bufStart);
    st.bufStart = keep;
    worker?.postMessage({ type: 'stream-audio', id, audio: piece }, [piece.buffer]);
  };

  return {
    feed(samples) {
      if (st.dead || !samples?.length) return;
      const grown = new Float32Array(st.buf.length + samples.length);
      grown.set(st.buf); grown.set(samples, st.buf.length);
      st.buf = grown;
      st.fed += samples.length;
      st.chain = st.chain.then(() => send(false)).catch(() => { st.broken = true; });
    },
    /** allSamples: the whole take (whatever wasn't fed yet is fed now). Falls back to one long pass if anything went wrong. */
    async finish(allSamples, onProgress = () => {}, { raw = false, clickTimes = null } = {}) {
      if (st.dead) { const err = new Error('Cancelled'); err.name = 'AbortError'; throw err; }
      if (allSamples.length > st.fed) this.feed(allSamples.subarray(st.fed));
      onProgress(0, 'fast');
      await st.chain;
      if (!st.broken) await send(true).catch(() => { st.broken = true; });
      if (st.dead) { const err = new Error('Cancelled'); err.name = 'AbortError'; throw err; }
      if (st.broken || !worker) { liveStream = null; return transcribe(allSamples, sampleRate, onProgress, { raw, clickTimes }); }
      try {
        return await new Promise((resolve, reject) => {
          current = { id, resolve, reject, onProgress };
          worker.postMessage({ type: 'stream-end', id, clickTimes, raw });
        });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        liveStream = null;
        return transcribe(allSamples, sampleRate, onProgress, { raw, clickTimes }); // one long pass instead
      } finally {
        if (liveStream === st) liveStream = null;
      }
    },
    cancel() { if (liveStream === st) cancelTranscription(); else st.dead = true; },
  };
}
