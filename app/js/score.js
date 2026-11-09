// Draws notes as standard notation (treble 8vb) with tablature underneath, using VexFlow.

import { vexKey } from './guitar.js';

const BEATS = 4;
const ROW_HEIGHT = 230;
const TAB_OFFSET = 100;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function renderScore(el, notes, { liveNote = null } = {}) {
  const VF = window.Vex?.Flow;
  if (!VF) {
    el.innerHTML = '<p class="hint">Notation engine did not load (are you offline on first launch?).</p>';
    return;
  }
  const { Renderer, Stave, TabStave, StaveNote, TabNote, GhostNote, Voice, Formatter, Accidental, StaveConnector } = VF;

  const ink = cssVar('--ink', '#2b1d14');
  const paper = cssVar('--page', '#f3e3bf');
  const live = cssVar('--seal', '#9e1b1b');

  el.innerHTML = '';
  const pxWidth = Math.max(280, Math.floor(el.clientWidth));
  const scale = pxWidth < 560 ? 1.1 : 1.3;        // draw notation larger than VexFlow's default
  const width = pxWidth / scale;                   // layout in unscaled units
  const perRow = width < 480 ? 1 : width < 820 ? 2 : 3;

  const measures = [];
  for (let i = 0; i < notes.length; i += BEATS) measures.push(notes.slice(i, i + BEATS));
  if (!measures.length) measures.push([]);

  const rows = Math.ceil(measures.length / perRow);
  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(pxWidth, Math.ceil((rows * ROW_HEIGHT + 10) * scale));
  const ctx = renderer.getContext();
  ctx.scale(scale, scale);
  ctx.setFillStyle(ink);
  ctx.setStrokeStyle(ink);
  if (ctx.setBackgroundFillStyle) ctx.setBackgroundFillStyle(paper);

  const usable = width - 16;
  const mw = usable / perRow;

  measures.forEach((mNotes, idx) => {
    const row = Math.floor(idx / perRow);
    const col = idx % perRow;
    const x = 8 + col * mw;
    const y = 4 + row * ROW_HEIGHT;

    const stave = new Stave(x, y, mw);
    const tab = new TabStave(x, y + TAB_OFFSET, mw);
    if (col === 0) {
      stave.addClef('treble', 'default', '8vb');
      tab.addClef('tab');
    }
    if (idx === 0) stave.addTimeSignature('4/4');
    if (typeof Stave.formatBegModifiers === 'function') Stave.formatBegModifiers([stave, tab]);
    stave.setContext(ctx).draw();
    tab.setContext(ctx).draw();

    if (col === 0) {
      const c = new StaveConnector(stave, tab);
      c.setType(StaveConnector.type.SINGLE_LEFT);
      c.setContext(ctx).draw();
    }
    if (col === perRow - 1 || idx === measures.length - 1) {
      const c = new StaveConnector(stave, tab);
      c.setType(StaveConnector.type.SINGLE_RIGHT);
      c.setContext(ctx).draw();
    }

    const staffNotes = [];
    const tabNotes = [];
    mNotes.forEach((n) => {
      const k = vexKey(n.midi);
      const sn = new StaveNote({ keys: [k.key], duration: 'q', auto_stem: true });
      if (k.sharp) sn.addModifier(new Accidental('#'), 0);
      const tn = new TabNote({
        positions: [n.pos ? { str: n.pos.string, fret: String(n.pos.fret) } : { str: 6, fret: 'x' }],
        duration: 'q',
      });
      if (n === liveNote) {
        sn.setStyle({ fillStyle: live, strokeStyle: live });
        tn.setStyle({ fillStyle: live, strokeStyle: live });
      }
      staffNotes.push(sn);
      tabNotes.push(tn);
    });

    if (mNotes.length === 0) {
      staffNotes.push(new StaveNote({ keys: ['b/4'], duration: 'wr' }));
      tabNotes.push(new GhostNote({ duration: 'w' }));
    } else {
      for (let i = mNotes.length; i < BEATS; i++) {
        staffNotes.push(new StaveNote({ keys: ['b/4'], duration: 'qr' }));
        tabNotes.push(new GhostNote({ duration: 'q' }));
      }
    }

    const nv = new Voice({ num_beats: BEATS, beat_value: 4 }).addTickables(staffNotes);
    const tv = new Voice({ num_beats: BEATS, beat_value: 4 }).addTickables(tabNotes);
    const formatWidth = Math.max(40, stave.getNoteEndX() - stave.getNoteStartX() - 12);
    new Formatter().joinVoices([nv]).joinVoices([tv]).format([nv, tv], formatWidth);
    nv.draw(ctx, stave);
    tv.draw(ctx, tab);
  });
}
