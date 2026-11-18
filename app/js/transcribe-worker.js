import { makeNotes } from './notes-post.js';

// Runs Basic Pitch off the main thread, so the page never freezes,
// even when the slow CPU mode is needed (no usable graphics chip).

const BP_URL = 'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/+esm';
const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.19.0/+esm'; // the copy Basic Pitch uses
const MODEL_RATE = 22050;

let bpPromise = null;
let model = null;
let modelUrl = '';

async function lib() {
  bpPromise ||= import(BP_URL);
  const bp = await bpPromise;
  model ||= new bp.BasicPitch(modelUrl);
  return bp;
}

async function evaluate(audio, onProgress) {
  const frames = [], onsets = [], contours = [];
  await model.evaluateModel(
    audio,
    (f, o, c) => { for (const x of f) frames.push(x); for (const x of o) onsets.push(x); for (const x of c) contours.push(x); },
    (p) => onProgress(Math.min(0.99, p)),
  );
  return { frames, onsets, contours };
}

// Basic Pitch's output frames are 254.68 samples apart, not 256: its 2 s windows step by 36,164
// samples and keep 142 frames each (its own frame→time conversion allows for this). So a slice is
// cut and placed on that same grid: frame g of a whole-take pass sits at sample g × FRAME, and a
// slice that starts at sample a has that moment at its frame (g × FRAME − a) / FRAME.
const FRAME = 36164 / 142;
/** Frames g0…g0+count−1 of the whole-take grid, from model output for audio that starts at sample a. */
function regrid(out, a, g0, count, into) {
  const n = out.frames.length;
  for (let g = g0; g < g0 + count; g++) {
    const k = Math.max(0, Math.min(n - 1, Math.round((g * FRAME - a) / FRAME)));
    into.frames.push(out.frames[k]); into.onsets.push(out.onsets[k]); into.contours.push(out.contours[k]);
  }
}

async function useCpu() {
  const tf = await import(TF_URL);
  await tf.setBackend('cpu');
  await tf.ready();
}

/**
 * Graphics chip first. TensorFlow's WebGL backend fails to compile a shader for some
 * take lengths, so retry with a little silence added; anything else → slow CPU mode.
 */
async function runModel(audio, forceCpu, report) {
  if (!forceCpu) {
    for (const padSec of [0, 2, 4, 6]) {
      let input = audio;
      if (padSec) { input = new Float32Array(audio.length + padSec * MODEL_RATE); input.set(audio); }
      try {
        return await evaluate(input, (p) => report(p, 'fast'));
      } catch (err) {
        if (!/shader|texture/i.test(String(err?.message))) break;
      }
    }
  }
  await useCpu();
  report(0, 'slow');
  return evaluate(audio, (p) => report(p, 'slow'));
}

// ---------- writing out while you play ----------
// The take arrives in pieces as you play (in memory only). It's run through the model in slices
// of ~4 s, each with 1 s of audio either side so the edges come out exactly as in one long pass;
// only the slice's own frames are kept. After Cease just the last few seconds are left to do.
const HOP = 256;                 // samples per model frame
const SEG = 344;                 // frames per slice (~4 s)
const MARGIN = 86;               // frames of context either side (~1 s)
let stream = null;               // { id, forceCpu, audio, len, done (frames kept), frames, onsets, contours, queue }

function streamAppend(chunk) {
  const st = stream;
  if (st.len + chunk.length > st.audio.length) {
    const grown = new Float32Array(Math.max(st.audio.length * 2, st.len + chunk.length));
    grown.set(st.audio.subarray(0, st.len));
    st.audio = grown;
  }
  st.audio.set(chunk, st.len);
  st.len += chunk.length;
}

/** Run every slice that's ready (final: everything that's left). */
async function streamWork(st, final, report = () => {}) {
  const totalFrames = Math.max(0, Math.ceil(st.len / HOP) - 1); // what one long pass would give
  while (stream === st) {
    const s0 = Math.round(st.done * FRAME), s1 = Math.round((st.done + SEG) * FRAME), m = Math.round(MARGIN * FRAME);
    const ready = st.len >= s1 + m;
    if (!final && !ready) break;
    if (final && st.done >= totalFrames) break;
    const a = Math.max(0, s0 - m);
    const b = ready ? s1 + m : st.len;
    const out = await runModel(st.audio.slice(a, b), st.forceCpu, (p, mode) => { st.mode = mode; report(p); });
    if (stream !== st) return;
    const count = ready ? SEG : Math.max(0, totalFrames - st.done);
    regrid(out, a, st.done, count, st);
    st.done += count;
    if (!ready) break;
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  modelUrl = msg.modelUrl || modelUrl;
  if (msg.type === 'stream-start') {
    stream = { id: msg.id, forceCpu: !!msg.forceCpu, audio: new Float32Array(MODEL_RATE * 60), len: 0, done: 0, frames: [], onsets: [], contours: [], queue: Promise.resolve() };
    stream.queue = stream.queue.then(() => lib()).catch(() => {});
    return;
  }
  if (msg.type === 'stream-audio') {
    const st = stream;
    if (!st || st.id !== msg.id) return;
    streamAppend(msg.audio);
    st.queue = st.queue.then(() => streamWork(st, false)).catch((err) => { st.failed = err; });
    return;
  }
  if (msg.type === 'stream-end') {
    const st = stream;
    if (!st || st.id !== msg.id) { self.postMessage({ type: 'error', id: msg.id, message: 'No take was being written out.' }); return; }
    if (msg.audio) streamAppend(msg.audio);
    const left0 = Math.max(1, Math.ceil(st.len / HOP) - 1 - st.done); // frames still to do when Cease was pressed
    st.queue = st.queue.then(async () => {
      if (st.failed) throw st.failed;
      const bp = await lib();
      const startDone = st.done;
      await streamWork(st, true, (p) => {
        const left = Math.max(1, Math.ceil(st.len / HOP) - 1 - startDone);
        self.postMessage({ type: 'progress', id: st.id, p: Math.min(0.99, ((st.done - startDone) + p * Math.min(SEG, left)) / Math.max(left, left0)), mode: st.mode || 'fast' });
      });
      if (stream !== st) return;
      const raw = { frames: st.frames, onsets: st.onsets, contours: st.contours, audio: st.audio.slice(0, st.len) };
      stream = null; // the audio is dropped here, with the worker's copy
      if (msg.raw) self.postMessage({ type: 'done', id: st.id, raw });
      else self.postMessage({ type: 'done', id: st.id, notes: makeNotes(bp, raw, msg.clickTimes ? { clickTimes: msg.clickTimes } : {}) });
    }).catch((err) => {
      if (stream === st) stream = null;
      self.postMessage({ type: 'error', id: st.id, message: String(err?.message || err) });
    });
    return;
  }
  if (msg.type === 'preload') {
    try { await lib(); await model.model; } catch { /* first real run will report it */ }
    return;
  }
  if (msg.type !== 'run') return;
  const { id } = msg;
  try {
    const bp = await lib();
    const report = (p, mode) => self.postMessage({ type: 'progress', id, p, mode });
    const { frames, onsets, contours } = await runModel(msg.audio, msg.forceCpu, report); // its timing is right as it is
    const raw = { frames, onsets, contours, audio: msg.audio }; // the audio is only read here, then dropped with the worker's message
    if (msg.raw) self.postMessage({ type: 'done', id, raw }); // accuracy bench: tune the clean-up without re-running the model
    else self.postMessage({ type: 'done', id, notes: makeNotes(bp, raw, msg.clickTimes ? { clickTimes: msg.clickTimes } : {}) });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
