// Turns a stream of (time, loudness, pitch) frames into discrete notes.
// A note starts once a pitch is steady for a few frames, and ends when the
// pitch changes, the string is re-plucked (loudness jump), or it goes quiet.

const STABLE_FRAMES = 3;     // ~50 ms at 60 fps before we trust a pitch
const RELEASE_SEC = 0.12;    // silence this long ends a note
const RESTRIKE_GAP = 0.1;    // min note length before a re-pluck counts
const ONSET_RATIO = 1.8;     // loudness jump vs. recent average = a new pluck
const PLUCK_SETTLE = 0.25;   // how long to wait for the pitch to settle after a pluck
const MIN_CLARITY = 0.8;

export function midiFromFreq(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export class NoteTracker {
  constructor({ onStart = () => {}, onEnd = () => {}, onLive = () => {} } = {}) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onLive = onLive;
    this.reset();
  }

  reset() {
    this.cur = null;
    this.cand = null;
    this.candCount = 0;
    this.candStart = 0;
    this.lastVoiced = -1;
    this.avg = 0;
    this.pending = null;
    this.onsetArmed = true;
  }

  /** Feed one analysis frame. t in seconds. */
  update(t, level, freq, clarity, gate) {
    // Onset (pluck/strum) detection from a jump in loudness. Edge-triggered:
    // fires once, then re-arms only after the level stops climbing.
    const rising = level > gate * 1.5 && level > this.avg * ONSET_RATIO + 1e-4;
    if (rising && this.onsetArmed) {
      this.onsetArmed = false;
      this.pending = t;          // a pluck happened; decide what it was once the pitch settles
      this.cand = null;          // measure stability only on frames after the pluck
      this.candCount = 0;
      if (this.debug) this.debug.push(['onset', +t.toFixed(3), +level.toFixed(4), +this.avg.toFixed(4)]);
    }
    else if (!rising && level < this.avg * 1.15) this.onsetArmed = true;
    this.avg = this.avg * 0.85 + level * 0.15;

    const voiced = level > gate && clarity >= MIN_CLARITY && freq >= 70 && freq <= 1400;
    if (!voiced) {
      this.onLive({ voiced: false, level });
      if (this.cur && t - this.lastVoiced > RELEASE_SEC) this._end(this.lastVoiced + 0.02);
      this.cand = null;
      this.candCount = 0;
      return;
    }

    const midiF = midiFromFreq(freq);
    const midi = Math.round(midiF);
    const cents = Math.round((midiF - midi) * 100);
    this.lastVoiced = t;
    this.onLive({ voiced: true, level, freq, midi, cents });

    if (midi === this.cand) {
      this.candCount++;
    } else {
      this.cand = midi;
      this.candCount = 1;
      this.candStart = t;
    }
    if (this.pending !== null && t - this.pending > PLUCK_SETTLE) this.pending = null;
    if (this.candCount < STABLE_FRAMES) return;

    if (this.pending !== null) {
      // A pluck just happened and the pitch has settled: it's a new note
      // (or the same note plucked again), starting at the pluck time.
      const at = this.pending;
      this.pending = null;
      if (this.cur) {
        if (at - this.cur.start < RESTRIKE_GAP && this.cur.midi === midi) return; // same attack
        this._end(at);
      }
      this._start(midi, at);
    } else if (!this.cur) {
      this._start(midi, this.candStart);
    } else if (midi !== this.cur.midi) {
      // Pitch changed without a pluck (hammer-on, pull-off, slide)
      this._end(this.candStart);
      this._start(midi, this.candStart);
    }
  }

  /** End any note in progress (e.g. when recording stops). */
  flush(t) {
    if (this.cur) this._end(t);
  }

  _start(midi, t) {
    if (this.debug) this.debug.push(['start', midi, +t.toFixed(3)]);
    this.cur = { midi, start: t, end: null };
    this.onStart(this.cur);
  }

  _end(t) {
    const n = this.cur;
    this.cur = null;
    n.end = Math.max(t, n.start + 0.03);
    this.onEnd(n);
  }
}
