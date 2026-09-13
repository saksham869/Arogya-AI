# Knowledge Item: Architecture Decisions (SETTLED)

Every decision below was **tested and verified**, not assumed. Do not revisit
them, do not "improve" them, and do not substitute a more familiar library.
If you believe one is wrong, stop and raise it with the user.

---

## AD-1 — Logistic Regression is the primary model

Random Forest and Gradient Boosting are trained as **reported baselines only**.
They are not shipped.

Evidence from a verified spike on 377 symptoms / 120 diseases / 7,054
de-duplicated rows:

| Model | Top-1 | ONNX raw | ONNX gzipped |
|---|---|---|---|
| RF, 100 trees | 0.9766 | 154.32 MB | 1.08 MB |
| **Logistic Regression** | **0.9809** | **0.23 MB** | **0.19 MB** |

A 154 MB model cannot be delivered over a rural connection. Depth-limiting the
forest loses accuracy faster than it saves bytes (100 trees at depth 12 → 0.8498
and still 10 MB).

**Caveat the agent must respect:** the spike used synthetic data generated from
additive symptom signatures, which structurally favours linear models. Phase 2
trains all three on the real dataset. If Random Forest wins materially on real
data, **stop and tell the user** — AD-3 and AD-4 both change.

## AD-2 — ONNX, never TensorFlow Lite

TFLite converts TensorFlow graphs. It **cannot** convert a scikit-learn
estimator. Any plan routing sklearn → TFLite has no working path.

Use `skl2onnx` → `onnxruntime` (Python) and `onnxruntime-web` (browser).

## AD-3 — `zipmap=False` on every ONNX export

```python
onx = convert_sklearn(
    clf,
    initial_types=[("float_input", FloatTensorType([None, N_FEATURES]))],
    options={type(clf): {"zipmap": False}},   # MANDATORY
    target_opset=12,
)
```

Without this flag, the exported graph contains a `ZipMap` node producing a
sequence-of-map output. ONNX Runtime's JavaScript bindings cannot handle
non-tensor outputs and fail with errors that do not name the cause.

Verified: with the flag, the graph contains exactly one node type
(`TreeEnsembleClassifier` for RF, `LinearClassifier` for LR) and outputs are
`label` and `probabilities`, both plain tensors.

## AD-4 — SHAP by closed form, computed in the browser

For a linear model, SHAP has an exact closed form:

```
phi_i = coef[class_index][i] * (x_i - mean_i)
```

Verified against `shap.LinearExplainer` with a matched background set:
**maximum difference 0.00e+00 — exact, not an approximation.**

Do **not** add the `shap` library to the frontend. It is not needed and has no
browser build. The browser payload is the coefficient matrix plus the
training-set feature mean vector, roughly 186 KB as float32.

Why this matters: `TreeExplainer` on a 120-class Random Forest **failed SHAP's
own additivity check**, and with the check disabled took **6,534 ms per
instance**. The response budget for the whole request is 3,000 ms.

## AD-5 — Red flags are YAML data, not Python code

A clinician must be able to read and edit the rules without reading code. Rules
live in `src/rules/red_flags.yaml` and are loaded at runtime. The engine in
`src/rules/engine.py` contains matching logic only — **no rule content**.

## AD-6 — De-duplicate before splitting, always

Order is fixed: load → build binary matrix → drop exact duplicates → write
manifest → stratified split. Splitting first leaks duplicate rows across the
train/test boundary and inflates every metric.

## AD-7 — No frontend framework

Vanilla HTML, CSS and JavaScript with ES modules. No React, no Vue, no build
step, no bundler. The deliverable must run from a static file server.

---

## Fixed technology list

Python 3.10+ · scikit-learn · skl2onnx · onnx · onnxruntime · shap (training
side only) · pandas · numpy · FastAPI · Uvicorn · Pydantic · PyYAML · pytest ·
httpx · onnxruntime-web

Adding a dependency outside this list requires asking the user first.

---

## Repository layout (fixed)

```
arogyaai/
  data/raw/                 downloaded CSVs, never edited
  data/processed/           clean.csv + data_manifest.json
  src/preprocessing/        dedupe.py
  src/models/               train.py
  src/rules/                red_flags.yaml, severity.yaml, engine.py
  src/api/                  main.py, schemas.py
  scripts/                  export_onnx.py, run_vignettes.py
  web/                      index.html, sw.js
  web/js/                   infer.js, render.js, app.js
  web/models/               arogya.onnx, arogya.onnx.gz
  web/data/                 attributions.json, symptoms.json, red_flags.json
  tests/
  vignettes/                vignettes.csv
  results/                  metrics.md, vignettes.md
```
