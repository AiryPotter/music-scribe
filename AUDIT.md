# Music Scribe audit, 2026-11-16

Audited commit `38a38d4`. **Findings 1 to 4 were fixed on 2026-11-16** (see "Fixed" below); 5 to 9 are still open. "Confirmed" means reproduced in the browser with the demo song; "by reading" means found in the code but not run.

## Findings, worst first

| # | Severity | What goes wrong for the user | Where | Status | Suggested fix |
|---|---|---|---|---|---|
| 1 | High | Pressing Undo, Redo, or opening a saved take or project file while Mozart is still writing: the progress bar and Mozart stay stuck forever, and the take being written is silently lost | `app/js/main.js` `restore()` (~675), `openProject()` (~1077), `analyzeTake()` (~405) | Confirmed | Cancel the pass and clear the progress bar in those paths (or disable those buttons while writing) |
| 2 | High | Offline, the manuscript can't be drawn: "Notation engine did not load". The README says the app works offline | `app/index.html` (VexFlow `<script>` from the CDN), `app/sw.js` fetch handler | By reading (service workers don't run in the test browser) | Ship `vexflow.js` inside the app so it's cached like every other file. Fonts have the same gap, but that's only cosmetic |
| 3 | Medium | No limit on recording length. Memory grows about 11.5 MB per minute and briefly doubles at Cease; a very long take could crash a phone tab and lose everything | `app/js/recorder.js`, `main.js` `start()`/`stop()` | Calculated, not run | Auto-Cease at a limit (for example 10 minutes) with a warning shortly before |
| 4 | Medium | A damaged or hand-edited project file passes the check, then fails halfway through opening: the page is left with no music and dead Play/Export buttons until Clear | `app/js/exporters.js` `readProject()`, `main.js` `openProject()` | Confirmed | Check every note in the file before opening; if opening fails, put the previous take back and show a message |
| 5 | Medium | Notes can't be reached with the keyboard alone, and a screen reader gets nothing from the manuscript | `app/js/score.js` (tap areas) | Confirmed | Make each tap area focusable with a label such as "Bar 1, beat 2: E2, quarter note" |
| 6 | Low | Opening the same project file twice makes two library entries | `main.js` `openProject()` | Confirmed | Store an id in project files and reuse it |
| 7 | Low | Several phone buttons are 32–36 px tall (44 px is the usual minimum): zoom, tempo, Clear, chord chips, option buttons | `app/css/style.css` | By reading | Raise the phone sizes |
| 8 | Low | Deleting the take that's open from the library: later edits to it are no longer saved, with no notice | `main.js` takes list handler | By reading | Say so in the delete message, or save it again on the next edit |
| 9 | Low | Space starts playback while the Takes list is open | `main.js` key handler | By reading | Ignore Space while any sheet is open |

## Fixed on 2026-11-16 (findings 1 to 4)
1. **Undo/Redo/open while Mozart writes:** now blocked with the message "Mozart is still writing. Wait a moment, or tap Clear to stop him." The Undo and Redo buttons are disabled during the pass. Tested: the take finishes normally and Undo works afterwards.
2. **Offline notation:** VexFlow 4.2.5 now ships inside the app (`app/vendor/vexflow.js`, checked against the published hash) and is in the offline cache list. The font stylesheet is now cacheable too. Tested: the page makes no CDN request for it. Not tested: a real offline launch (service workers don't run in the test browser).
3. **Recording limit:** a take stops by itself at 10 minutes, with a warning in the status line one minute before, then Mozart writes out what was played. Tested with a 20-second test limit (`?limit=20`).
4. **Damaged project files:** every note, the tempo and the time signature are checked before opening (files and library takes). A bad one shows "That project is damaged, so it wasn't opened." and the page is left untouched. Tested with four kinds of damage; good files and library takes still open.

## The no-audio rule: passes

- The recording is dropped on every path: success, failure and cancel (`main.js` ~417–426).
- Confirmed in the browser: nothing in undo history holds a recording, including a take interrupted mid-pass.
- A saved library record holds only id, title, dates, tempo, bar and note counts, and the project data (notes, edits, tuning).
- Project files and all 8 export formats are built from the written notes only.
- The service worker caches only files fetched from the web, never recordings.
- The recording exists in memory only: in the page until the pass ends, and in the background worker while it runs.

## Could not be verified here (needs your devices)

- **iPhone:** whether the fast graphics mode works inside the background worker on Safari. If not, every take on iPhone runs in slow mode.
- **iPhone:** microphone, silent-switch audio, share sheet, Home Screen install.
- **Android:** sharing MIDI, MusicXML, Guitar Pro and project files through the share sheet.
- **PC:** the real Windows folder picker for Dropbox saving.
- **Phone Dropbox sign-in:** no App key yet.
- **Click track:** whether the timing correction is right on a phone speaker and mic.
- **Long takes:** PDF and image exports beyond the 8-bar demo; slow mode on several minutes of playing.
- **A real acoustic guitar** in a room. Everything so far used clean synthetic tones.

## Handover notes to correct

- `main.js` is 1,281 lines.
- Service workers don't run in the test browser pane, so offline behaviour can't be tested there.
