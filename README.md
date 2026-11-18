# Music Scribe 🎼

Play your acoustic guitar; little Mozart writes it down as notation and tab.

- [RESEARCH.md](RESEARCH.md): what already exists
- [SPEC.md](SPEC.md): the full plan
- `app/`: the app (no build step, plain HTML/CSS/JS)

## Status: Milestone 1 ✅
- Mic picker (any input), level meter, sensitivity, Bluetooth warning, phone voice processing turned off
- Live pitch detection (YIN) with a note readout, tuner needle, and string/fret
- Note tracking: detects new notes, re-plucks of the same note, and hammer-on/slide pitch changes, and filters out blips
- Smart fret picking (stays near your hand position)
- Live notation (treble 8vb) + tab, drawn with VexFlow on a parchment page
- Mozart mascot: asleep, idle (foot tap), listening ("♪?"), scribbling (ink flying)
- Candlelit dark mode, mobile-first layout, installable PWA shell, works offline after first load

## Status: Milestone 2 ✅
- Records the whole take; press **Cease** and Mozart writes the **accurate version** with Spotify's Basic Pitch, on-device
- **Tempo**: worked out automatically from free playing (fine-tune with − / + / ½× / 2×), or turn on the **Metronome** for a one-bar count-in and a tick on every beat
- **Time signature**: Auto (4/4 or 3/4), or pick 4/4, 3/4 or 2/4
- Real rhythm: 16th-note grid, dotted notes, ties across bars, beamed eighths, rests
- **Chords**: stacked in the notation, named above the staff (C, Am7, G/B…), and laid out as real chord shapes in the tab
- Falls back to the live notes if the model can't load (e.g. offline on first use)

## Status: Milestone 3 ✅
- **Tap any note** (or rest) and an editor tray slides up:
  - Pitch ▲▼ by semitone, ±8ve by octave (you hear the note as you change it)
  - String: move a note to another string (tab updates)
  - Length: 16th → whole, including dotted
  - Chords: pick a note in the chord, **+ Note** (doubles it an octave up: handy for a missed top note), **− Note**, rename the chord or hide its name
  - **Make rest**, or tap a rest and **+ Add a note here**
  - **⌒ Tie** a note into the next identical one, or **Untie** a tied note into separate strikes
  - ◀ ▶ to step through notes; 🔊 to hear a chord
- **Undo / Redo** (↶ ↷), which also brings back a cleared or re-recorded take
- PC keys: **↑ ↓, W S or + −** move the note one step in the key (Shift+↑↓ / Shift+W S = one fret), **← →** or **A D** previous/next note (you hear each one), **Delete** removes the note, Enter = add note to a rest, Ctrl+Z / Ctrl+Y, Esc closes
- In the tray, ▲▼ move a step in the key, ♭ ♯ move one fret, ±8ve an octave; every change plays the new note

### Tools under the manuscript
- **Select**: turn it on, then tap notes to pick several (tap again to un-pick). ▲▼ / W S / + − move all of them along the key together, and you hear them as a little run.
- **Remove note / Remove N notes**: takes the note (or the picked notes) out and **closes the gap**: everything after slides earlier. Undo brings them back. Also the **Remove** button in the tray, or Delete.
- **Clear Thy Manuscript**: clears the page (Undo brings it back).
- On PC, hovering over a note highlights what a click will pick.
- Removed notes count as "wrong extra notes" in the Fixes log.
- **Tunings**: Standard, Drop D, half-step down, whole-step down, Drop C, or Custom (set each string)
- **Capo** 0–12: tab is counted from the capo, notation shows the real sounding notes, and the page is labelled "Capo 2" etc.

- **Tap a note to hear it**: tapping any note or chord plays it with a plucked-guitar sound (also as you step through with ◀ ▶)

