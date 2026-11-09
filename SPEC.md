# Music Scribe: spec v0.1 (for approval)

**One line:** You play guitar or bass, Music Scribe listens, and you get sheet music plus tabs you can export anywhere.
**Status:** Draft. No code is written until you approve this.

## How it works (hybrid)
1. **Live preview:** while you play, notes appear on a staff and tab in rough form, so you can see it "hearing" you.
2. **Accurate pass:** when you press stop, the whole take is re-transcribed with Spotify's Basic Pitch (it handles chords), snapped to the beat, and the preview is replaced with the clean version.
3. **Edit:** you fix any wrong notes by clicking them, and can change string/fret, duration or tempo.
4. **Export:** see below.

## Input: acoustic guitar (answered 2026-11-08)
- The main input is an **acoustic guitar through a microphone**: the laptop mic, a USB mic or a phone. If the guitar has a pickup, it can also be plugged in.
- Built-in **"mic check"** screen: shows the input level and noise, and suggests aiming the mic about 15–30 cm from where the neck meets the body.
- Noise gate and a sensitivity slider so room noise and string squeaks don't turn into fake notes.
- Strings ring on after you play them, so notes are cut at the next note on the same string, not when the sound fades out.

## Guitar/bass specifics
- Tunings: standard, Drop D, half-step down, open G/D, 4/5-string bass, and custom
- Capo setting
- **Fret picking:** each note gets a sensible string and fret (keeping the hand in a comfortable position, not jumping around)
- Chord names shown above the staff (C, Am7 and so on)
- Later, maybe: bends, slides, hammer-ons and palm mutes (hard to detect automatically; manual at first)

## Exports (everything must be exportable)
| Format | For |
|---|---|
| **PDF** | Printing or sharing: notation + tab, notation only, or tab only |
| **MusicXML** | Opening in MuseScore, Sibelius, Finale, Dorico, or Guitar Pro (import) |
| **Guitar Pro (.gp)** | Guitar Pro, TuxGuitar, Songsterr-style apps |
| **MIDI (.mid)** | DAWs (FL Studio, Ableton, GarageBand, Reaper) |
| **ASCII tab (.txt)** | Pasting into forums, texts or notes |
| **PNG / SVG** | Images for social posts or slides |
| **Audio (.wav)** | Your original take |
| **Project (.musicscribe.json)** | Reopening and editing later |

## Two versions, one name: "Music Scribe" (answered 2026-11-08)
- **Phone is the main version.** The PC version uses the same app and the same name.
- Both versions come from **one shared codebase**, so every feature and fix reaches both at once, and a project saved on one opens on the other.
- **Phone:** an installable app (a home-screen icon that opens full screen like a normal app) built mobile-first: big record button, tab view you can swipe through, and shares exports through the phone's share sheet. Later it can be wrapped with Capacitor into a real App Store / Google Play app.
- **PC:** the same app in a wider layout, with more room for editing and printing PDFs.
- Handy side effect: a phone propped near the guitar is a decent mic for an acoustic.
- Processing happens on the device, so audio never leaves your phone or PC.

## Target phone (answered 2026-11-08)
- **Google Pixel 10, Android 17, Chrome.** This is the main test device.
- Installs from Chrome as a home-screen app (PWA); a Google Play version through Capacitor can come later.

## Mic support: any and all (answered 2026-11-08)
- **Mic picker** listing every input the phone or PC can see: the built-in mic, USB-C mics or interfaces, wired headset mics, Bluetooth headsets, and an acoustic pickup through an adapter.
- Remembers your last choice. The mic check screen shows the level of whichever mic is picked.
- Warns that Bluetooth mics add lag and lower the quality, so they're fine for jotting down ideas but worse for accuracy.
- Turns off the phone's voice processing (echo cancellation, noise suppression, auto-gain) so the guitar sound isn't squashed like a phone call.

## Look and feel: Mozart vibe (answered 2026-11-08)
- **Classical-era composer's study:** parchment-paper backgrounds, iron-gall ink brown and black, gold and deep burgundy accents, a wax-seal red record button.
- **Fonts:** an old-style engraved serif for headings (such as IM Fell English or Cormorant Garamond) and a clean, readable serif for the controls.
- Notation and tab drawn in ink on a parchment page, with ornate scroll dividers.
- **Mascot: little cartoon Mozart.** An original, hand-drawn style SVG character: powdered wig with a ribbon, red frock coat, holding a parchment scroll and a quill.
  - **Idle:** taps his foot and twirls the quill
  - **While you play:** scribbles furiously on the parchment, with ink flecks flying
  - **Accurate pass:** squints at the page and adjusts his spectacles
  - **Export done:** rolls up the scroll, stamps a wax seal and bows
  - **Silence or mic problem:** cups his ear
- A dark mode that still feels in period: candlelit desk, dark wood, glowing parchment.
- Mozart is a historical figure (public domain); the cartoon is our own original drawing.

## Tech plan
- **Web app** (installable as a PWA) that runs on phone and PC. Your audio never leaves your device.
- **Live pitch:** `pitchy` (Web Audio, from the mic)
- **Accurate pass:** `@spotify/basic-pitch` (TypeScript version, runs in the browser)
- **Rendering notation + tab:** **alphaTab**, an open-source guitar notation engine. It draws notation and tab together, plays the score back, and can export Guitar Pro files.
- **Exports:** alphaTab for Guitar Pro; my own code for MusicXML, MIDI and ASCII tab; the browser's print-to-PDF or jsPDF for PDF
- Built with Vite + TypeScript, no account or server needed

## Milestones
1. **M1:** Mic in, then a live note readout, then single notes on a tab and staff. ✅ Done 2026-11-08: no-build JS app in `app/`, YIN pitch detection, VexFlow rendering, and the Mozart mascot. Tested with demo tones; not yet tested with a real guitar or on the Pixel.
2. **M2:** Record, then a Basic Pitch accurate pass, snapped to tempo and a metronome. ✅ Done 2026-11-09: raw take recording (AudioWorklet), on-device Basic Pitch, automatic tempo + 4/4-vs-3/4 detection, optional click track with count-in, 16th-grid quantizing with ties/dots/beams/rests, chord names, and chord-shape tab. Tested with a synthetic demo song; not yet with a real guitar.
3. **M3:** Click-to-edit notes; tunings and capo
4. **M4:** All exports (PDF, MusicXML, GP, MIDI, TXT, PNG/SVG, WAV, project file)
5. **M5:** Polish: chord names, saved takes library, dark mode

## Open questions for you
1. ~~**Gear:**~~ Answered: acoustic guitar, recorded with a mic.
2. ~~**Style:**~~ Answered: all of it. Single-note riffs, solos and fingerpicking, plus strummed chords. The app writes every note **and** names the chords, with strum rhythm notation for strummed parts.
3. ~~**Tempo:**~~ Answered: both. **Free play with automatic tempo detection** (the app works out the BPM and time signature from your playing, and you can nudge them afterwards), plus an optional click track for the tightest rhythm.
4. ~~**Phone:**~~ Answered: phone first, plus a PC version. Both are called **Music Scribe**.
5. ~~**Name/look:**~~ Answered: "Music Scribe" for both, with a Mozart vibe and a cartoon Mozart mascot holding a parchment and quill.
6. ~~**Which phone:**~~ Answered: Pixel 10, Android 17.
7. ~~**Mic:**~~ Answered: support any and all mics.

**All questions answered. Waiting for approval to start M1.**
