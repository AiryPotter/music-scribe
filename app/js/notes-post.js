// Turns Basic Pitch's raw output into a clean list of notes.
// Shared by the background worker (real takes) and the accuracy bench (dev/bench.js).

export const MAX_GUITAR_MIDI = 88; // anything higher is a click track or noise

export const DEFAULTS = {
  onsetThresh: 0.5,     // how sure the model must be that a note starts
  frameThresh: 0.3,     // how sure it must be that a note is sounding
  minFrames: 5,         // shortest note (model frames, ~11.6 ms each)
  inferOnsets: true,
  melodia: true,
  maxFreq: 1400,
  minFreq: 60,
  // ---- clean-up (tuned on dev/bench.js; set a threshold to 0 to switch that rule off) ----
  minDur: 0.05,         // seconds
  // 1. A ringing string is often reported as a new note when another string is plucked.
  //    A real re-pluck shows a clear "note starts" signal AND the note getting stronger.
  splitGap: 3,          // frames between the end of one note and the start of the "next" at the same pitch
  splitEnergy: 1.1,     // with the audio: merge unless the note gets at least this × louder (a real re-pluck)…
  splitOnsetKeep: 0.8,  // …or the model is at least this sure a note starts (a re-strum at the same loudness)
  splitScore: 0,        // without it: merge when onset + jumpWeight × (strength after − before) is below this
  jumpWeight: 2,
  clickTimes: null,     // seconds: when each metronome beat reached the mic (a recording made with the click)
  clickStrict: 2,       // at a beat, a 'new' note must get this × more louder than splitEnergy asks…
  clickOnsetKeep: 0.97, // …or the model must be this sure (a click makes ringing strings look plucked again)
  strumCount: 0,        // (off: it didn't help on the bench) this many other strings plucked at once = never merge
  strumWindow: 6,       // frames (~70 ms) that count as "the same moment"
  // 2. Faint notes the model wasn't sure had a start (string noise, sympathetic ringing).
  weakAmp: 0.42,        // drop when quieter than this…
  weakOnset: 0.45,      // …and the "note starts" signal is below this
  // 3. Overtone ghosts: a quiet, shorter note an octave / twelfth / two octaves above a real one.
  ghostAmp: 0.45,       // quieter than this × the real note…
  ghostAbs: 1,          // …and quieter than this outright
  ghostLen: 2,          // …while the real note lasts at least this × longer
  ghostWindow: 0.06,    // seconds between their starts
};

const OVERTONES = [12, 19, 24, 28, 31]; // octave, octave+5th, 2 octaves, +major 3rd, +5th
const PITCH0 = 21; // Basic Pitch's lowest note (A0)

const MODEL_RATE = 22050;

/** Sound energy at a note's pitch (fundamental + octave) between two times, by Goertzel filters. */
function pitchEnergy(audio, t0, t1, midi) {
  const a = Math.max(0, Math.floor(t0 * MODEL_RATE)), b = Math.min(audio.length, Math.floor(t1 * MODEL_RATE));
  const n = b - a;
  if (n < 64) return 0;
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  let e = 0;
  for (const f of [f0, 2 * f0]) {
    if (f > MODEL_RATE / 2 - 200) continue;
    const c = 2 * Math.cos((2 * Math.PI * f) / MODEL_RATE);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const s = audio[a + i] * hann + c * s1 - s2;
      s2 = s1; s1 = s;
    }
    e += s1 * s1 + s2 * s2 - c * s1 * s2;
  }
  return e / (n * n);
}

/**
 * How much louder a note is just after time t than just before it.
 * A string that is plucked again jumps well above 1; one that is only ringing on stays at or below 1.
 */
export function energyRise(audio, t, midi) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const win = Math.max(0.06, 6 / f0); // long enough to tell low strings apart
  const before = pitchEnergy(audio, t - 0.012 - win, t - 0.012, midi);
  const after = pitchEnergy(audio, t + 0.02, t + 0.02 + win, midi); // skip the pluck's click
  return after / (before + 1e-9);
}

function peak(rows, f, pitch, back, ahead) {
  let m = 0;
  for (let k = Math.max(0, f - back); k <= Math.min(rows.length - 1, f + ahead); k++) m = Math.max(m, rows[k][pitch]);
  return m;
}
function mean(rows, a, b, pitch) {
  let s = 0, n = 0;
  for (let k = Math.max(0, a); k <= Math.min(rows.length - 1, b); k++) { s += rows[k][pitch]; n++; }
  return n ? s / n : 0;
}

