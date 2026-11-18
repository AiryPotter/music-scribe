// File exporters that don't need drawing: MusicXML, MIDI, text tab, project file.
// (There is deliberately no audio export: recordings are never kept.)
//
// They all take a "song" (built by main.js from the current take):
// song = {
//   title, composer, bpm, meter, strings: [midi, low → high], capo, tuningName,
//   measures: [[piece]]   piece = { slots, rest, keys:[midi], positions:[{str (1 = highest), fret}|null],
//                                   chord, tieToNext, tieFromPrev }   (slots are 16th notes)
//   events: [{ slot, len, notes:[{ midi }] }],
//   project: { ...everything needed to reopen } }

import { spell } from './keys.js';

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** "2026-11-17 17.24" in the person's own time zone. */
export function localStamp(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`;
}

/** "My Song" → "My Song.pdf"; untitled → "Thy Manuscript 2026-11-17 17.24.pdf". Strips characters file systems don't allow. */
export function fileName(song, ext) {
  const base = (song.title || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim()
    || `Thy Manuscript ${localStamp()}`;
  return `${base}.${ext}`;
}

// ---------- pitch / duration helpers ----------
const STEPS = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const TYPE = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };
const pc = (m) => ((m % 12) + 12) % 12;
const octave = (m) => Math.floor(m / 12) - 1;

// ---------- chord names → MusicXML <harmony> ----------
const KINDS = {
  '': 'major', m: 'minor', 7: 'dominant', maj7: 'major-seventh', m7: 'minor-seventh',
  sus2: 'suspended-second', sus4: 'suspended-fourth', 6: 'major-sixth', m6: 'minor-sixth',
  add9: 'major', dim: 'diminished', 'm7♭5': 'half-diminished', m7b5: 'half-diminished', aug: 'augmented', 5: 'power',
};
/** "A♭m7/E♭" → { step:'A', alter:-1, suffix:'m7', bass:{ step:'E', alter:-1 } } (null if it isn't a chord name). */
export function parseChord(name) {
  const m = /^([A-G])([♯#♭b]?)([^/]*)(?:\/([A-G])([♯#♭b]?))?$/.exec(String(name).trim());
  if (!m) return null;
  const alt = (a) => (a === '♯' || a === '#' ? 1 : a === '♭' || a === 'b' ? -1 : 0);
  return { step: m[1], alter: alt(m[2]), suffix: m[3], bass: m[4] ? { step: m[4], alter: alt(m[5]) } : null };
}
function harmonyXml(name) {
  const c = parseChord(name);
  if (!c) return `<harmony print-frame="no"><root><root-step>C</root-step></root><kind text="${xmlEsc(name)}">none</kind></harmony>`;
  const kind = KINDS[c.suffix];
  let x = '<harmony print-frame="no"><root>';
  x += `<root-step>${c.step}</root-step>${c.alter ? `<root-alter>${c.alter}</root-alter>` : ''}</root>`;
  x += `<kind text="${xmlEsc(c.suffix)}">${kind || 'other'}</kind>`;
  if (c.bass) x += `<bass><bass-step>${c.bass.step}</bass-step>${c.bass.alter ? `<bass-alter>${c.bass.alter}</bass-alter>` : ''}</bass>`;
  if (c.suffix === 'add9') x += '<degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>';
  return x + '</harmony>';
}

// ---------- MusicXML (MuseScore, Sibelius, Finale, Dorico, Guitar Pro import) ----------
/** Two staves: standard notation (treble 8vb) and TAB with string/fret, plus chord symbols, tempo, tuning, capo. */
export function toMusicXML(song) {
  const barSlots = song.meter * 4;
  const date = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  L.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  L.push('<score-partwise version="4.0">');
  L.push(`<work><work-title>${xmlEsc(song.title || 'Untitled')}</work-title></work>`);
  L.push('<identification>');
  if (song.composer) L.push(`<creator type="composer">${xmlEsc(song.composer)}</creator>`);
  L.push(`<encoding><software>Music Scribe</software><encoding-date>${date}</encoding-date></encoding>`);
  L.push('</identification>');
  // one part per layer (a quartet opens as four guitar parts), or one part for a single layer
  const parts = song.parts?.length ? song.parts : [{ name: 'Guitar', measures: song.measures }];
  const channel = (k) => (k >= 9 ? k + 2 : k + 1); // skip MIDI channel 10 (drums)
  L.push('<part-list>' + parts.map((pt, k) => `<score-part id="P${k + 1}"><part-name>${xmlEsc(pt.name || 'Guitar')}</part-name>`
    + `<score-instrument id="P${k + 1}-I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument>`
    + `<midi-instrument id="P${k + 1}-I1"><midi-channel>${channel(k)}</midi-channel><midi-program>26</midi-program>${parts.length > 1 ? `<pan>${[0, -35, 35, -15][k] ?? 0}</pan>` : ''}</midi-instrument>`
    + '</score-part>').join('') + '</part-list>');

  const noteXml = (p, staff, voice) => {
    const [type, dots] = TYPE[p.slots] || ['quarter', 0];
    const dotXml = dots ? '<dot/>' : '';
    if (p.rest || !p.keys?.length) {
      return `<note><rest/><duration>${p.slots}</duration><voice>${voice}</voice><type>${type}</type>${dotXml}<staff>${staff}</staff></note>`;
    }
    return p.keys.map((midi, k) => {
      const sp = spell(midi, song.key?.fifths || 0);
      let x = '<note>';
      if (k > 0) x += '<chord/>';
      x += `<pitch><step>${sp.letter}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`;
      x += `<duration>${p.slots}</duration>`;
      if (p.tieFromPrev) x += '<tie type="stop"/>';
      if (p.tieToNext) x += '<tie type="start"/>';
      x += `<voice>${voice}</voice><type>${type}</type>${dotXml}`;
      x += `<staff>${staff}</staff>`;
      const n = [];
      if (p.tieFromPrev) n.push('<tied type="stop"/>');
      if (p.tieToNext) n.push('<tied type="start"/>');
      const pos = p.positions?.[k];
      if (staff === 2 && pos) n.push(`<technical><string>${pos.str}</string><fret>${pos.fret}</fret></technical>`);
      if (n.length) x += `<notations>${n.join('')}</notations>`;
      return x + '</note>';
    }).join('');
  };

  parts.forEach((pt, partIdx) => {
  L.push(`<part id="P${partIdx + 1}">`);
  pt.measures.forEach((bar, i) => {
    L.push(`<measure number="${i + 1}">`);
    if (i === 0) {
      const tunings = song.strings.map((m, line) => {
        const [step, alter] = STEPS[pc(m)];
        return `<staff-tuning line="${line + 1}"><tuning-step>${step}</tuning-step>${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${octave(m)}</tuning-octave></staff-tuning>`;
      }).join('');
      L.push(`<attributes><divisions>4</divisions><key><fifths>${song.key?.fifths || 0}</fifths><mode>${song.key?.mode || 'major'}</mode></key>`
        + `<time><beats>${song.meter}</beats><beat-type>4</beat-type></time><staves>2</staves>`
        + '<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
        + '<clef number="2"><sign>TAB</sign><line>5</line></clef>'
        + `<staff-details number="2"><staff-lines>${song.strings.length}</staff-lines>${tunings}${song.capo ? `<capo>${song.capo}</capo>` : ''}</staff-details>`
        + '</attributes>');
      if (partIdx === 0) L.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(song.bpm)}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${Math.round(song.bpm)}"/></direction>`);
      if (song.capo) L.push(`<direction placement="above"><direction-type><words>Capo ${song.capo}</words></direction-type><staff>1</staff></direction>`);
    }
    for (const p of bar) {
      if (p.chord && !p.tieFromPrev) L.push(harmonyXml(p.chord));
      L.push(noteXml(p, 1, 1));
    }
    L.push(`<backup><duration>${barSlots}</duration></backup>`);
    for (const p of bar) L.push(noteXml(p, 2, 5));
    if (i === pt.measures.length - 1) L.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    L.push('</measure>');
  });
  L.push('</part>');
  });
  L.push('</score-partwise>');
  return new Blob([L.join('\n')], { type: 'application/vnd.recordare.musicxml+xml' });
}

