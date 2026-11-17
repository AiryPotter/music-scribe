# Accuracy bench and tuning, 2026-11-17

No guitar is available yet, so accuracy is measured with a **test bench** (`app/dev/bench.js`): 8 test songs rendered with a plucked-string synthesizer that behaves like a guitar. It adds human timing (±10 ms), strummed chords, strings that ring on until re-plucked on the same string, a body resonance and room hiss. Each song runs through the same pipeline as a real take (Basic Pitch in the worker, note clean-up, tempo, time signature, quantizing). The result is scored against what was "played". The audio is rendered in memory and dropped; nothing is stored.

**Run it** from the browser console on the app's page (takes about a minute; open `?demo` first):
```js
const B = await import('./dev/bench.js');
console.table((await B.run()).rows);          // current settings
console.table((await B.run(B.OLD)).rows);     // every new rule switched off, for comparison
```

## Before → after (average of 3 random variations of each song)

| Song | Notes found right* | Notes/chords exactly right | Tempo | Time signature |
|---|---|---|---|---|
| Clean demo (guard) | 94% → **95%** | 80% → **80%** | 3/3 → 3/3 | 3/3 → 3/3 |
| Riff + chords | 71% → **80%** | 38% → **51%** | 3/3 → 3/3 | 3/3 → 3/3 |
| Fingerpicking | 60% → **78%** | 33% → **59%** | 3/3 → 3/3 | 3/3 → 3/3 |
| Waltz (3/4) | 74% → **82%** | 24% → **38%** | 3/3 → 3/3 | **0/3 → 3/3** |
| Fast run | 60% → **84%** | 28% → **68%** | 3/3 → 3/3 | 3/3 → 3/3 |
| Slow melody | 74% → **76%** | 75% → 75% | 3/3 → 3/3 | 3/3 → 3/3 |
| Drop D power chords | 90% → 86% ▼ | 67% → 53% ▼ | 3/3 → 3/3 | 3/3 → 3/3 |
| Strumming pattern | 77% → 77% | 18% → 17% | 3/3 → 3/3 | 3/3 → 3/3 |
| **All songs** | **75% → 82%** | **45% → 55%** | 24/24 → 24/24 | **21/24 → 24/24** |

\* F1 score: balances missed notes against wrong extra notes.

The original demo recording through the real app gives exactly the same result as before the changes (♩=100, 4/4, 8 bars, chords C G Am F twice).