/**
 * Works on the model's own frames (exact timing): joins false splits of a ringing note
 * and drops faint notes with no clear start. events = [{ startFrame, durationFrames, pitchMidi, amplitude }].
 */
export function tidyEvents(events, raw, P, frameTime = null) {
  const sorted = [...events].sort((a, b) => a.startFrame - b.startFrame);
  const splitOn = P.splitScore > 0 || P.splitEnergy > 0;

  // pass 1: for every note, how sure are we that a string was really plucked there?
  const lastRaw = new Map(); // pitch → previous event at that pitch
  const info = sorted.map((ev) => {
    const p = ev.pitchMidi - PITCH0;
    const on = peak(raw.onsets, ev.startFrame, p, 2, 2);
    const prev = lastRaw.get(ev.pitchMidi);
    lastRaw.set(ev.pitchMidi, ev);
    const contiguous = !!prev && ev.startFrame - (prev.startFrame + prev.durationFrames) <= P.splitGap;
    let plucked = true; // a note that follows silence at its pitch is a new pluck
    if (splitOn && contiguous) {
      if (P.splitEnergy > 0 && raw.audio && frameTime) {
        const t = frameTime(ev.startFrame);
        const atBeat = !!P.clickTimes && P.clickTimes.some((c) => t >= c - 0.04 && t <= c + 0.09);
        plucked = energyRise(raw.audio, t, ev.pitchMidi) >= P.splitEnergy * (atBeat ? P.clickStrict : 1)
          || (P.splitOnsetKeep > 0 && on >= (atBeat ? P.clickOnsetKeep : P.splitOnsetKeep));
      } else {
        const jump = mean(raw.frames, ev.startFrame + 1, ev.startFrame + 6, p) - mean(raw.frames, ev.startFrame - 7, ev.startFrame - 2, p);
        plucked = !(P.splitScore > 0 && on + P.jumpWeight * jump < P.splitScore);
      }
    }
    return { on, contiguous, plucked };
  });

  // a strum: when several strings are struck together, a note that carries on at the same pitch
  // was almost certainly struck again too (a re-strum at the same loudness shows no jump in energy)
  if (P.strumCount > 0) {
    const sure = info.map((x) => x.plucked);
    sorted.forEach((ev, i) => {
      if (info[i].plucked) return;
      let n = 0;
      for (let j = i - 1; j >= 0 && ev.startFrame - sorted[j].startFrame <= P.strumWindow; j--) if (sure[j]) n++;
      for (let j = i + 1; j < sorted.length && sorted[j].startFrame - ev.startFrame <= P.strumWindow; j++) if (sure[j]) n++;
      if (n >= P.strumCount) info[i].plucked = true;
    });
  }

  // pass 2: join false splits, drop faint notes with no clear start
  const lastAt = new Map(); // pitch → the note still "open" at that pitch
  const out = [];
  sorted.forEach((ev, i) => {
    const prev = lastAt.get(ev.pitchMidi);
    if (prev && info[i].contiguous && !info[i].plucked) { // the same note, still ringing
      const total = prev.durationFrames + ev.durationFrames;
      prev.amplitude = (prev.amplitude * prev.durationFrames + ev.amplitude * ev.durationFrames) / total;
      prev.durationFrames = ev.startFrame + ev.durationFrames - prev.startFrame;
      return;
    }
    if (P.weakAmp > 0 && ev.amplitude < P.weakAmp && info[i].on < P.weakOnset) return;
    const kept = { ...ev, onset: info[i].on };
    out.push(kept);
    lastAt.set(ev.pitchMidi, kept);
  });
  return out;
}

/**
 * Clean up the timed notes:
 *  - drop faint, short "ghost" notes that are only overtones of a louder note
 *    (real octave doublings in a chord are kept: they're nearly as loud)
 *  - drop a short blip right before the same note starts properly
 */
export function cleanNotes(notes, P = DEFAULTS) {
  return notes.filter((n) => {
    const dur = n.end - n.start;
    if (dur < P.minDur) return false;
    const ghost = n.amp < P.ghostAbs && notes.some((p) => p !== n
      && OVERTONES.includes(n.midi - p.midi)
      && Math.abs(p.start - n.start) < P.ghostWindow
      && (p.end - p.start) > dur * P.ghostLen
      && n.amp < p.amp * P.ghostAmp);
    if (ghost) return false;
    const preEcho = dur < 0.2 && notes.some((q) => q !== n
      && q.midi === n.midi
      && q.start > n.start + 0.04 && q.start - n.start < 0.25
      && (q.end - q.start) > dur);
    return !preEcho;
  });
}