// ---------- MIDI ----------
function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
/**
 * Standard MIDI file: tempo, time signature, key, steel-string guitar, every note.
 * One layer → type 0 (one track). Several layers → type 1: one track per layer, each on its own
 * channel and named after the layer, so a DAW shows Melody, Backup, Bass… as separate tracks.
 */
export function toMIDI(song) {
  const PPQ = 480, perSlot = PPQ / 4;
  const parts = song.parts?.length ? song.parts : [{ name: song.title || 'Guitar', events: song.events }];
  const usPerBeat = Math.round(60000000 / song.bpm);
  const meta = (title) => {
    const name = enc.encode((title || 'Music Scribe').slice(0, 100));
    return [
      0, 0xff, 0x03, ...vlq(name.length), ...name,
      0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
      0, 0xff, 0x58, 0x04, song.meter, 2, 24, 8,
      0, 0xff, 0x59, 0x02, (song.key?.fifths || 0) & 0xff, song.key?.mode === 'minor' ? 1 : 0, // key signature
    ];
  };
  const noteData = (events, ch, name) => {
    const ev = []; // [tick, order, bytes]
    for (const e of events) {
      for (const n of e.notes) {
        ev.push([e.slot * perSlot, 1, [0x90 | ch, n.midi, 88]]);
        ev.push([(e.slot + e.len) * perSlot, 0, [0x80 | ch, n.midi, 0]]);
      }
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const label = name ? enc.encode(name.slice(0, 60)) : null;
    const data = label ? [0, 0xff, 0x03, ...vlq(label.length), ...label] : [];
    data.push(0, 0xc0 | ch, 25); // program 26 (1-based): Acoustic Guitar (steel)
    if (parts.length > 1) data.push(0, 0xb0 | ch, 10, [64, 44, 84, 57][parts.indexOf(parts.find((p) => p.events === events))] ?? 64); // pan, like playback
    let last = 0;
    for (const [tick, , bytes] of ev) { data.push(...vlq(tick - last), ...bytes); last = tick; }
    return data;
  };
  const chunk = (data) => {
    const all = [...data, 0, 0xff, 0x2f, 0x00];
    const len = all.length;
    return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...all];
  };
  let tracks;
  if (parts.length === 1) tracks = [chunk([...meta(song.title), ...noteData(parts[0].events, 0, null)])];
  else tracks = [chunk(meta(song.title)), ...parts.map((p, k) => chunk(noteData(p.events, k >= 9 ? k + 1 : k, p.name)))];
  const type = parts.length === 1 ? 0 : 1;
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, type, 0, tracks.length, (PPQ >> 8) & 0xff, PPQ & 0xff];
  return new Blob([new Uint8Array([...header, ...tracks.flat()])], { type: 'audio/midi' });
}

