// Draws bars of notation (treble 8vb) with tablature underneath, using VexFlow.
//
// Input model: { measures: [[piece]], meter, header? }
// piece = { slots, rest, keys: [midi], positions: [{ str, fret } | null], chord, tieToNext, tieFromPrev, live,
//           ref (tap target id), sel (selected), focus (index of the focused key when selected) }
// slots are 16th notes (4 = quarter note).
// When pieces carry `ref`, invisible tap areas (<rect data-ref>) are added over each column.

import { vexKey } from './guitar.js';
import { DUR } from './rhythm.js';

const ROW_HEIGHT = 240;
const TAB_OFFSET = 110;
const SVG_NS = 'http://www.w3.org/2000/svg';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Evenly spaced preview (live notes as quarter notes, 4 per bar). */
export function previewModel(notes, liveNote) {
  const measures = [];
  for (let i = 0; i < notes.length; i += 4) {
    const bar = notes.slice(i, i + 4).map((n) => ({
      slots: 4,
      keys: [n.midi],
      positions: [n.pos ? { str: n.pos.string, fret: n.pos.fret } : null],
      live: n === liveNote,
    }));
    while (bar.length < 4) bar.push({ slots: 4, rest: true });
    measures.push(bar);
  }
  if (!measures.length) measures.push([{ slots: 16, rest: true }]);
  return { measures, meter: 4 };
}

function minMeasureWidth(m, withClef, withTime) {
  return 40 + (withClef ? 46 : 0) + (withTime ? 26 : 0) + m.reduce((w, p) => w + (p.slots <= 2 ? 24 : 32), 0);
}

