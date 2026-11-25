// Draws bars of notation (treble 8vb) with tablature underneath, using VexFlow.
//
// Input model: { measures: [[piece]], meter, header? }
// piece = { slots, rest, keys: [midi], positions: [{ str, fret } | null], chord, tieToNext, tieFromPrev, live,
//           ref (tap target id), sel (selected), focus (index of the focused key when selected) }
// slots are 16th notes (4 = quarter note).
// When pieces carry `ref`, invisible tap areas (<rect data-ref>) are added over each column.
// Layers: model.ghosts = [{ measures, color, thin }] are other parts drawn on the same staff (stems
// down, in their colour; thin = see-through); model.layerStyle = { color, thin } styles the main part.

import { spell, signature, vexKeySpec } from './keys.js';
import { DUR } from './rhythm.js';
import { timeInfo, timeOf } from './time.js';

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

function minMeasureWidth(m, withClef, withTime, keyW = 0) {
  return 40 + (withClef ? 46 + keyW : 0) + (withTime ? 26 : 0) + m.reduce((w, p) => w + (p.slots <= 2 ? 24 : 32) + (p.acc ? 8 : 0), 0);
}

const BAR_PICK = 28; // height of the strip of bar numbers

/**
 * Draw the score into `el`. Returns layout info { rows, rowHeight, topPad, scale, pxWidth, pxHeight }.
 * opts.barPicks: draw a tappable number above every bar (on the page only, never in exports).
 * opts (for exports): { width, scale, layout: 'both' | 'notation' | 'tab', colors: { ink, paper, chord } }
 */