// ---------- ASCII tab ----------
/** Plain-text tab for forums, notes and messages. */
export function toTextTab(song, { lineWidth = 78 } = {}) {
  const S = song.strings.length;
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const labels = song.strings.map((m, i) => (i === S - 1 ? FLATS[pc(m)].toLowerCase() : FLATS[pc(m)]));
  const labelW = Math.max(...labels.map((l) => l.length));
  // one block of text per bar: chord line + one line per string (index 0 = highest string, printed first)
  const barsOf = (measures) => measures.map((bar) => {
    // a note on an off-16th needs 2 characters per 16th; otherwise 1 is enough (and reads better)
    let at = 0, odd = false;
    for (const p of bar) { if (!p.rest && !p.tieFromPrev && at % 2) odd = true; at += p.slots; }
    const w = odd ? 2 : 1;
    const total = bar.reduce((s, p) => s + p.slots, 0);
    const width = total * w + 1;
    const lines = Array.from({ length: S }, () => Array(width).fill('-'));
    const chordLine = Array(width).fill(' ');
    let pos = 0;
    for (const p of bar) {
      const col = pos * w + 1;
      if (!p.rest && !p.tieFromPrev) {
        p.positions?.forEach((ps) => {
          if (!ps) return;
          const row = ps.str - 1; // str 1 = highest = first line
          String(ps.fret).split('').forEach((ch, k) => { if (col + k < width) lines[row][col + k] = ch; });
        });
        if (p.chord) p.chord.replace(/♯/g, '#').replace(/♭/g, 'b').split('').forEach((ch, k) => { if (col + k < width + 6) chordLine[col + k] = ch; });
      }
      pos += p.slots;
    }
    return { width, chord: chordLine.join('').replace(/\s+$/, ''), lines: lines.map((l) => l.join('')) };
  });

  const out = [];
  if (song.title) out.push(song.title);
  if (song.composer) out.push(`by ${song.composer}`);
  const info = [`Tuning: ${song.tuningName}`, song.capo ? `Capo ${song.capo}` : '', `Tempo: ${Math.round(song.bpm)} bpm`, `Time: ${song.meter}/4`].filter(Boolean);
  out.push(info.join(' | '), '');
  const parts = song.parts?.length ? song.parts : [{ measures: song.measures }];
  parts.forEach((pt) => {
  if (pt.name && parts.length > 1) out.push(`== ${pt.name} ==`, '');
  const bars = barsOf(pt.measures);
  let i = 0;
  while (i < bars.length) {
    const sys = [];
    let width = labelW + 1;
    while (i < bars.length && (sys.length === 0 || width + bars[i].width + 1 <= lineWidth)) { sys.push(bars[i]); width += bars[i].width + 1; i++; }
    let chord = ' '.repeat(labelW + 1);
    for (const b of sys) chord = (chord + b.chord).padEnd(chord.length + b.width + 1, ' ');
    if (chord.trim()) out.push(chord.replace(/\s+$/, ''));
    // highest string first, like every tab you've seen
    for (let s = 0; s < S; s++) {
      const label = labels[S - 1 - s].padEnd(labelW, ' ');
      out.push(`${label}|${sys.map((b) => b.lines[s]).join('|')}|`);
    }
    out.push('');
  }
  });
  out.push('Written down with Music Scribe');
  return new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
}

