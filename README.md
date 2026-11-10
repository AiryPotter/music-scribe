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
- **Tempo**: worked out automatically from free playing (fine-tune with − / + / ½× / 2×), or turn on **Click** for a metronome with a one-bar count-in
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
- PC keys: ↑↓ pitch (Shift = octave), ←→ previous/next, Delete = rest, Enter = add note to a rest, Ctrl+Z / Ctrl+Y, Esc closes
- **Tunings**: Standard, Drop D, half-step down, whole-step down, Drop C, or Custom (set each string)
- **Capo** 0–12: tab is counted from the capo, notation shows the real sounding notes, and the page is labelled "Capo 2" etc.

- **Tap a note to hear it**: tapping any note or chord plays it with a plucked-guitar sound (also as you step through with ◀ ▶)

## Status: Milestone 4 ✅
Tap **Export** (next to Clear) → **Seal & send**:
- **Formats**: PDF · Image (PNG: square post, 9:16 story, or whole page) · MusicXML · Guitar Pro (.gp) · MIDI · Text tab · SVG · Audio (.wav, your original recording) · Project (.musicscribe.json, reopen and keep editing)
- **Options**: show notes + tab, notes only, or tab only · paper A4 / Letter (picked from your phone's language) · clean white or parchment look
- **Title** and **By** (your name, optional, saved only on your device) printed at the top
- **Share…** opens the phone's share sheet: Instagram, TikTok, WhatsApp, Messages, Files, the Dropbox app…
- **Download** saves the file
- **Dropbox** saves straight into *Dropbox › Apps › Music Scribe* (Music Scribe can only see that one folder). Needs a one-time app key; see below.
- **Open a saved project…** brings a .musicscribe.json back in to keep editing
- PDF, images, text, MIDI and MusicXML are made on the device and work offline; Guitar Pro downloads its writer (alphaTab) the first time

### One-time Dropbox setup
1. Go to https://www.dropbox.com/developers/apps → **Create app** → **Scoped access** → **App folder** → name it (e.g. *Music Scribe AiryPotter*).
2. **Permissions** tab: tick **files.content.write** → **Submit**.
3. **Settings** tab → **OAuth 2 / Redirect URIs**: add `https://airypotter.github.io/music-scribe/dropbox.html` and `http://localhost:5173/dropbox.html`. Set **Allow public clients (Implicit Grant & PKCE)** to **Allow**.
4. Copy the **App key** (not the secret) into `DROPBOX_APP_KEY` in `app/js/dropbox.js`.

Next (M5): polish: saved takes library, themes, playback.

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