## What changed (in `app/js/notes-post.js` and `app/js/rhythm.js`)
1. **Ringing notes reported twice.** The model often reports a still-ringing string as a new note when another string is plucked. That was the biggest error, worse than overtone ghosts. Now, when a note follows straight on from the same pitch, the app measures the sound energy at that pitch just before and just after. If it doesn't get louder (×1.1) and the model isn't confident a note starts there (onset ≥ 0.8), the two are joined into one note.
2. **Faint notes with no clear start** (string noise, sympathetic ringing) are dropped: quieter than 0.42 with an onset signal under 0.45.
3. **Waltz read as 4/4.** The time signature now looks at where the **bass** notes fall (relative to the piece's usual register), not just how many strings were hit. That's how a guitarist marks the downbeat.
4. **Double tempo.** If a steady stream of eighth notes fits twice the real tempo, the app now checks whether half the tempo puts the bass accents on the beats and the off-beats in between. A bass-less melody with long notes also drops to the half tempo. The bench didn't reproduce the fingerpicking double-tempo error once strings rang realistically, so this rule is a safeguard that hasn't been proven on that song.
5. **Strums** are grouped as a chain (each string within 70 ms of the last, the whole sweep within 120 ms), so a slow strum stays one chord.
6. **Overtone ghosts:** tried stronger filtering. It removed more ghosts but also real octave notes in chords, and made the clean demo worse, so it's unchanged.

## Known weak spots (honest)
- **Drop D power chords got worse:** the same chord hit repeatedly at the same loudness has no energy jump, so some re-hits are joined into one longer note. A "strum" exception (never join when 3+ strings are hit together) fixed this song but hurt fingerpicking and fast runs more, so it's off (`strumCount` in `notes-post.js`).
- **Strumming patterns** are still weak (17% exact): up-strums that catch only some strings are hard for the model.
- **Overtone ghosts** an octave or two above real notes are still the main source of wrong extra notes.
- **All of this is synthetic.** Real guitars, rooms and mics will behave differently. The first real recordings should be checked against these numbers, and the thresholds re-tuned if needed.

## Re-tuning from real playing
Once there's a guitar: record, fix what Mozart got wrong, then **Fixes → Save log** and share the file. The biggest counts show which rule to re-tune: extra overtone notes → the ghost filter; "one note written as two" → `splitEnergy`; double tempo → the half-tempo check; and so on.

## Click leaking from speakers (2026-11-17)
A real-guitar test with the click on PC speakers produced steady extra notes. The bench can now leak a click into each song through a simulated speaker (`B.run({ click: { style: 'tone', harsh: 3 } })`, with `clickAware: false` for the old behaviour). In the simulation the beep itself never became notes; the likely cause is a ringing string being "re-plucked" by each tick. Results with the click leaking (notes found right / exactly right / wrong extra notes):

| | Before | After |
|---|---|---|
| Fingerpicking | 91% / 81% / 5 | **94% / 88% / 3** |
| Fast run | 91% / 82% / 5 | **94% / 88% / 3** |
| Waltz | 77% / 38% / 3 | **77% / 42% / 0** |
| All songs | 85% / 63% | 84% / **65%** |

Strumming and the Drop D riff lose a little to the click either way (it masks some re-strums). The real fix still needs a real recording to confirm: after a take with the click, **Fixes → Save log** shows which extra notes appeared.

## Simple detail (2026-11-17)
After a real practice session (scales up and down) produced 10 messy PDF pages, **Simple** became the default. On a synthetic practice take (E major scale up and down twice with human timing and pauses, then E-A-B-E chords):

| | Detailed | Simple |
|---|---|---|
| Rests written | 11 | **0** |
| 16th notes | 44 | 14 (only the genuinely fast notes) |
| Ties | 22 | 9 |
| Chord-like stacks (only 4 real chords played) | 34 | **7** |
| PDF pages | — | **1** |

Both scale runs come out note for note apart from 4 small extras. The demo song is unchanged in Simple, except the doubled top G of the G chord is left out.

## Finger-lift noise (2026-11-17)
A real take (a scale up and down the E and B strings, metronome on, tuned first) showed random notes where a finger lifted off a string: the open string rings faintly, or the string scratches. `dropReleaseNoise` in `app/js/rhythm.js` (Simple mode only) now drops:
- a quieter open-string note (under 86% of the loudness of the note before) that starts within 0.8 s of that note's written end (Basic Pitch often ends a fading note early, so the lift can come well after);
- a short (< 0.25 s), much quieter (< 65%) note in the same place;
- and merges a same-pitch, quieter re-start straight after a note into it.
Any note that starts together with another note (a chord or strum; a lower octave counts, an overtone above doesn't) is never touched.

Synthetic test: chromatic run up/down the high E and B strings, 50 notes, plus 34 quiet open-string ghosts at the finger lifts.

| | Before | After |
|---|---|---|
| Notes written | 81 | 57 |
| Wrong extra notes | 32 | **7** |
| Real notes missed | 1 | **0** |

Across the 8 bench songs the filter removed **0 real notes** (it first removed 11 chord notes from the demo and one Drop D power-chord note, which is why the chord rule exists). `notesFor` in the bench also had a cache-key bug, now fixed. The remaining extras are ghosts nearly as loud as the real note (over 86%); a real recording's fix log will show whether that threshold should go lower.

## Intention scale for finger-lift noise (2026-11-17, second pass)
The next real take (a scale up and down the **low E** string) still showed stray open-E notes ("0") after frets 14, 15 and 18 (twice). On the low E, a high-fret note is quiet and the open string rings loud, so the ghost was as loud as the real note: a loudness rule can't catch it. `intentionScores` in `app/js/rhythm.js` now gives every lone note a 0–1 score:

- **misfit** (needed to call anything an accident): *late* (lands just before the next note), *squeezed* (late inside a gap the rest of the rhythm treats as one beat), *spike* (leaps away and the tune carries on: 14 → 0 → 15), *intrusion* (in a single-note line, an open string sounding together with the next note), *trailing* (the last sound of the take).
- **support**: *openLift* (it's the open pitch of a string the previous note could be fretted on) and *release* (it starts as that note ends).
- **weakness**: quieter than its neighbours, a softer attack than theirs (the transcriber's onset confidence, now kept on each note), or very short.
- intent = 1 − 0.6 × misfit × (0.35 + 0.65·support) × (0.6 + 0.4·weakness) / 0.6; dropped below **0.55**.
- Never touched: chords and strums (another real note starts with it); overtones (they go with their note). A **pedal note** (same pitch coming back at equal gaps, in the middle of the beat) has its misfit halved.

Timing is judged on onsets (notes struck together count as one), and overtones are recognised as harmonics (12, 19, 24, 28, 31, 36 semitones) of a louder note that's sounding, so they don't pose as chord partners.

New bench takes (`LIFT_SONGS`, run `ghostReport()` in `app/dev/bench.js`), Simple mode, filter off → on:

| Take | Wrong notes | Missed |
|---|---|---|
| Low E scale up/down, 13 open-E lift ghosts (some as loud as the fretted note) | 16 → **3** | 0 → **0** |
| E/B chromatic scale with 34 quiet ghosts (synthetic, no audio) | 32 → **4** | 1 → 1 |
| Pedal open E (guard: every other note is a real open E) | 4 → 4 | 2 → 2 |
| Riff down to open E (guard) | 1 → 1 | 1 → 1 |

Real notes removed across the 8 bench songs: **0** (strums, waltz chords, Drop D power chords, fingerpicking all intact). Detailed mode isn't affected (bench summary 83% note score / 54% exact on one seed, in line with the 3-seed 82% / 55%).

Still left: a ghost overtone that comes in a moment after the ghost (written as a 2-note stack), and a ghost that is the very last sound of the take while the note before still rings. Both are a single tap to fix. Tuning further needs a real take: after the next recording, **Fixes → Save log** shows which extras remain.

## One string, in order (2026-11-17, third pass)
Real take: the low E climbed fret 1 → ~19 with the click on. The PDF's tab read 1 2 **4 (D string)** 3 … 9 **D5 chord** then 6 7 8 … on the A and D strings, "out of order". Three causes:
- an octave of fret 2 sounding again, written as its own note;
- a quieter A ringing along with fret 10, written as a "D5" chord;
- that chord dragged the tab picker's hand position down the neck, so the rest of the run was placed on other strings.

Fixes:
- **Intention scale**: new clues. *echo* (an overtone of the note just played) adds support; a leap away and back inside a *smooth run* (fret after fret on both sides) counts more; *sympathy*: a quieter stray note far from the run that sounds with the run's next fret is not a chord.
- **Simple mode overtones**: three octaves (36 semitones) added, and overtones of a string still ringing from the previous note are dropped too.
- **Tab picker** (`FretPicker` in `guitar.js`): a run of 3+ notes, one fret apart on one string, carries on along that string; an open string or a stray note stacked with the next fret doesn't break it.

Bench take `Low E climb 1-19 (one string)` (octave ghost after fret 2, sympathetic A with fret 10, one open-E lift ghost), Simple mode:

| | Before | After |
|---|---|---|
| Tab | E1 E2 **D4 D4** E3 … E6+? E0 **A2+e4 A3 A4 D0+G2 D1 … D9** | **E1 E2 E3 … E19** (one E0 ghost left) |
| Wrong notes | 6 | 1 |
| Missed | 0 | 0 |

Every other bench song's tab is unchanged (Simple and Detailed), no real notes are removed, and the pedal/riff guards are untouched.