export function renderScore(el, model) {
  const VF = window.Vex?.Flow;
  if (!VF) {
    el.innerHTML = '<p class="hint">Notation engine did not load (are you offline on first launch?).</p>';
    return;
  }
  const { Renderer, Stave, TabStave, StaveNote, TabNote, GhostNote, Voice, Formatter, Accidental,
    StaveConnector, Dot, Beam, StaveTie, Annotation, Fraction } = VF;
  const { measures, meter = 4, header = '' } = model;
  const TOP_PAD = header ? 30 : 14;

  const ink = cssVar('--ink', '#2b1d14');
  const paper = cssVar('--page', '#f3e3bf');
  const live = cssVar('--seal', '#9e1b1b');
  const chordInk = cssVar('--burgundy', '#7a1f2b');
  const selInk = cssVar('--sel-ink', '#a5541a');
  const hits = [];   // { x0, x1, y0, y1, ref }
  const bands = [];  // selected columns to highlight

  el.innerHTML = '';
  const pxWidth = Math.max(280, Math.floor(el.clientWidth));
  const scale = pxWidth < 560 ? 1.1 : 1.3;
  const width = pxWidth / scale;
  const usable = width - 16;

  // lay bars out into rows by how much room each needs
  const rows = [];
  let row = [], used = 0;
  measures.forEach((m, i) => {
    const need = minMeasureWidth(m, row.length === 0, i === 0);
    if (row.length && used + need > usable) { rows.push(row); row = []; used = 0; }
    row.push({ m, i, need: minMeasureWidth(m, row.length === 0, i === 0) });
    used += row[row.length - 1].need;
  });
  if (row.length) rows.push(row);

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(pxWidth, Math.ceil((rows.length * ROW_HEIGHT + TOP_PAD + 10) * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle(ink);
  ctx.setStrokeStyle(ink);
  if (ctx.setBackgroundFillStyle) ctx.setBackgroundFillStyle(paper);

  if (header) {
    ctx.save();
    ctx.setFont('Times New Roman', 13, 'normal', 'italic');
    ctx.fillText(header, 10, 16);
    ctx.restore();
  }

  const order = []; // every drawn StaveNote in time order, with its row, for ties

  rows.forEach((r, rowIdx) => {
    const total = r.reduce((s, c) => s + c.need, 0);
    const extra = (usable - total) / r.length;
    let x = 8;
    const y = TOP_PAD + rowIdx * ROW_HEIGHT;
    r.forEach((cell, col) => {
      const w = cell.need + Math.max(0, extra);
      const stave = new Stave(x, y, w);
      const tab = new TabStave(x, y + TAB_OFFSET, w);
      if (col === 0) { stave.addClef('treble', 'default', '8vb'); tab.addClef('tab'); }
      if (cell.i === 0) stave.addTimeSignature(`${meter}/4`);
      if (typeof Stave.formatBegModifiers === 'function') Stave.formatBegModifiers([stave, tab]);
      stave.setContext(ctx).draw();
      tab.setContext(ctx).draw();
      const left = new StaveConnector(stave, tab);
      left.setType(StaveConnector.type.SINGLE_LEFT);
      left.setContext(ctx).draw();
      if (col === r.length - 1) {
        const right = new StaveConnector(stave, tab);
        right.setType(cell.i === measures.length - 1 ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT);
        right.setContext(ctx).draw();
      }

      const staffNotes = [], tabNotes = [], beamable = [];
      cell.m.forEach((p) => {
        const [dur, dots] = DUR[p.slots] || ['q', 0];
        let sn, tn;
        if (p.rest || !p.keys?.length) {
          sn = new StaveNote({ keys: ['b/4'], duration: dur, dots, type: 'r' });
          tn = new GhostNote({ duration: dur, dots });
        } else {
          const ks = p.keys.map(vexKey);
          sn = new StaveNote({ keys: ks.map((k) => k.key), duration: dur, dots, auto_stem: true });
          ks.forEach((k, idx) => { if (k.sharp) sn.addModifier(new Accidental('#'), idx); });
          if (p.tieFromPrev) {
            tn = new GhostNote({ duration: dur, dots });
          } else {
            const positions = p.positions?.length
              ? p.positions.filter(Boolean)
              : [];
            tn = positions.length
              ? new TabNote({ positions, duration: dur, dots })
              : new TabNote({ positions: [{ str: 6, fret: 'x' }], duration: dur, dots });
          }
          if (p.chord && !p.tieFromPrev) {
            const a = new Annotation(p.chord);
            try { a.setFont('Times New Roman', 13, 'bold', 'italic'); } catch { /* older API */ }
            a.setVerticalJustification(Annotation.VerticalJustify.TOP);
            a.setStyle?.({ fillStyle: chordInk, strokeStyle: chordInk });
            sn.addModifier(a, 0);
          }
          if (p.live) {
            sn.setStyle({ fillStyle: live, strokeStyle: live });
            tn.setStyle?.({ fillStyle: live, strokeStyle: live });
          }
          if (p.sel) {
            sn.setStyle({ fillStyle: selInk, strokeStyle: selInk });
            tn.setStyle?.({ fillStyle: selInk, strokeStyle: selInk });
            if (p.focus !== undefined && p.keys.length > 1) {
              try { sn.setKeyStyle(p.focus, { fillStyle: live, strokeStyle: live }); } catch { /* older API */ }
            }
          }
          beamable.push(sn);
          order.push({ sn, row: rowIdx, piece: p });
        }
        if (p.rest && p.sel) sn.setStyle({ fillStyle: selInk, strokeStyle: selInk });
        if (dots) Dot.buildAndAttach([sn], { all: true });
        staffNotes.push(sn);
        tabNotes.push(tn);
      });

      const nv = new Voice({ num_beats: meter, beat_value: 4 }).setStrict(false).addTickables(staffNotes);
      const tv = new Voice({ num_beats: meter, beat_value: 4 }).setStrict(false).addTickables(tabNotes);
      let beams = [];
      try {
        beams = Beam.generateBeams(staffNotes, { groups: [new Fraction(1, 4)], beam_rests: false, maintain_stem_directions: false });
      } catch { beams = []; }
      const formatWidth = Math.max(40, stave.getNoteEndX() - stave.getNoteStartX() - 10);
      new Formatter().joinVoices([nv]).joinVoices([tv]).format([nv, tv], formatWidth);
      nv.draw(ctx, stave);
      tv.draw(ctx, tab);
      beams.forEach((b) => b.setContext(ctx).draw());

      // tap areas: each column runs halfway to its neighbours, covering staff + tab
      const centers = staffNotes.map((sn) => {
        try { return sn.getAbsoluteX() + 7; } catch { return null; }
      });
      const leftEdge = stave.getNoteStartX() - 4, rightEdge = x + w;
      cell.m.forEach((p, j) => {
        if (p.ref === undefined || centers[j] === null) return;
        const x0 = j === 0 ? leftEdge : (centers[j - 1] + centers[j]) / 2;
        const x1 = j === cell.m.length - 1 ? rightEdge : (centers[j] + centers[j + 1]) / 2;
        const hit = { x0, x1, y0: y - 6, y1: y + TAB_OFFSET + 96, ref: p.ref };
        hits.push(hit);
        if (p.sel) bands.push(hit);
      });
      x += w;
    });
  });

  // ties (across bars too; split in two when a tie crosses to the next row)
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i], b = order[i + 1];
    if (!a.piece.tieToNext || !b.piece.tieFromPrev) continue;
    const idx = a.piece.keys.map((_, k) => k);
    try {
      if (a.row === b.row) {
        new StaveTie({ first_note: a.sn, last_note: b.sn, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
      } else {
        new StaveTie({ first_note: a.sn, last_note: null, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        new StaveTie({ first_note: null, last_note: b.sn, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
      }
    } catch { /* skip a tie VexFlow can't draw */ }
  }

  // highlight behind the selection, tap areas on top of everything
  const svg = el.querySelector('svg');
  if (!svg) return;
  for (const b of bands) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', b.x0 + 1); r.setAttribute('y', b.y0);
    r.setAttribute('width', Math.max(4, b.x1 - b.x0 - 2)); r.setAttribute('height', b.y1 - b.y0);
    r.setAttribute('rx', 6);
    r.setAttribute('class', 'sel-band');
    svg.insertBefore(r, svg.firstChild);
  }
  for (const h of hits) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', h.x0); r.setAttribute('y', h.y0);
    r.setAttribute('width', Math.max(4, h.x1 - h.x0)); r.setAttribute('height', h.y1 - h.y0);
    r.setAttribute('class', 'hit');
    r.dataset.ref = String(h.ref);
    svg.appendChild(r);
  }
}
