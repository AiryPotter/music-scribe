# Music Scribe: UI improvement plan

Written 2026-11-11. Seven improvements in three phases. Each phase is tested with the demo song at phone and PC sizes, then deployed to both editions (main and iOS) at once.

## Rule: no audio is ever kept (asked 2026-11-11)
The only thing Music Scribe keeps is the written music (Thy Manuscript). The recording exists in memory only while Mozart writes out the notes, and is discarded the moment he finishes. It is never saved, exported, uploaded or put in project files. Playback plays the written notes, not a recording.

## Phase 1: Playback and a roomier phone layout ✅ done 2026-11-11

### 1a. Play button
- **What you see:** a ▶ Play button in the manuscript header (next to Undo/Redo). Tap it and the piece plays from the start with the plucked-guitar sound; the button becomes ⏸ Pause.
- **Moving cursor:** the note being played is highlighted in gold, and the page scrolls to follow it.
- **Start anywhere:** if a note is selected, playback starts from that note.
- **Tempo:** uses the tempo shown in the ♩= box. Chords are strummed low to high.
- **Stops by itself** when you tap Begin, Clear, edit a note, or reach the end.
- **Keyboard (PC):** Space plays and pauses.
- **How it's built:** a new `player.js` schedules notes from the score events on the audio clock, reusing `pluck.js`. The highlight reuses the selection band already in `score.js`.
- **Default I'll use unless you say otherwise:** no metronome click during playback, no loop. Both are easy to add later.

### 1b. Collapse guitar settings on phones
- **What you see:** on phones, Tuning and Capo fold into one "Guitar" button that shows the current setting (for example "Guitar: Standard" or "Guitar: Drop D · Capo 2"). Tapping it opens the two pickers.
- **PC:** unchanged; there's room for everything.
- **Result:** the manuscript starts about 90 px higher on a phone.

## Phase 2: Calmer editing and safer buttons ✅ done 2026-11-12

### 2a. Slimmer editor tray
- Pitch, Length and the action row (+ Note, − Note, Make rest, 🔊) stay visible.
- String, Chord name, Tie and Untie move behind a "More" toggle, which remembers whether you left it open.
- Result: the tray drops from about half the phone screen to about a third.

### 2b. Progress on the manuscript
- While Mozart writes out a take, a progress bar runs across the top of the manuscript page, with the percentage and "slow mode" note next to it.
- The Begin seal shows a "writing…" state so it's clear the app is busy. Tapping it still starts a new take and cancels the pass, as it does now.

### 2c. Safer Clear
- Clear moves away from Export, to the left side of the header next to the note count, and gets a quieter style.
- After clearing, a "Cleared · Undo" message appears with an Undo button in it, so recovery is one obvious tap.

## Phase 3: First run and saved takes ✅ done 2026-11-14

### 3a. First-screen guidance
- When the manuscript is empty, it shows three short steps in place of the lone rest: tap Begin, play, tap Cease.
- Disappears as soon as there's a take. No pop-ups or tours.

### 3b. Saved takes library
- Every finished take is saved on the device automatically: the written notes, edits and title only. No audio, ever.
- A "Takes" button opens a list: title, date, length, bars. Tap to reopen, swipe or tap a bin to delete, rename by editing the title.
- Stored in the browser (IndexedDB), so it stays on that device. Project files and Dropbox remain the way to move takes between devices.

## Order and size
| Phase | Items | Rough size |
|---|---|---|
| 1 | Playback, collapsed guitar settings | Largest: playback is a new feature |
| 2 | Tray, progress bar, Clear | Medium: layout changes to existing parts |
| 3 | First-run hints, takes library | Medium: the library needs storage work |

## Not included
- Phone Dropbox sign-in (waiting on the Dropbox App key).
- Real-guitar accuracy tuning (needs your test recordings).

## Phase 4: Accuracy without a guitar ✅ done 2026-11-17
- Test bench of 8 synthetic guitar songs (`app/dev/bench.js`); results and method in `ACCURACY.md`.
- Ringing-note de-duplication, faint-note filter, bass-led time signature, half-tempo check, chained strum grouping.
- Overall: notes 75% → 82%, exact 45% → 55%, time signature 21/24 → 24/24. Drop D power chords got worse (see ACCURACY.md).

## Fix log ✅ done 2026-11-17
- **Fixes** button opens "Mozart's mistakes": every correction counted by kind, with details; Save log (.json, no audio or titles); Clear log with Undo.

## Practice playback ✅ done 2026-11-17
- Speed slider 40–100%, loop the selected note's bar (1/2/4 bars), click on every beat. Row under the header; folds into a Practice button on phones.

