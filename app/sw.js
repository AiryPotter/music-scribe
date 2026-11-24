// Music Scribe service worker: keeps the app working offline once loaded.
const CACHE = 'music-scribe-m4-v36';
const SHELL = [
  './vendor/vexflow.js',
  './ios/',
  './manifest-ios.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/edits.js',
  './js/pluck.js',
  './js/player.js',
  './js/takes.js',
  './js/fixlog.js',
  './js/keys.js',
  './js/tuner.js',
  './js/exporters.js',
  './js/pages.js',
  './js/gp.js',
  './js/dropbox.js',
  './js/dropfolder.js',
  './js/exportui.js',
  './js/bugreport.js',
  './js/jam.js',
  './js/time.js',
  './js/sounds.js',
  './404.html',
  './dropbox.html',
  './js/recorder.js',
  './js/capture-worklet.js',
  './js/metronome.js',
  './js/transcribe.js',
  './js/transcribe-worker.js',
  './js/notes-post.js',
  './js/rhythm.js',
  './js/chords.js',
  './model/model.json',
  './model/group1-shard1of1.bin',
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/audio.js',
  './js/pitch.js',
  './js/tracker.js',
  './js/guitar.js',
  './js/score.js',
  './js/mozart.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up), falling back to the saved copy when offline, or when the
// website answers with an error (e.g. a 404 while the site is briefly unpublished): the app on
// the phone keeps working instead of showing the host's error page.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(async (res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }
        if (res.status >= 400) return (await caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) || res;
        return res;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' })) || Response.error())
  );
});
