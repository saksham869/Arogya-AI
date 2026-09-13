# task.md — ArogyaAI

Execute **one phase at a time**. Each phase ends with a hard STOP.

> **STOP means stop.** Do not begin the next phase until the user types
> `approved` or `continue`. Report the phase's verification evidence and wait.
> This is not a formality — the user is checking real numbers at each gate.

Legend: `[ ]` not started · `[~]` in progress · `[x]` verified complete

---

## PHASE 0 — Scaffold · ~30 min

- [ ] 0.1 Create the directory tree exactly as in AD-7 (knowledge item 02)
- [ ] 0.2 Write `requirements.txt` with the fixed technology list only
- [ ] 0.3 Write `.gitignore`: `.venv/`, `__pycache__/`, `data/raw/`, `*.onnx`, `.env`, `results/`
- [ ] 0.4 Add `__init__.py` to every package directory under `src/`
- [ ] 0.5 Write `tests/test_smoke.py` with one trivial passing test
- [ ] 0.6 `git init` and commit as `chore: scaffold`

**Verify:** run `pytest -q`. Paste the output. Expect `1 passed`.

### ⛔ STOP — Phase 0. Await approval.

---

## PHASE 1 — Data pipeline · ~1.5 h

Input is `data/raw/dataset.csv`, the Kaggle *Disease Symptom Prediction* set
(itachi9604). Wide format: `Disease` plus `Symptom_1..Symptom_17`, one symptom
name per cell, blanks where absent.

- [ ] 1.1 Write `src/preprocessing/dedupe.py`
- [ ] 1.2 Load raw CSV, record exact row count
- [ ] 1.3 Normalise symptom names: strip whitespace, lowercase, spaces → underscores
- [ ] 1.4 Pivot wide → binary matrix, one column per unique symptom
- [ ] 1.5 Drop exact duplicates on (symptom vector + disease) together
- [ ] 1.6 Write `data/processed/clean.csv`
- [ ] 1.7 Write `data/processed/data_manifest.json` per the plan's §2.1 schema
- [ ] 1.8 Write `web/data/symptoms.json` — the ordered symptom list for the UI
- [ ] 1.9 Print: `N -> M rows (K duplicates removed), S symptoms, D diseases`
- [ ] 1.10 Write `tests/test_dedupe.py`: no duplicates remain; manifest counts self-consistent

**Verify:** run it. Paste the printed summary and the manifest contents.

> **This is the project's headline finding.** Write the before/after numbers down
> — they appear in the demo, the README, and the paper.

### ⛔ STOP — Phase 1. Await approval.

---

## PHASE 2 — Train and evaluate · ~2 h

- [ ] 2.1 Write `src/models/train.py`
- [ ] 2.2 Load `clean.csv`; features = binary symptom columns; target = disease
- [ ] 2.3 Stratified 80/20 split, `random_state=42`, **after** de-duplication
- [ ] 2.4 Train `LogisticRegression(max_iter=1000)` — primary per AD-1
- [ ] 2.5 Train `RandomForestClassifier(n_estimators=100)` — baseline
- [ ] 2.6 Train `GradientBoostingClassifier()` — baseline
- [ ] 2.7 For each: top-1, top-3, macro precision, macro recall, macro F1
- [ ] 2.8 5-fold cross-validation on the training portion, LR only
- [ ] 2.9 Print a markdown table; save to `results/metrics.md` with the manifest counts and today's date in the header
- [ ] 2.10 Save LR model and training-set feature means to `models/lr.joblib`

**Do not tune toward a target number.** Report what comes out. 55–75% is the
expected range, and published symptom-checker accuracy sits at 34–65%, so
anything in that band is at or above the state of the art.

**Verify:** paste the metrics table.

> ⚠️ **If Random Forest beats Logistic Regression materially, STOP and tell the
> user.** AD-1, AD-3 and AD-4 all change and Phase 3 must be replanned.

### ⛔ STOP — Phase 2. Await approval.

---

## PHASE 3 — ONNX export · ~1.5 h

- [ ] 3.1 Write `scripts/export_onnx.py`
- [ ] 3.2 Load `models/lr.joblib`
- [ ] 3.3 Convert via `skl2onnx` with `zipmap=False` (AD-3 — mandatory)
- [ ] 3.4 Write `web/models/arogya.onnx` and a `gzip -9` copy `arogya.onnx.gz`
- [ ] 3.5 Write `web/data/attributions.json` per plan §2.2, honouring the feature-order contract
- [ ] 3.6 Assert: ONNX labels exactly match sklearn labels on the full test set
- [ ] 3.7 Assert: probability max difference < 1e-4
- [ ] 3.8 Print PASS/FAIL for each assertion and the raw and gzipped sizes in KB
- [ ] 3.9 Write `tests/test_onnx_parity.py` covering 3.6 and 3.7

**Verify:** paste both PASS lines and both file sizes.

> ⚠️ **If either assertion fails, STOP.** The entire offline capability depends
> on this. Do not proceed to Phase 6.

### ⛔ STOP — Phase 3. Await approval.

---

## PHASE 4 — Red-flag engine · ~2 h

Read safety constraints S4 and S5 before starting.

