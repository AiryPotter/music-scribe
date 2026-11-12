// Accurate pass: Spotify's Basic Pitch (polyphonic, handles chords), running on-device
// in a background worker (transcribe-worker.js) so the page never freezes.

const MODEL_URL = new URL('../model/model.json', import.meta.url).href;
const WORKER_URL = new URL('./transcribe-worker.js', import.meta.url);
const MODEL_RATE = 22050;
const FORCE_CPU = new URLSearchParams(location.search).has('cpu'); // testing: ?cpu forces slow mode

let worker = null;
let current = null; // { id, resolve, reject, onProgress }
let nextId = 1;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (!current || m.id !== current.id) return;
    if (m.type === 'progress') current.onProgress(m.p, m.mode);
    else if (m.type === 'done') { const c = current; current = null; c.resolve(m.notes); }
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
  if (!current) return;
  const c = current; current = null;
  worker?.terminate(); worker = null; // the only way to stop TensorFlow mid-run
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
export async function transcribe(samples, sampleRate, onProgress = () => {}) {
  cancelTranscription();
  onProgress(0, 'fast');
  const audio = await resample(samples, sampleRate);
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    current = { id, resolve, reject, onProgress };
    w.postMessage({ type: 'run', id, audio, modelUrl: MODEL_URL, forceCpu: FORCE_CPU }, [audio.buffer]);
  });
}
