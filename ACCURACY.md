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