## Status: Milestone 4 ✅
Tap **Export** (next to Clear) → **Seal & send**:
- **Formats**: PDF · Image (PNG: square post, 9:16 story, or whole page) · MusicXML · Guitar Pro (.gp) · MIDI · Text tab · SVG · Project (.musicscribe.json, reopen and keep editing)
- **Options**: show notes + tab, notes only, or tab only · paper A4 / Letter (picked from your phone's language) · clean white or parchment look
- **Title** and **By** (your name, optional, saved only on your device) printed at the top
- **Share…** opens the phone's share sheet: Instagram, TikTok, WhatsApp, Messages, Files, the Dropbox app…
- **Download** saves the file
- **Dropbox**
  - **PC (Chrome/Edge):** saves straight into your synced Dropbox folder (e.g. `C:\Users\you\Dropbox\Music Scribe`). Pick the folder once, allow editing, and the Dropbox desktop app syncs it. It never overwrites a file; it adds "(2)" instead. "Dropbox folder · change" switches folders.
  - **Phones:** uploads into *Dropbox › Apps › Music Scribe* (Music Scribe can only see that one folder). Needs a one-time app key; see below.
- **Open a saved project…** brings a .musicscribe.json back in to keep editing
- PDF, images, text, MIDI and MusicXML are made on the device and work offline; Guitar Pro downloads its writer (alphaTab) the first time

### One-time Dropbox setup
1. Go to https://www.dropbox.com/developers/apps → **Create app** → **Scoped access** → **App folder** → name it (e.g. *Music Scribe AiryPotter*).
2. **Permissions** tab: tick **files.content.write** → **Submit**.
3. **Settings** tab → **OAuth 2 / Redirect URIs**: add `https://airypotter.github.io/music-scribe/dropbox.html` and `http://localhost:5173/dropbox.html`. Set **Allow public clients (Implicit Grant & PKCE)** to **Allow**.
4. Copy the **App key** (not the secret) into `DROPBOX_APP_KEY` in `app/js/dropbox.js`.

## Limits and safety
- **Take length:** a take stops by itself at 10 minutes (a warning appears one minute before), because the take is held in memory while you play.
- **Offline:** the notation engine ships inside the app (`app/vendor/vexflow.js`, VexFlow 4.2.5, MIT licence), so the manuscript draws offline. The accurate pass needs one online use first to fetch Basic Pitch.
- **Project files** are checked before opening; a damaged one is refused and nothing changes.
- **Keyboard:** Tab to the manuscript, ←→ to move between notes, Enter to edit one; every note has a spoken label for screen readers.
- See `AUDIT.md` for the 2026-11-16 code audit (all nine findings fixed) and what still needs testing on real devices.

## Accuracy (without a guitar yet)
A test bench of 8 guitar-like songs (`app/dev/bench.js`) measures how well Mozart writes things out. Tuning on 2026-11-17 raised notes found right from **75% to 82%** and exactly-right notes/chords from **45% to 55%**, and the 3/4 waltz is now read correctly. Full before/after table, how to run the bench, and known weak spots: `ACCURACY.md`.

## Simple or Detailed (the Detail picker)
Music Scribe is for catching ideas while you practise, so the default is **Simple**: a clean page you can read back.
- Notes snap to 8th notes; each note lasts until the next one, so **no rests are added**. Put rests where you want them yourself (tap a note → **Make rest**, or pick a shorter **Length**).
- A long pause doesn't fill bars with rests: the next phrase just starts on the next bar.
- A string still ringing from the note before, and the faint overtones above a note, aren't written as extra notes. Only a real strum (three or more strings sounding loud together) becomes a chord.
- Very quick notes still get their own place (a 16th note if there's no room for an 8th).
- **Finger-lift noise is filtered out, using an intention scale.** Lifting a finger off a fretted string lets that string ring open (a stray "0" in the tab), sometimes as loud as the note itself. So Mozart doesn't judge by loudness alone: every lone note gets an intention score from 0 (accident) to 1 (played on purpose), built from:
  - **Does it fit?** It lands late, just before the next note, in a gap the rhythm treats as one beat; it leaps away from the tune and back (14 → 0 → 15); or it arrives together with the next note in a single-note line.
  - **Is there a cause?** It's the open string the previous note was fretted on, starting as that note ended.
  - **How was it played?** Quieter, a softer attack, or very short (this only adds to the doubt).
  A note is dropped only when it clearly doesn't fit (score below 0.55); its faint overtones go with it. Chords and strums are never touched, and a **pedal note** (an open string you come back to like clockwork, in the middle of the beat) is recognised as a pattern and kept.
  - **Echoes and sympathy**: an octave (or other overtone) of the note just played, or a quieter stray note ringing along with the next fret of a smooth run, isn't written as a note or a chord.
  Test results: a scale up and down the low E string with open-E lift noise went from **16 wrong notes to 3, nothing missed**; the E/B scale from 32 wrong to 4. Across the 8 bench songs plus a pedal-note and an open-string riff, **no real notes are removed**.
**Detailed** keeps every note and rest on a 16th-note grid. Switching re-writes the take (Undo brings the other version back).

## Tab follows your string
When you climb or descend one string fret by fret (3 or more notes, one fret apart), the tab keeps the run on that string (E1 E2 E3 … E19) instead of hopping across the neck. A stray open string or a stacked stray note doesn't break the run.

## Layers: a quartet on one manuscript
Write a melody, then add up to **3 more guitar parts** (backup, harmony, bass line…) on top and hear them together.
- **+ Layer** (under the manuscript header) adds a part. Tap **Begin** and you get a one-bar count-in at the song's tempo, then the other layers play while you play; your part is written on the same bars. (Or tap a rest in the new layer to write notes by hand.)
- **Headphones work best.** If the other layers come out of speakers and the mic picks them up, Mozart takes those notes out again (only when that's clearly happening, so a note you really play in unison stays).
- **The layer you're editing is bold black.** The others are faint, each in its own colour: layer 1 **sky blue**, layer 2 **violet**, layer 3 **arterial red**, layer 4 **evergreen**. The tab shows only the layer you're editing.
- **All** shows every layer bold in its colour; tap a layer to make it thin, tap again to make it bold.
- **▶ plays every layer together**, each placed a little left or right so you can tell them apart. 🔊/🔇 on a layer mutes it; **Volume** sets its level. Rename a layer by typing in its name box; **Delete layer** has Undo.
- Begin on a song with layers records **the layer you're editing** again (Undo brings the old one back). Clear Thy Manuscript starts a new song.
- Tempo, time signature and detail are shared by all layers, so they're locked once there are two or more: set them first.
- Layers are saved in Thy Library and in project files (notes only, never audio). Exports (PDF, MusicXML…) still contain the layer you're editing; all parts come in a later phase.

## Shorter wait after Cease
Mozart now writes the take out **while you play**: about once a second the newest audio goes (in memory only) to the background transcriber, which works through it in ~4-second slices, each with a second of overlap either side so the joins come out exactly like one long pass. After Cease only the last few seconds are left. A 30-second take is ready in about **3 seconds instead of ~14**, and the wait stays about that long however long you play. If anything goes wrong mid-way, it quietly falls back to one long pass. Still nothing is kept: the audio is dropped as soon as the notes are written.

## Downloads
Untitled downloads are named **Thy Manuscript 2026-11-17 17.24** (your local date and time); give the take a title to use that instead.

## Tuner
Tap **Tune** (under the Begin seal) before you play. Play one string at a time: the tuner finds the nearest string in your current tuning, shows the note, a needle from −50 to +50 cents, and says "Too low · tighten ↑", "Too high · loosen ↓" or "In tune ✓" (within ±5 cents). Each string gets a ✓ once it has stayed in tune for half a second. Tap a string to tune only that one (handy in a noisy room). With a capo set, it reminds you to tune with the capo off. It only listens: nothing is recorded or kept.

## Recording with the click
If the metronome plays through speakers, the mic hears it too. Music Scribe now knows exactly when every beat was, so:
- the live preview ignores the instant of each tick;
- when Mozart writes out the take, a string that's still ringing isn't written again just because a tick sounded (it must clearly get louder to count as a new pluck);
- any short note that keeps appearing on the beats at the same pitch (a speaker's thump, a rattling desk) is removed, while real notes on the beat stay.
Headphones are still the cleanest way to use the click.

## Key signatures
Mozart works out the **key** from your notes (major or minor, e.g. "A minor", "B♭ major") and writes the key signature at the start of every line. Notes are spelled in the key (B♭ rather than A♯ in F major, F♮ with a natural sign in D major), and chord names follow the same spelling. The **Key** picker (next to Time) lets you choose a key; **Auto** goes back to Mozart's choice. The key goes into MusicXML, MIDI, Guitar Pro and project files.

## Practice playback
A **Practice** row appears under the manuscript header when there's music (on phones it folds into one "Practice" button):
- **Speed** slider, 40–100% (in 5% steps), for learning something slowly
- **Loop**: tap a note, turn Loop on, and its bar repeats; choose **1, 2 or 4 bars**
- **Metronome**: a tick on every beat while playing back, accented on beat 1
Changing any of these while music plays carries on from the same note. Speed, Metronome and the bar count are remembered.

## Mozart's mistakes (fix log)
The **Fixes** button (manuscript header) shows what you've corrected: wrong extra notes, missed notes, wrong pitch (with how far off), wrong length, notes written as two or joined, wrong tempo (halved/doubled) or time signature, string choice and chord names. Every fix in the note editor is counted automatically; Undo takes it back out; ▲▲ on one note counts as one fix. **Save log** makes a small .json file (counts and note numbers only: no audio, no song titles) you can share for re-tuning; **Clear log** has an Undo. Kept in this browser on this device.

## Privacy: no audio is kept
The only thing Music Scribe keeps is the written music. The recording lives in memory just long enough for Mozart to write out the notes, then it is discarded. It is never saved, exported, uploaded, or included in project files. There is no audio export.

## UI improvements (see UI-PLAN.md)
- **Phase 1 ✅** **Play** button (▶ in the manuscript header, or Space on PC): plays the written notes with the plucked-guitar sound, a gold cursor follows along, starts from the selected note, Pause resumes where it stopped. On phones, Tuning and Capo fold into one **Guitar** button.
- **Phase 2 ✅** Slimmer editor tray (String, Chord name and Tie sit behind **More**, which remembers if you leave it open); a progress bar on the manuscript while Mozart writes; **Clear Thy Manuscript** lives in the tools bar under the manuscript, away from Export, with a "Manuscript cleared · Undo" message.
- **Phase 3 ✅** The empty manuscript shows three steps (Begin, play, Cease). **Takes** opens Thy Library: every finished take is saved on the device by itself (written notes, edits, title and tuning only: never audio), and re-saved as you edit. Tap to reopen, ✎ to rename right in the list (Enter or Save to keep, Esc or Cancel to leave it), 🗑 to delete (with Undo). The library lives in that browser on that device; use Project files or Dropbox to move a take between devices.

## Run it on the PC
```
python "Music Scribe/app/serve.py"
```
Then open http://localhost:5173. Add `?demo` to the URL (http://localhost:5173/?demo) for built-in demo tones if you don't have a guitar handy.

## Use it on the Pixel
**Live at: https://airypotter.github.io/music-scribe/**

1. Open the link in Chrome on the Pixel.
2. Tap ⋮ → **Add to Home screen** (or **Install app**).
3. Open Music Scribe from the home screen, tap **Begin**, and allow the microphone.

Every push to `main` redeploys automatically (GitHub Actions → Pages).

## Use it on the iPhone: Music Scribe iOS
**Live at: https://airypotter.github.io/music-scribe/ios/**

1. Open the link in **Safari** on the iPhone.
2. Tap **Share** (on newer iPhones it's inside Safari's **⋯** menu) → **Add to Home Screen**. Keep **Open as Web App** on, then tap **Add**.
3. Open **Music Scribe iOS** from the home screen, tap **Begin**, and allow the microphone.

It's the same app and code as the Android/PC version (no separate codebase to keep in step), with its own name, icon entry and iPhone tweaks:
- Notes you hear while editing still play with the **silent switch on**
- No page zoom-in when you tap a text box or picker
- Safe-area padding for the notch / Dynamic Island and home bar
- If iOS holds the audio back, the first tap anywhere starts it

`app/ios/index.html` is **generated** from `app/index.html` by `tools/make_ios.py` (GitHub Actions runs it on deploy; `serve.py` runs it locally), so only ever edit `app/index.html`.
