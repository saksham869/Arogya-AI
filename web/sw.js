const CACHE_VERSION = 'v4'; // v4: 6-B6 adds phc_ghaziabad.json
const CACHE_NAME = `arogya-${CACHE_VERSION}`;

// AD-10's list plus two additions, both disclosed:
//  - './' alongside './index.html': a navigation to the site root is a
//    request for '/', which does not cache-match the key './index.html'
//    even though a plain static server serves the same file for both --
//    without this, reloading offline at "/" (how every real visit starts)
//    would miss the cache entirely.
//  - './js/strings.js' and the vendored onnxruntime-web runtime
//    (./js/vendor/*): both postdate when AD-10 was written -- strings.js
//    didn't exist yet, and the original plan imported the ONNX runtime
//    from a CDN URL that was never going to survive being offline at all
//    (see the note in infer.js / scripts/vendor_onnxruntime.sh).
const PRECACHE = [
  './',
  './index.html',
  './js/infer.js', './js/render.js', './js/app.js', './js/strings.js',
  './js/vendor/ort.min.js', './js/vendor/ort-wasm-simd.wasm',
  './models/arogya.onnx',
  './data/attributions.json',
  './data/symptoms.json',
  './data/red_flags.json',
  './data/severity.json',
  './data/cooccurrence.json',            // Tier B, 6-B3
  './data/symptom_descriptions.json',    // Tier B, 6-B5
  './data/phc_ghaziabad.json',           // Tier B, 6-B6
  // Add when built:
  // './data/condition_info.json',       // Tier B, 6-B9
  // './data/followups.json',            // Tier C, 6-C2
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first: served instantly offline, refreshed opportunistically online.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