## Key signatures ✅ done 2026-11-17
- Auto key detection (major/minor, Krumhansl profiles + bass and final-note hints) with a Key picker; notes, editor names and chord names spelled in the key; key in all exports and projects.

## Tuner and click clean-up ✅ done 2026-11-17
- Tuner screen (Tune button): string-aware needle, in-tune ticks per string, tap to lock a string; listens only.
- Click: live preview skips each tick; click-aware de-duplication and removal of beat-locked short notes in the final version.

## Simple detail and Thy Manuscript names ✅ done 2026-11-17
- Detail picker: Simple (default: 8th grid, no automatic rests, pauses close up, ringing/overtone notes dropped) or Detailed.
- Untitled downloads named "Thy Manuscript <local date time>"; rows grow for very high notes so PDF rows don't overlap.

## Next (needs a guitar)
- Record real takes on the Pixel and iPhone, compare with the bench, re-tune thresholds.
- Strumming patterns and repeated power chords are the weakest areas.

## Manuscript tools (2026-11-17)
- A tools bar under the manuscript: **Select** (tap several notes), **Remove note(s)** (closes the gap), **Clear Thy Manuscript** (moved here from the header, per 2c's aim of keeping it away from Export). Room for more tools.
- Pitch keys: ↑↓ / W S / + − = one step in the key (Shift = one fret); ← → / A D = previous/next note. Tray: ▲▼ key step, ♭ ♯ one fret, ±8ve. Every change plays the new note(s).
- Clearer hover highlight on PC; a different hover colour while Select is on.

## Layers, phase 1 (2026-11-18)
- Up to 4 layers sharing tempo, time and key. Chips above the page: colour dot, name, 🔊/🔇; **All**; **+ Layer**. A row for the active layer: name, volume, Delete layer.
- Page: active layer bold black (stems up), others faint in their colour (stems down) on the same staff; All = every layer bold in its colour, tap to thin. Tab = active layer only.
- Colours: sky blue #3b8fd0, violet #7b4fb3, arterial red #7d0010 (kept more solid when faint so it never turns pink), evergreen #1f6b4f.
- Begin records the active layer with a one-bar count-in while the others play (placed left/right); leaked notes from speakers are filtered only when a real share of the played notes came back.
- Next phases: 2 = transcribe while playing (shorter wait), 3 = export every layer as its own part, 4 = Harmony layer (copy a layer a 3rd/6th up in the key).

## Layers, phase 3: export every part (2026-11-18)
- Export sheet: **Layers: All layers / This layer** (shown when a song has 2+ layers with notes; remembered).
- MusicXML: a part per layer (name, own MIDI channel, pan); Guitar Pro is made from it. MIDI: type 1, a track per layer. Text tab: a section per layer.
- PDF/image/SVG: every layer bold in its colour, colour key in the heading line, tab of the active layer. The layer styles are embedded in the SVG so rendered files keep them.

## Layers, phase 4: Harmony (2026-11-18)
- **+ 3rd / + 6th** chips after + Layer: a new layer copying the active one 2 or 5 scale steps up in the key (chords too; notes above E6 drop an octave), at 80% volume, named "<layer> · 3rd up". Undo-able; off at 4 layers or when the layer is empty.

## Guide + wide-screen sides (2026-11-19)
- Guide (sections: Quick start, room setup, fixing the manuscript, layers & quartet, tuning & capo): pinned left at ≥1440 px; a bottom sheet from a header "Guide" button below that.
- Right column at ≥1440 px: Layers & mix card, the note editor (moved into the column), Thy Library (always open). Side width clamp(280px, (100vw − 980px)/2 − 28px, 440px); the main column shrinks to fit between.
- First-visit tour (5 steps, gold ring on each target), stored as seen; replay from the Guide. Skipped in ?demo.

## Chord menu + one highlight (2026-11-24)
- "Add chord to bar N" drop-down at the top of the note editor (notes and rests): in-key chords first, then 12 roots × 11 types (chordbook.js). Fills the tapped bar in the active layer only, plays it, stays selected; replay button; one Undo per choice. Root is always the lowest note; muted strings only at the edges; at most 4 fingers and 4 frets.
- Highlight causes: the Select tool left on, and hover / keyboard focus using nearly the same fill as "selected". Now gold fill = selected only; hover = dashed blue-grey outline; focus = outline; Select on = dashed gold page border, Esc turns it off.

## New take (2026-11-24)
- "+ New take" at the top of Thy Library opens two choices each time: Record a take (clean page, Begin focused) or Write one (four empty bars). The old take stays in the library; the message's Undo returns to it.
