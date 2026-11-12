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

const enc = new TextEncoder();
const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** "My Song" → "My Song.pdf"; strips characters file systems don't allow. */
export function fileName(song, ext) {
  const base = (song.title || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim()
    || `Music Scribe ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}`;
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
  L.push('<part-list><score-part id="P1"><part-name>Guitar</part-name>'
    + '<score-instrument id="P1-I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument>'
    + '<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>26</midi-program></midi-instrument>'
    + '</score-part></part-list>');
  L.push('<part id="P1">');

  const noteXml = (p, staff, voice) => {
    const [type, dots] = TYPE[p.slots] || ['quarter', 0];
    const dotXml = dots ? '<dot/>' : '';
    if (p.rest || !p.keys?.length) {
      return `<note><rest/><duration>${p.slots}</duration><voice>${voice}</voice><type>${type}</type>${dotXml}<staff>${staff}</staff></note>`;
    }
    return p.keys.map((midi, k) => {
      const [step, alter] = STEPS[pc(midi)];
      let x = '<note>';
      if (k > 0) x += '<chord/>';
      x += `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave(midi)}</octave></pitch>`;
      x += `<duration>${p.slots}</duration>`;
      if (p.tieFromPrev) x += '<tie type="stop"/>';
      if (p.tieToNext) x += '<tie type="start"/>';
      x += `<voice>${voice}</voice><type>${type}</type>${dotXml}`;
      if (alter && staff === 1) x += '<accidental>sharp</accidental>';
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

  song.measures.forEach((bar, i) => {
    L.push(`<measure number="${i + 1}">`);
    if (i === 0) {
      const tunings = song.strings.map((m, line) => {
        const [step, alter] = STEPS[pc(m)];
        return `<staff-tuning line="${line + 1}"><tuning-step>${step}</tuning-step>${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${octave(m)}</tuning-octave></staff-tuning>`;
      }).join('');
      L.push('<attributes><divisions>4</divisions><key><fifths>0</fifths></key>'
        + `<time><beats>${song.meter}</beats><beat-type>4</beat-type></time><staves>2</staves>`
        + '<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
        + '<clef number="2"><sign>TAB</sign><line>5</line></clef>'
        + `<staff-details number="2"><staff-lines>${song.strings.length}</staff-lines>${tunings}${song.capo ? `<capo>${song.capo}</capo>` : ''}</staff-details>`
        + '</attributes>');
      L.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(song.bpm)}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${Math.round(song.bpm)}"/></direction>`);
      if (song.capo) L.push(`<direction placement="above"><direction-type><words>Capo ${song.capo}</words></direction-type><staff>1</staff></direction>`);
    }
    for (const p of bar) {
      if (p.chord && !p.tieFromPrev) L.push(harmonyXml(p.chord));
      L.push(noteXml(p, 1, 1));
    }
    L.push(`<backup><duration>${barSlots}</duration></backup>`);
    for (const p of bar) L.push(noteXml(p, 2, 5));
    if (i === song.measures.length - 1) L.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    L.push('</measure>');
  });
  L.push('</part></score-partwise>');
  return new Blob([L.join('\n')], { type: 'application/vnd.recordare.musicxml+xml' });
}

// ---------- MIDI ----------
function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
/** Standard MIDI file (type 0): tempo, time signature, steel-string guitar, every note. */
export function toMIDI(song) {
  const PPQ = 480, perSlot = PPQ / 4;
  const ev = []; // [tick, order, bytes]
  for (const e of song.events) {
    for (const n of e.notes) {
      ev.push([e.slot * perSlot, 1, [0x90, n.midi, 88]]);
      ev.push([(e.slot + e.len) * perSlot, 0, [0x80, n.midi, 0]]);
    }
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const usPerBeat = Math.round(60000000 / song.bpm);
  const name = enc.encode((song.title || 'Music Scribe').slice(0, 100));
  const data = [
    0, 0xff, 0x03, ...vlq(name.length), ...name,
    0, 0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
    0, 0xff, 0x58, 0x04, song.meter, 2, 24, 8,
    0, 0xc0, 25, // program 26 (1-based): Acoustic Guitar (steel)
  ];
  let last = 0;
  for (const [tick, , bytes] of ev) {
    data.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  data.push(0, 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff];
  const len = data.length;
  const track = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
  return new Blob([new Uint8Array([...header, ...track, ...data])], { type: 'audio/midi' });
}

// ---------- ASCII tab ----------
/** Plain-text tab for forums, notes and messages. */
export function toTextTab(song, { lineWidth = 78 } = {}) {
  const S = song.strings.length;
  const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const labels = song.strings.map((m, i) => (i === S - 1 ? FLATS[pc(m)].toLowerCase() : FLATS[pc(m)]));
  const labelW = Math.max(...labels.map((l) => l.length));
  // one block of text per bar: chord line + one line per string (index 0 = highest string, printed first)
  const bars = song.measures.map((bar) => {
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
  out.push('Written down with Music Scribe');
  return new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
}

// ---------- project file ----------
export const PROJECT_FORMAT = 'music-scribe-project';
export function toProject(song) {
  return new Blob([JSON.stringify(song.project, null, 1)], { type: 'application/json' });
}
/** Read a project file → the saved object (throws a friendly error if it isn't one). */
export async function readProject(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('That file isn’t a Music Scribe project.'); }
  if (data?.format !== PROJECT_FORMAT || !data.take?.score?.events) throw new Error('That file isn’t a Music Scribe project.');
  if (data.version > 1) throw new Error('That project was saved by a newer Music Scribe. Reload the app to update it.');
  return data;
}
