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

self.onmessage = async (e) => {
  const msg = e.data;
  modelUrl = msg.modelUrl || modelUrl;
  if (msg.type === 'preload') {
    try { await lib(); await model.model; } catch { /* first real run will report it */ }
    return;
  }
  if (msg.type !== 'run') return;
  const { id } = msg;
  try {
    const bp = await lib();
    const report = (p, mode) => self.postMessage({ type: 'progress', id, p, mode });
    const { frames, onsets, contours } = await runModel(msg.audio, msg.forceCpu, report);
    const raw = { frames, onsets, contours, audio: msg.audio }; // the audio is only read here, then dropped with the worker's message
    if (msg.raw) self.postMessage({ type: 'done', id, raw }); // accuracy bench: tune the clean-up without re-running the model
    else self.postMessage({ type: 'done', id, notes: makeNotes(bp, raw, msg.clickTimes ? { clickTimes: msg.clickTimes } : {}) });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
