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

## Phase 3: First run and saved takes

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