// ---------- project file ----------
export const PROJECT_FORMAT = 'music-scribe-project';
export function toProject(song) {
  return new Blob([JSON.stringify(song.project, null, 1)], { type: 'application/json' });
}
/**
 * Check a project (from a file or the takes library) and return a clean copy.
 * Throws a friendly error if anything in it would break the page.
 */
function cleanKey(k) {
  if (!k || !Number.isInteger(k.fifths) || Math.abs(k.fifths) > 7 || !['major', 'minor'].includes(k.mode)) return {};
  return { key: { fifths: k.fifths, mode: k.mode, manual: !!k.manual } };
}
export function validateProject(data) {
  const damaged = () => new Error('That project is damaged, so it wasn’t opened.');
  if (data?.format !== PROJECT_FORMAT || !Array.isArray(data.take?.score?.events)) throw new Error('That file isn’t a Music Scribe project.');
  if (data.version > 1) throw new Error('That project was saved by a newer Music Scribe. Reload the app to update it.');
  const int = Number.isInteger;
  const t = data.take.score.tempo || {};
  const bpm = Number(t.bpm), meter = Number(t.meter);
  if (!(bpm >= 20 && bpm <= 400) || ![2, 3, 4].includes(meter)) throw damaged();
  if (data.take.score.events.length > 20000) throw damaged();
  const cleanEvents = (list) => list.map((e) => {
    if (!e || !int(e.slot) || e.slot < 0 || !int(e.len) || e.len < 1 || !Array.isArray(e.notes) || !e.notes.length) throw damaged();
    const seen = new Set();
    const notes = [];
    for (const n of e.notes) {
      if (!n || !int(n.midi) || n.midi < 20 || n.midi > 100) throw damaged();
      if (seen.has(n.midi)) continue;
      seen.add(n.midi);
      const note = { midi: n.midi };
      if (int(n.str) && n.str >= 0 && n.str < 12) note.str = n.str;
      notes.push(note);
    }
    const ev = { slot: e.slot, len: Math.min(e.len, 256), notes: notes.sort((a, b) => a.midi - b.midi).slice(0, 6) };
    if (typeof e.chord === 'string') ev.chord = e.chord.slice(0, 20);
    return ev;
  }).sort((a, b) => a.slot - b.slot).map((ev, i, all) => {
    if (all[i + 1] && ev.slot === all[i + 1].slot) throw damaged();
    if (all[i + 1]) ev.len = Math.min(ev.len, all[i + 1].slot - ev.slot); // notes never overlap
    return ev;
  });
  const events = cleanEvents(data.take.score.events);
  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const cleanNotes = (list) => (Array.isArray(list) ? list : [])
    .filter((n) => n && int(n.midi) && num(n.start) && num(n.end) && n.end > n.start)
    .map((n) => ({ midi: n.midi, start: n.start, end: n.end, amp: num(n.amp) ? n.amp : 0.6 }));
  const notes = cleanNotes(data.take.notes);
  // layers (up to 4 parts): each with its own notes; the song's tempo, time and key are shared
  let layers;
  if (Array.isArray(data.take.layers) && data.take.layers.length > 1) {
    if (data.take.layers.length > 4) throw damaged();
    const hues = new Set();
    layers = data.take.layers.map((L, k) => {
      if (!L || !Array.isArray(L.events) || L.events.length > 20000) throw damaged();
      let hue = int(L.hue) && L.hue >= 0 && L.hue < 4 && !hues.has(L.hue) ? L.hue : [0, 1, 2, 3].find((h) => !hues.has(h));
      hues.add(hue);
      return {
        name: String(L.name || `Layer ${k + 1}`).slice(0, 24), hue,
        mute: !!L.mute, thin: !!L.thin, vol: num(L.vol) ? Math.max(0, Math.min(1.5, L.vol)) : 1,
        source: String(L.source || 'project').slice(0, 20), notes: cleanNotes(L.notes), events: cleanEvents(L.events),
      };
    });
  }
  const active = layers ? (int(data.take.active) && data.take.active >= 0 && data.take.active < layers.length ? data.take.active : 0) : undefined;
  const g = data.guitar || {};
  return {
    format: PROJECT_FORMAT,
    version: 1,
    id: typeof data.id === 'string' && /^[\w-]{8,64}$/.test(data.id) ? data.id : undefined,
    title: String(data.title || '').slice(0, 80),
    composer: String(data.composer || '').slice(0, 60),
    guitar: { tuning: String(g.tuning || 'standard'), strings: Array.isArray(g.strings) ? g.strings.filter(int).slice(0, 6) : [], capo: Number(g.capo) || 0 },
    take: {
      source: String(data.take.source || 'project').slice(0, 20),
      notes,
      score: { tempo: { bpm, beat0: Number(t.beat0) || 0, meter, offset: Number(t.offset) || 0 }, events: layers ? layers[active].events : events, ...cleanKey(data.take.score.key) },
      ...(layers ? { layers, active } : {}),
    },
  };
}

/** Read a project file → the saved object (throws a friendly error if it isn't one). */
export async function readProject(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('That file isn’t a Music Scribe project.'); }
  return validateProject(data);
}
