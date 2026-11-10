// Accurate pass: Spotify's Basic Pitch (polyphonic, handles chords), running on-device.

const BP_URL = 'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/+esm';
const TF_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.19.0/+esm'; // the copy Basic Pitch uses
const MODEL_URL = new URL('../model/model.json', import.meta.url).href;
const MODEL_RATE = 22050;
const MAX_GUITAR_MIDI = 88; // anything higher is a click track or noise

let libPromise = null;
let model = null;

/** Start downloading the model in the background so the first transcription is quicker. */
export function preloadTranscriber() {
  libPromise ||= import(BP_URL);
  return libPromise.then((bp) => { model ||= new bp.BasicPitch(MODEL_URL); return model.model; }).catch(() => {});
}

async function resample(samples, fromRate) {
  if (fromRate === MODEL_RATE) return samples;
  const len = Math.max(1, Math.ceil((samples.length * MODEL_RATE) / fromRate));
  const oc = new OfflineAudioContext(1, len, MODEL_RATE);
  const buf = oc.createBuffer(1, samples.length, fromRate);
  buf.copyToChannel(samples, 0);
  const src = oc.createBufferSource();
  src.buffer = buf;
  src.connect(oc.destination);
  src.start();
  const out = await oc.startRendering();
  return out.getChannelData(0);
}

/**
 * Clean up the raw model output:
 *  - drop faint, short "ghost" notes that are only overtones of a louder note
 *    (real octave doublings in a chord are kept: they're nearly as loud)
 *  - drop a short blip right before the same note starts properly
 */
function cleanNotes(notes) {
  const OVERTONES = [12, 19, 24, 28];
  return notes.filter((n) => {
    const dur = n.end - n.start;
    if (dur < 0.05) return false;
    const ghost = notes.some((p) => p !== n
      && OVERTONES.includes(n.midi - p.midi)
      && Math.abs(p.start - n.start) < 0.06
      && (p.end - p.start) > dur * 2
      && n.amp < p.amp * 0.45);
    if (ghost) return false;
    const preEcho = dur < 0.2 && notes.some((q) => q !== n
      && q.midi === n.midi
      && q.start > n.start + 0.04 && q.start - n.start < 0.25
      && (q.end - q.start) > dur);
    return !preEcho;
  });
}

async function evaluate(audio, onProgress) {
  const frames = [], onsets = [], contours = [];
  await model.evaluateModel(
    audio,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    (p) => onProgress(Math.min(0.99, p)),
  );
  return { frames, onsets, contours };
}

/**
 * TensorFlow's WebGL backend fails to compile a shader for some take lengths
 * (e.g. ~26–27.7 s). Adding a little silence at the end changes the length without
 * changing the notes, so retry that way; as a last resort run on the CPU (slower).
 */
async function runModel(audio, onProgress) {
  let lastErr = null;
  for (const padSec of [0, 2, 4, 6]) {
    let input = audio;
    if (padSec) {
      input = new Float32Array(audio.length + padSec * MODEL_RATE);
      input.set(audio);
    }
    try {
      return await evaluate(input, onProgress);
    } catch (err) {
      lastErr = err;
      if (!/shader|webgl|texture/i.test(String(err?.message))) throw err;
    }
  }
  try {
    const tf = await import(TF_URL);
    const prev = tf.getBackend();
    await tf.setBackend('cpu');
    try { return await evaluate(audio, onProgress); } finally { await tf.setBackend(prev).catch(() => {}); }
  } catch {
    throw lastErr;
  }
}

/**
 * Transcribe a take. Returns [{ midi, start, end, amp }] with times in seconds from the start of `samples`.
 * onProgress(0..1) is called as it works.
 */
export async function transcribe(samples, sampleRate, onProgress = () => {}) {
  libPromise ||= import(BP_URL);
  const bp = await libPromise;
  model ||= new bp.BasicPitch(MODEL_URL);

  onProgress(0);
  const audio = await resample(samples, sampleRate);
  const { frames, onsets, contours } = await runModel(audio, onProgress);
  // onset threshold, frame threshold, min note length (frames), infer onsets, max/min freq (Hz)
  const events = bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 5, true, 1400, 60);
  const timed = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, events));
  const notes = timed
    .map((n) => ({
      midi: n.pitchMidi,
      start: n.startTimeSeconds,
      end: n.startTimeSeconds + n.durationSeconds,
      amp: n.amplitude,
    }))
    .filter((n) => n.midi >= 28 && n.midi <= MAX_GUITAR_MIDI) // the caller trims to the tuning's range
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  onProgress(1);
  return cleanNotes(notes);
}