- [ ] 4.1 Write `src/rules/red_flags.yaml` with the NOT-CLINICALLY-REVIEWED header comment
- [ ] 4.2 Encode 12 rules covering: chest pain with radiation or breathlessness · acute breathlessness · loss of consciousness · stroke signs · severe bleeding · new or prolonged seizure · fever with neck stiffness · fever with rash · sudden worst-ever headache · sudden severe abdominal pain · blood in vomit or black stools · fever in infant under 3 months
- [ ] 4.3 Use only symptom ids present in `web/data/symptoms.json`. Where a needed symptom is absent, add it as a UI-only input and comment it
- [ ] 4.4 Write `src/rules/severity.yaml` mapping every disease label to a baseline tier; unmapped → ROUTINE
- [ ] 4.5 Write `src/rules/engine.py` exposing `evaluate(symptoms, age_years, sex) -> (tier|None, rule_id|None)`, returning on first match
- [ ] 4.6 Write `web/data/red_flags.json` — same rules, for the browser
- [ ] 4.7 Write `tests/test_red_flags.py`: per rule, one firing case and one near-miss that must NOT fire
- [ ] 4.8 Add a test asserting an empty symptom set never fires

**Verify:** `pytest tests/test_red_flags.py -q`. Expect 25+ passing.

### ⛔ STOP — Phase 4. Await approval.

---

## PHASE 5 — FastAPI backend · ~2 h

- [ ] 5.1 Write `src/api/schemas.py` — Pydantic request and response models per plan §2.4
- [ ] 5.2 Write `src/api/main.py`
- [ ] 5.3 `POST /predict` in this exact order: red-flag engine → if fired, return EMERGENCY and **do not call the model** → else build vector → ONNX inference → severity map → `max()` → SHAP closed form → top 5 present contributors
- [ ] 5.4 `GET /health` returning status, model version, disease count
- [ ] 5.5 Disclaimer string on every response (S3, S7)
- [ ] 5.6 Write `tests/test_api.py`: red-flag case returns `tier_source: "red_flag"`; normal case returns 3 differentials; **no response field ever contains a medication name**

**Verify:** paste the actual `curl` command and real JSON response for both a
red-flag case and a normal case.

### ⛔ STOP — Phase 5. Await approval.

---

## PHASE 6 — PWA frontend · ~4 h

Four sub-phases. **Verify after each. Do not batch them.**

### 6a — Structure and styling
- [ ] 6a.1 `web/index.html`: language toggle, searchable symptom multi-select from `symptoms.json`, age input, sex select, Assess button, empty results area
- [ ] 6a.2 Inline CSS, mobile-first, large touch targets, no framework (AD-7)
- [ ] 6a.3 No JS logic yet

**Verify:** screenshot of the rendered empty form.

### 6b — Inference
- [ ] 6b.1 `web/js/infer.js`: load `arogya.onnx` via onnxruntime-web and `attributions.json`
- [ ] 6b.2 Check `red_flags.json` **before** inference (S4)
- [ ] 6b.3 Build the feature vector in the contract order (plan §2.2)
- [ ] 6b.4 Run with input name `float_input`
- [ ] 6b.5 SHAP: `phi_i = coef[ci][i] * (x_i - mean_i)` (AD-4). Do not import the shap library
- [ ] 6b.6 Return `{ tier, tierSource, ruleId, disease, probability, top3, topContributors }`

**Verify:** screenshot of the browser console showing a returned object.

### 6c — Rendering
- [ ] 6c.1 `web/js/render.js` + `web/js/app.js` wiring
- [ ] 6c.2 Triage banner: red EMERGENCY, amber URGENT, green ROUTINE
- [ ] 6c.3 Explanation as plain sentences — "Because you reported fever and headache"
- [ ] 6c.4 Top-3 differential with probability bars
- [ ] 6c.5 Disclaimer always visible (S7)
- [ ] 6c.6 When `tierSource === "red_flag"`: show the rationale, **suppress the differential**
- [ ] 6c.7 Bilingual strings object keyed `en`/`hi`

**Verify:** two screenshots — one red-flag result, one normal result.

### 6d — Offline
- [ ] 6d.1 `web/sw.js`: cache-first, precaching index.html, all js, arogya.onnx, attributions.json, symptoms.json, red_flags.json
- [ ] 6d.2 Register from index.html
- [ ] 6d.3 Visible online/offline indicator in the header

**Verify:** screenshot of a working prediction **with DevTools network set to
offline**. This is the demo centrepiece.

### ⛔ STOP — Phase 6. Await approval.

---

## PHASE 7 — Vignettes, README, demo · ~2.5 h

- [ ] 7.1 `vignettes/vignettes.csv`: 12 cases — `id, description, symptoms, age_years, sex, expected_tier`. 4 true emergencies across different rules; 8 non-emergencies including 2 designed to tempt over-triage
- [ ] 7.2 `scripts/run_vignettes.py`: POST each to `/predict`, compare tier, print per-case table, **emergency recall**, over-triage rate, 3×3 confusion matrix; save to `results/vignettes.md`
- [ ] 7.3 `README.md`: what this is and is not · honest accuracy with de-dup counts · vignette results · **red flags NOT clinically reviewed** (H4) · CDSCO position · setup and run · architecture decisions with one-line reasons
- [ ] 7.4 Final check against the five demo-ready criteria in knowledge item 03

**Verify:** paste `results/vignettes.md`.

Benchmarks (Sutaria et al., 2025):

| Measure | Symptom checkers | Physicians |
|---|---|---|
| Emergency recall | 76.9% (52–93%) | 85.7% |
| Red-flag coverage | 36.9% | 71.8% |
| Specificity | 83.3% | 91.9% |

Our red-flag layer should score near 100% on the rules it encodes — that is the
whole point of encoding them. Report over-triage rate alongside recall; a system
that escalates everything looks perfect on recall and is useless.

### ⛔ STOP — Phase 7. Project complete.
