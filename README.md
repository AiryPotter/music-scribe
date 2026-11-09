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

Not yet (M3+): tap-to-edit notes, tunings and capo, exports.

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
