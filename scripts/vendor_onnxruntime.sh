#!/bin/sh
# Downloads the pinned onnxruntime-web runtime used by web/js/infer.js.
#
# task.md's infer.js imports onnxruntime-web from an unpinned jsdelivr CDN
# URL (dist/esm/ort.min.js), which currently resolves to 1.18.0. That's
# fine online, but it breaks the offline demo: AD-10's service worker
# PRECACHE list never includes it, so a real "zero signal" reload has
# nothing to serve the runtime from -- a cross-origin fetch to a CDN
# fails outright when the network is down, regardless of ordinary HTTP
# disk-cache freshness. Vendoring the exact files locally and precaching
# them fixes this for real instead of hoping browser cache heuristics
# cover it during a demo.
#
# The wasm binary is ~10MB, so it's fetched by this script rather than
# committed to git. Unlike models/lr.joblib and the exported *.onnx files
# (small, so committed directly for deployability -- see .gitignore),
# this one is large enough that keeping it out of `main` is worth the
# extra step; CI fetches it fresh before publishing to gh-pages.
set -e
cd "$(dirname "$0")/.."
mkdir -p web/js/vendor
curl -sL -o web/js/vendor/ort.min.js \
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/esm/ort.min.js"
curl -sL -o web/js/vendor/ort-wasm-simd.wasm \
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort-wasm-simd.wasm"
echo "Vendored onnxruntime-web 1.18.0 into web/js/vendor/"
ls -la web/js/vendor/
