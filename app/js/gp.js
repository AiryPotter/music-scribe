// Guitar Pro (.gp, Guitar Pro 7/8 format), written by alphaTab (open source, MPL-2.0).
// alphaTab is large, so it's only downloaded the first time someone exports to Guitar Pro.

const AT_URL = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.6.0/dist/alphaTab.min.js';
let loading = null;

function loadAlphaTab() {
  if (window.alphaTab?.exporter) return Promise.resolve(window.alphaTab);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = AT_URL;
    s.async = true;
    s.onload = () => (window.alphaTab?.exporter ? resolve(window.alphaTab) : reject(new Error('The Guitar Pro writer didn’t load properly.')));
    s.onerror = () => { loading = null; reject(new Error('Couldn’t download the Guitar Pro writer. Are you offline? MusicXML opens in Guitar Pro too.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** MusicXML (from exporters.js) → Guitar Pro file, keeping tuning, capo, tempo and chords. */
export async function toGuitarPro(musicXml, song) {
  const at = await loadAlphaTab();
  const settings = new at.Settings();
  const bytes = new Uint8Array(await musicXml.arrayBuffer());
  const score = at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
  if (song.title) score.title = song.title;
  if (song.composer) { score.artist = song.composer; score.music = song.composer; }
  score.tempo = Math.round(song.bpm);
  const out = new at.exporter.Gp7Exporter().export(score, settings);
  return new Blob([out], { type: 'application/x-guitar-pro' });
}
