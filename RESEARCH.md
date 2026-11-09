# Music Scribe: what already exists

**Goal:** I play an instrument and AI writes it down as sheet music, tabs or MIDI.
**Research date:** 2026-11-08

## Short answer
There are plenty of tools that take a **recording** and turn it into notation. Very few write the notes **live while you play**, and most still need hand cleanup on busy recordings. Some of these comparisons come from vendors (Songscription, MuseHub) ranking their own products, so be skeptical of them.

## 1. Web and desktop tools

| Tool | What it does | Platform | Pricing model |
|---|---|---|---|
| **Songscription** | Upload a song and get sheet music in minutes. Covered by TechCrunch (2025) as a "Shazam for sheet music". | Web | Subscription |
| **Klangio** (Transcription Studio, Piano2Notes, Guitar2Tabs, Drum2Notes, Sing2Notes) | One app per instrument, plus a studio and an **API** | Web, iOS, Android | Subscription |
| **ScoreCloud** | Turns the melody you play or sing into readable notation | Windows, Mac, iOS | Free tier plus paid |
| **AnthemScore** | Audio to MusicXML/MIDI with spectrogram editing | Desktop, offline | **One-time purchase** |
| **Music Transcription Studio** | MuseHub's pick for best all-round tool | Desktop | Paid |

## 2. App stores (phone)

| App | Notes |
|---|---|
| **Frettable** (iOS) | Records your instrument and writes sheet music plus tabs. Good fit for "I play, it writes." |
| **Notate + Play** (iOS) | Combines recording, by-ear transcription and score writing; says it works with any instrument |
| **Piano2Notes** (iOS/Android) | Piano only; processes after recording, not live |
| **Melody Scanner** (iOS) | Klangio's older app. It looks neglected (last update early 2024) and Klangio's newer apps have replaced it. |
| **ScoreCloud** (iOS) | Mobile companion to the desktop app |

**Gap:** I found almost no app that does true **real-time, note-by-note notation** that shows up as you play. That gap is the opening for Music Scribe.

## 3. GitHub / open source (building blocks)

| Project | Role | License |
|---|---|---|
| [spotify/basic-pitch](https://github.com/spotify/basic-pitch) (+ `basic-pitch-ts` for the browser) | Audio to MIDI with a light neural net. Handles chords; works best on one instrument at a time. | Apache-2.0 |
| [magenta/mt3](https://github.com/magenta/mt3) | Google's multi-instrument transcription, with a piano checkpoint and a Colab notebook. Heavier to run. | Apache-2.0 |
| RecogNotes (orgurar/recognotes) | Mic, then CREPE pitch tracking, then a LilyPond PDF of single-line melodies | Check repo |
| [nomadsdev/score-sync-research](https://awesome.ecosyste.ms/projects/github.com%2Fnomadsdev%2Fscore-sync-research) | Web app: mic recording, note detection, a virtual sheet and a metronome (research quality) | Check repo |
| `note-listener`, `@chordbook/tuner` / `pitchy` | Live pitch detection from the mic in the browser | OSS |
| VexFlow / OpenSheetMusicDisplay / LilyPond | Draw the notation (live in the browser, or as a PDF) | OSS |

*From my own knowledge (not checked in this search):* ByteDance `piano_transcription_inference` (high-accuracy piano), `omnizart`, and Meta's `demucs` (splits a mixed song into stems before transcribing).

## Possible Music Scribe directions
1. **Live mode (the gap):** a browser app that listens to the mic, detects pitch with `pitchy` or CREPE, tracks the beat with a metronome, and writes notes onto a VexFlow staff as you play. Works best for one note at a time (voice, flute, violin, single-line guitar).
2. **Take mode (accurate):** record a take, run Basic Pitch on it (it can run in the browser with `basic-pitch-ts`), round the timing to the beat grid, show the score, and export MusicXML/MIDI for MuseScore.
3. **Hybrid:** a rough live preview while you play, then a cleaner Basic Pitch pass when you stop.

## Sources
- [MuseHub: best music transcription software](https://www-cf.musehub.com/learn/best-music-transcription-software)
- [TechCrunch: Songscription launch](https://techcrunch.com/2025/06/30/songscription-launches-an-ai-powered-shazam-for-sheet-music)
- [MusicRadar: Songscription review](https://www.musicradar.com/music-tech/humans-will-be-doing-all-the-serious-music-transcription-for-the-foreseeable-future-songscription-review)
- [Freebeat: 7 AI tools that transcribe music](https://freebeat.ai/articles/7-ai-tools-that-can-transcribe-music-notes-midi)
- [Frettable (App Store)](https://apps.apple.com/us/app/frettable/id1206556398)
- [Notate + Play (App Store)](https://apps.apple.com/app/id1658701195)
- [Melody Scanner (App Store)](https://apps.apple.com/us/app/-/id6472921068)
- [Piano2Notes (App Store)](https://apps.apple.com/de/app/piano2notes/id1589420929?l=en-GB)
- [Songscription: Melody Scanner alternatives](https://www.songscription.ai/blog/melody-scanner-alternatives)
- [Toolmage: Klangio vs ScoreCloud](https://www.toolmage.com/en/compare/klangio-vs-scorecloud/)
- [magenta/mt3](https://github.com/magenta/mt3)
- [spotify/basic-pitch (ecosyste.ms)](https://awesome.ecosyste.ms/projects/github.com%2Fspotify%2Fbasic-pitch)
- [@chordbook/tuner](https://github.com/chordbook/tuner)
- [note-listener](https://www.pkgstats.com/pkg:note-listener)