/** raw = { frames, onsets, contours, audio? (22,050 Hz, in memory only) } from the model; bp = the Basic Pitch library. */
export function makeNotes(bp, raw, params = {}) {
  const P = { ...DEFAULTS, ...params };
  let events = bp.outputToNotesPoly(raw.frames, raw.onsets, P.onsetThresh, P.frameThresh, P.minFrames, P.inferOnsets, P.maxFreq, P.minFreq, P.melodia);
  const frameTime = (f) => bp.noteFramesToTime([{ startFrame: f, durationFrames: 1, pitchMidi: 60, amplitude: 0 }])[0].startTimeSeconds;
  events = tidyEvents(events, raw, P, frameTime);
  const timed = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(raw.contours, events));
  const sameOrder = timed.length === events.length; // the library maps note for note, so the attack confidence lines up
  const notes = timed
    .map((n, i) => {
      const note = { midi: n.pitchMidi, start: n.startTimeSeconds, end: n.startTimeSeconds + n.durationSeconds, amp: n.amplitude };
      const on = sameOrder && events[i].pitchMidi === n.pitchMidi ? events[i].onset : undefined;
      if (on != null) note.onset = Math.round(on * 100) / 100; // how sure the model is a string was plucked here
      return note;
    })
    .filter((n) => n.midi >= 28 && n.midi <= MAX_GUITAR_MIDI) // the page trims to the tuning's range
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  return cleanNotes(notes, P);
}

/**
 * Remove notes that are really the other layers playing back through the speakers while a new
 * layer was recorded. played: [{ midi, t, dur }] (when each played note reached the mic, seconds
 * from the start of the recording). A note at the same pitch (or an octave/twelfth above it),
 * starting with a played note and not lasting longer than it, is the leak. A very loud note is
 * kept: that's the guitar being played right into the mic. Only done when the leak is real (a fair
 * share of the played notes came back): with headphones, a match is just the same note played.
 */
export function removePlaybackNotes(notes, played, { before = 0.05, after = 0.12, loud = 0.8, share = 0.3 } = {}) {
  if (!played?.length || !notes.length) return notes;
  const end = Math.max(...notes.map((n) => n.end));
  const heard = played.filter((p) => p.t < end); // what played while the mic was listening
  const leak = (n) => heard.some((p) => n.start >= p.t - before && n.start <= p.t + after
    && [0, 12, 19].includes(n.midi - p.midi) && n.end - n.start <= p.dur + 0.3 && (n.amp ?? 0.6) < loud);
  const hits = notes.filter(leak);
  // with headphones almost nothing comes back: then a match is just me playing the same note
  if (hits.length < Math.max(3, share * heard.length)) return notes;
  return notes.filter((n) => !hits.includes(n));
}

/**
 * Remove notes that are really the metronome leaking into the mic.
 * clickTimes: when each tick reached the mic (seconds from the start of the recording).
 * A pitch that keeps appearing right on the ticks, briefly, is the click (a speaker's thump,
 * a ringing desk…), so those short notes go. Real notes on the beat vary in pitch and ring
 * longer, so they stay, even a bass note repeated on every beat.
 */
export function removeClickNotes(notes, clickTimes, { before = 0.04, after = 0.09, share = 0.25, maxDur = 0.25 } = {}) {
  if (!clickTimes?.length || !notes.length) return notes;
  const sorted = [...clickTimes].sort((a, b) => a - b);
  const nearest = (t) => { // index of the tick this note starts on, or -1
    let lo = 0, hi = sorted.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < t) lo = mid + 1; else hi = mid; }
    for (const i of [lo - 1, lo]) if (i >= 0 && i < sorted.length && t >= sorted[i] - before && t <= sorted[i] + after) return i;
    return -1;
  };
  const onTick = new Map(); // midi → { ticks: Set, durs: [] }
  const tickOf = notes.map((n) => nearest(n.start));
  notes.forEach((n, i) => {
    if (tickOf[i] < 0) return;
    const g = onTick.get(n.midi) || { ticks: new Set(), durs: [] };
    g.ticks.add(tickOf[i]);
    g.durs.push(n.end - n.start);
    onTick.set(n.midi, g);
  });
  const clicky = new Set();
  const need = Math.max(3, Math.ceil(share * sorted.length));
  for (const [midi, g] of onTick) {
    const d = [...g.durs].sort((a, b) => a - b);
    if (g.ticks.size >= need && d[d.length >> 1] < maxDur * 0.8) clicky.add(midi);
  }
  return notes.filter((n, i) => !(tickOf[i] >= 0 && clicky.has(n.midi) && n.end - n.start < maxDur));
}