export function renderScore(el, model, opts = {}) {
  const VF = window.Vex?.Flow;
  if (!VF) {
    el.innerHTML = '<p class="hint">Notation engine did not load (are you offline on first launch?).</p>';
    return null;
  }
  const { Renderer, Stave, TabStave, StaveNote, TabNote, GhostNote, Voice, Formatter, Accidental,
    StaveConnector, Dot, Beam, StaveTie, Annotation, Fraction } = VF;
  const { measures, meter = 4, header = '' } = model;
  const time = timeInfo(timeOf({ meter, time: model.time }));
  const ghosts = (model.ghosts || []).filter((g) => g.measures?.length);
  const mainStyle = model.layerStyle || null;
  const fifths = model.keyFifths || 0;
  const keyW = Math.abs(fifths) * 10 + (fifths ? 6 : 0);
  const layout = opts.layout || 'both';
  const showStaff = layout !== 'tab';
  const showTab = layout !== 'notation';
  const TOP_PAD = header ? 40 : 28; // room for chord names above high notes in the first row
  const ROW_H = layout === 'both' ? ROW_HEIGHT : layout === 'notation' ? 150 : 165;
  const TAB_Y = layout === 'both' ? TAB_OFFSET : 26;

  const ink = opts.colors?.ink || cssVar('--ink', '#2b1d14');
  const paper = opts.colors?.paper || cssVar('--page', '#f3e3bf');
  const live = cssVar('--seal', '#9e1b1b');
  const chordInk = opts.colors?.chord || cssVar('--burgundy', '#7a1f2b');
  const selInk = cssVar('--sel-ink', '#a5541a');
  const hits = [];   // { x0, x1, y0, y1, ref }
  const bands = [];  // selected columns to highlight

  el.innerHTML = '';
  const pxWidth = Math.max(280, Math.floor(opts.width || el.clientWidth));

  // lay bars out into rows by how much room each needs
  const rows = [];
  let row = [], used = 0;
  // a bar needs room for the busiest layer in it
  const needOf = (i, first) => Math.max(minMeasureWidth(measures[i], first, i === 0, keyW),
    ...ghosts.map((g) => (g.measures[i] ? minMeasureWidth(g.measures[i], first, i === 0, keyW) : 0)));
  // a bar too long for the page (17/8 on a phone): draw everything a little smaller so it still fits
  const widest = Math.max(0, ...measures.map((_, i) => needOf(i, true)));
  const scale = Math.max(0.4, Math.min(opts.scale || (pxWidth < 560 ? 1.1 : 1.3), pxWidth / (widest + 16)));
  const width = pxWidth / scale;
  const usable = width - 16;
  measures.forEach((m, i) => {
    const need = needOf(i, row.length === 0);
    if (row.length && used + need > usable) { rows.push(row); row = []; used = 0; }
    row.push({ m, i, need: needOf(i, row.length === 0) });
    used += row[row.length - 1].need;
  });
  if (row.length) rows.push(row);

  // a row with very high notes (many ledger lines) gets extra room above it, so it doesn't overlap the row above
  const rowExtra = rows.map((r) => {
    let hi = 0;
    for (const c of r) for (const p of [...c.m, ...ghosts.flatMap((g) => g.measures[c.i] || [])]) if (!p.rest && p.keys?.length) hi = Math.max(hi, ...p.keys);
    const written = hi + 12; // guitar is written an octave up
    return showStaff ? Math.max(0, Math.ceil((written - 84) * 3.2) + (written > 84 ? 14 : 0)) : 0;
  });
  if (opts.barPicks) rows.forEach((_, i) => { rowExtra[i] += BAR_PICK; }); // room for the bar numbers
  const bars = []; // { i, x, w, y (number strip), y0, y1 }
  const rowStarts = [TOP_PAD];
  rows.forEach((_, i) => rowStarts.push(rowStarts[i] + rowExtra[i] + ROW_H));
  const pxHeight = Math.ceil((rowStarts[rows.length] + 10) * scale);
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(pxWidth, pxHeight);
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

  const chordMark = (p) => {
    const a = new Annotation(p.chord);
    try { a.setFont('Times New Roman', 13, 'bold', 'italic'); } catch { /* older API */ }
    a.setVerticalJustification(Annotation.VerticalJustify.TOP);
    a.setStyle?.({ fillStyle: chordInk, strokeStyle: chordInk });
    return a;
  };

  const order = []; // every drawn StaveNote in time order, with its row, for ties
  const ghostOrder = ghosts.map(() => []);
  // an SVG group per layer, so the page's CSS can make it bold or see-through
  const group = (cls, color, fade = 0.45) => {
    const g = ctx.openGroup?.();
    if (g?.setAttribute) { g.setAttribute('class', cls); g.style?.setProperty('--layer', color); g.style?.setProperty('--fade', String(fade)); }
    return g;
  };
  const styleOf = (L) => `layer ${L.thin ? 'thin' : 'bold'}`;

  rows.forEach((r, rowIdx) => {
    const total = r.reduce((s, c) => s + c.need, 0);
    const extra = (usable - total) / r.length;
    let x = 8;
    const y = rowStarts[rowIdx] + rowExtra[rowIdx];
    r.forEach((cell, col) => {
      const w = cell.need + Math.max(0, extra);
      const stave = showStaff ? new Stave(x, y, w) : null;
      const tab = showTab ? new TabStave(x, y + TAB_Y, w) : null;
      if (col === 0) {
        stave?.addClef('treble', 'default', '8vb'); tab?.addClef('tab');
        if (fifths) stave?.addKeySignature(vexKeySpec(fifths));
      }
      if (cell.i === 0) stave?.addTimeSignature(`${time.num}/${time.den}`);
      if (typeof Stave.formatBegModifiers === 'function') Stave.formatBegModifiers([stave, tab].filter(Boolean));
      stave?.setContext(ctx).draw();
      tab?.setContext(ctx).draw();
      const top = stave || tab, bottom = tab || stave;
      const left = new StaveConnector(top, bottom);
      left.setType(StaveConnector.type.SINGLE_LEFT);
      left.setContext(ctx).draw();
      if (col === r.length - 1) {
        const right = new StaveConnector(top, bottom);
        right.setType(cell.i === measures.length - 1 ? StaveConnector.type.BOLD_DOUBLE_RIGHT : StaveConnector.type.SINGLE_RIGHT);
        right.setContext(ctx).draw();
      }

      const staffNotes = [], tabNotes = [];
      const sig = signature(fifths);
      const inBar = new Map(); // `${letter}${octave}` → alter currently in force in this bar
      cell.m.forEach((p) => {
        const [dur, dots] = DUR[p.slots] || ['q', 0];
        let sn = null, tn = null;
        const isRest = p.rest || !p.keys?.length;
        if (showStaff) {
          if (isRest) {
            sn = new StaveNote({ keys: ['b/4'], duration: dur, dots, type: 'r' });
          } else {
            const sp = p.keys.map((m) => spell(m + 12, fifths)); // guitar is written an octave up
            sn = new StaveNote({ keys: sp.map((x) => `${x.letter.toLowerCase()}${x.alter === 1 ? '#' : x.alter === -1 ? 'b' : ''}/${x.octave}`), duration: dur, dots,
              ...(ghosts.length ? { stem_direction: 1 } : { auto_stem: true }) }); // with other layers: stems up, theirs down
            sp.forEach((x, idx) => {
              const where = `${x.letter}${x.octave}`;
              const current = inBar.has(where) ? inBar.get(where) : sig[x.letter];
              if (x.alter !== current && !p.tieFromPrev) sn.addModifier(new Accidental(x.alter === 1 ? '#' : x.alter === -1 ? 'b' : 'n'), idx);
              inBar.set(where, x.alter);
            });
          }
        }
        if (showTab) {
          if (isRest || p.tieFromPrev) {
            tn = new GhostNote({ duration: dur, dots });
          } else {
            const positions = p.positions?.length ? p.positions.filter(Boolean) : [];
            const struct = { positions: positions.length ? positions : [{ str: 6, fret: 'x' }], duration: dur, dots, stem_direction: -1 };
            tn = new TabNote(struct, !showStaff); // tab-only: show the rhythm with stems
          }
        }
        if (!isRest) {
          if (p.chord && !p.tieFromPrev) {
            if (sn) sn.addModifier(chordMark(p), 0);
            else if (tn && !(tn instanceof GhostNote)) { try { tn.addModifier(chordMark(p), 0); } catch { /* no annotation */ } }
          }
          const paint = (style) => { sn?.setStyle(style); tn?.setStyle?.(style); };
          if (mainStyle && sn) sn.setStyle({ fillStyle: mainStyle.color, strokeStyle: mainStyle.color });
          if (p.live) paint({ fillStyle: live, strokeStyle: live });
          if (p.sel) {
            paint({ fillStyle: selInk, strokeStyle: selInk });
            if (sn && p.focus !== undefined && p.keys.length > 1) {
              try { sn.setKeyStyle(p.focus, { fillStyle: live, strokeStyle: live }); } catch { /* older API */ }
            }
          }
          if (sn) order.push({ sn, row: rowIdx, piece: p });
        } else if (p.sel && sn) {
          sn.setStyle({ fillStyle: selInk, strokeStyle: selInk });
        }
        if (dots && sn) Dot.buildAndAttach([sn], { all: true });
        if (sn) staffNotes.push(sn);
        if (tn) tabNotes.push(tn);
      });

      // the other layers in this bar: their own voices on the same staff
      const gv = [];
      if (showStaff) ghosts.forEach((g, gi) => {
        const gNotes = [];
        const gInBar = new Map();
        (g.measures[cell.i] || time.rests.map((slots) => ({ slots, rest: true }))).forEach((p) => {
          const [dur, dots] = DUR[p.slots] || ['q', 0];
          if (p.rest || !p.keys?.length) { gNotes.push(new GhostNote({ duration: dur, dots })); return; }
          const sp = p.keys.map((m) => spell(m + 12, fifths));
          const n = new StaveNote({ keys: sp.map((x) => `${x.letter.toLowerCase()}${x.alter === 1 ? '#' : x.alter === -1 ? 'b' : ''}/${x.octave}`), duration: dur, dots, stem_direction: -1 });
          sp.forEach((x, idx) => {
            const where = `${x.letter}${x.octave}`;
            const current = gInBar.has(where) ? gInBar.get(where) : sig[x.letter];
            if (x.alter !== current && !p.tieFromPrev) n.addModifier(new Accidental(x.alter === 1 ? '#' : x.alter === -1 ? 'b' : 'n'), idx);
            gInBar.set(where, x.alter);
          });
          n.setStyle({ fillStyle: g.color, strokeStyle: g.color });
          if (dots) Dot.buildAndAttach([n], { all: true });
          gNotes.push(n);
          ghostOrder[gi].push({ sn: n, row: rowIdx, piece: p });
        });
        let gBeams = [];
        try {
          gBeams = Beam.generateBeams(gNotes, { groups: time.grouped ? time.groups.map((n) => new Fraction(n, 16)) : [new Fraction(1, 4)], beam_rests: false, maintain_stem_directions: true })
            .filter((b) => b.getNotes().every((x) => x instanceof StaveNote));
        } catch { gBeams = []; }
        gv.push({ v: new Voice({ num_beats: time.num, beat_value: time.den }).setStrict(false).addTickables(gNotes), g, beams: gBeams });
      });

      const voices = [];
      const nv = showStaff ? new Voice({ num_beats: time.num, beat_value: time.den }).setStrict(false).addTickables(staffNotes) : null;
      const tv = showTab ? new Voice({ num_beats: time.num, beat_value: time.den }).setStrict(false).addTickables(tabNotes) : null;
      const fmt = new Formatter();
      if (nv) { fmt.joinVoices([nv, ...gv.map((x) => x.v)]); voices.push(nv, ...gv.map((x) => x.v)); }
      if (tv) { fmt.joinVoices([tv]); voices.push(tv); }
      let beams = [];
      if (showStaff) {
        try {
          beams = Beam.generateBeams(staffNotes, { groups: time.grouped ? time.groups.map((n) => new Fraction(n, 16)) : [new Fraction(1, 4)], beam_rests: false, maintain_stem_directions: ghosts.length > 0 });
        } catch { beams = []; }
      }
      const ref = stave || tab;
      const formatWidth = Math.max(40, ref.getNoteEndX() - ref.getNoteStartX() - 10);
      fmt.format(voices, formatWidth);
      for (const x of gv) { // other layers first, so the main one sits on top
        group(styleOf(x.g), x.g.color, x.g.fade);
        x.v.draw(ctx, stave);
        x.beams.forEach((b) => b.setContext(ctx).draw());
        ctx.closeGroup?.();
      }
      if (mainStyle) group(styleOf(mainStyle), mainStyle.color, mainStyle.fade);
      nv?.draw(ctx, stave);
      beams.forEach((b) => b.setContext(ctx).draw());
      if (mainStyle) ctx.closeGroup?.();
      tv?.draw(ctx, tab);

      // tap areas: each column runs halfway to its neighbours, covering staff + tab
      const notesForX = showStaff ? staffNotes : tabNotes;
      const centers = notesForX.map((n) => {
        try { return n.getAbsoluteX() + 7; } catch { return null; }
      });
      const leftEdge = ref.getNoteStartX() - 4, rightEdge = x + w;
      cell.m.forEach((p, j) => {
        if (p.ref === undefined || centers[j] === null) return;
        const x0 = j === 0 ? leftEdge : (centers[j - 1] + centers[j]) / 2;
        const x1 = j === cell.m.length - 1 ? rightEdge : (centers[j] + centers[j + 1]) / 2;
        const hit = { x0, x1, y0: y - 6, y1: y + ROW_H - 18, ref: p.ref, label: p.label, sel: !!p.sel };
        hits.push(hit);
        if (p.sel) bands.push(hit);
      });
      if (opts.barPicks) bars.push({ i: cell.i, x, w, y: rowStarts[rowIdx], y0: y - 6, y1: y + ROW_H - 18 });
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

  // the other layers' ties, in their colours
  ghostOrder.forEach((list, gi) => {
    if (!list.length) return;
    group(`${styleOf(ghosts[gi])} layer-ties`, ghosts[gi].color, ghosts[gi].fade);
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (!a.piece.tieToNext || !b.piece.tieFromPrev) continue;
      const idx = a.piece.keys.map((_, k) => k);
      try {
        if (a.row === b.row) new StaveTie({ first_note: a.sn, last_note: b.sn, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        else {
          new StaveTie({ first_note: a.sn, last_note: null, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
          new StaveTie({ first_note: null, last_note: b.sn, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        }
      } catch { /* skip */ }
    }
    ctx.closeGroup?.();
  });

  // rowStarts[i] = where row i begins (including its extra room); rowStarts[rows] = the end
  const info = { rows: rows.length, rowHeight: ROW_H, topPad: TOP_PAD, rowStarts, scale, pxWidth, pxHeight };

  // highlight behind the selection, tap areas on top of everything
  const svg = el.querySelector('svg');
  if (!svg) return info;
  if (ghosts.length || mainStyle) { // layer looks, inside the SVG itself so PDFs and images keep them
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = '.layer.thin{opacity:var(--fade,.45)}.layer.thin path{stroke-width:.8px}'
      + '.layer.bold path{stroke:var(--layer);stroke-width:1.6px}.layer-ties path{fill:var(--layer);stroke:var(--layer)}';
    svg.insertBefore(style, svg.firstChild);
  }
  for (const b of bands) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', b.x0 + 1); r.setAttribute('y', b.y0);
    r.setAttribute('width', Math.max(4, b.x1 - b.x0 - 2)); r.setAttribute('height', b.y1 - b.y0);
    r.setAttribute('rx', 6);
    r.setAttribute('class', 'sel-band');
    svg.insertBefore(r, svg.firstChild);
  }
  for (const b of bars) {
    const make = (tag, attrs) => { const n = document.createElementNS(SVG_NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    const shade = make('rect', { x: b.x, y: b.y, width: b.w, height: b.y1 - b.y, class: 'bar-shade' });
    shade.dataset.shade = String(b.i);
    svg.insertBefore(shade, svg.firstChild);
    const g = make('g', { class: 'bar-pick', role: 'button', tabindex: b.i === 0 ? '0' : '-1', 'aria-pressed': 'false', 'aria-label': `Bar ${b.i + 1}: select for looping` });
    g.dataset.bar = String(b.i);
    const label = make('text', { x: b.x + 20, y: b.y + 17, 'text-anchor': 'middle' });
    label.textContent = String(b.i + 1);
    g.append(make('rect', { class: 'bar-strip', x: b.x, y: b.y - 2, width: b.w, height: BAR_PICK }),
      make('rect', { class: 'bar-pill', x: b.x + 4, y: b.y + 2, width: 32, height: 21, rx: 10 }), label);
    svg.appendChild(g);
  }
  // keyboard + screen readers: one labelled, focusable target per note (roving tabindex)
  const labelled = new Set();
  let hasTabStop = false;
  for (const h of hits) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', h.x0); r.setAttribute('y', h.y0);
    r.setAttribute('width', Math.max(4, h.x1 - h.x0)); r.setAttribute('height', h.y1 - h.y0);
    r.setAttribute('class', 'hit');
    r.dataset.ref = String(h.ref);
    if (h.label && !labelled.has(h.ref)) {
      labelled.add(h.ref);
      r.setAttribute('role', 'button');
      r.setAttribute('aria-label', h.label);
      r.setAttribute('tabindex', h.sel && !hasTabStop ? '0' : '-1');
      if (h.sel) hasTabStop = true;
    } else {
      r.setAttribute('aria-hidden', 'true'); // tied continuation, or a preview note
    }
    svg.appendChild(r);
  }
  if (labelled.size) {
    if (!hasTabStop) svg.querySelector('.hit[role="button"]')?.setAttribute('tabindex', '0');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', model.label || 'Manuscript');
  }
  return info;
}
