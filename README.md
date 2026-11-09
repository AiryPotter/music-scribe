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

Not yet (M2+): real rhythm and tempo, chords/strums, editing, exports.

## Run it on the PC
```
python "Music Scribe/app/serve.py"
```
Then open http://localhost:5173. Add `?demo` to the URL (http://localhost:5173/?demo) for built-in demo tones if you don't have a guitar handy.

## Run it on the Pixel
Chrome only allows the microphone on **HTTPS** or **localhost**, so the phone can't just use the PC's network address. Options:
1. **USB (works today):** turn on USB debugging on the Pixel, plug it in, open `chrome://inspect/#devices` on the PC, and enable **Port forwarding** `5173 → localhost:5173`. Then open `http://localhost:5173` in Chrome on the phone.
2. **Host it on HTTPS (best long term):** for example GitHub Pages or Netlify. Then you can install it from Chrome's menu → *Add to Home screen* and use it anywhere.
