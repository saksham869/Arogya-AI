# ArogyaAI

A symptom triage Progressive Web App for rural India. A patient or ASHA
worker enters symptoms in Hindi or English, plus age, sex, and optional
vitals/risk factors. The system returns a triage tier (EMERGENCY / URGENT /
ROUTINE), a ranked differential with a plain-language explanation, and —
on EMERGENCY — the nearest government health centres. It works fully
offline after the first load.

**This is a triage and referral aid, not a diagnostic device.** It is an
academic prototype, evaluated on 12 written vignettes, not real patients.

---

## What this is not

- Not a diagnosis. It never outputs a definitive disease determination,
  only a ranked differential with an explanation.
- Not a medical device, and not clinically validated. India's CDSCO
  guidance names triage as a function that brings software under the
  Medical Devices Rules, 2017 — this project has not gone through that
  process and should not be treated as if it had.
- Not a source of medication or treatment advice. The system has no
  medication data at all; it structurally cannot name a drug (see S1
  below), and never suggests a treatment or home remedy.
- Not clinically reviewed. The 14 red-flag rules in
  `src/rules/red_flags.yaml` were written for this prototype and have not
  been reviewed by a clinician.

---

## The headline finding

The most commonly used public "Disease Symptom Prediction" dataset
(itachi9604 on Kaggle) contains **4,920 rows**. Treating each row's
symptom set as an unordered collection (not a fixed 17-column list) and
dropping exact duplicates of (disease, symptom set) collapses it to
**304 rows — 93.8% of the dataset is exact duplicates.**

```json
"rows_before": 4920,
"rows_after": 304,
"duplicates_removed": 4616
```

Papers and demos reporting 95–99% accuracy on this dataset are, as far as
we can tell, reporting it on the left-hand number. This project trains
and evaluates on the right-hand one, and leads with that fact rather than
burying it.

## Model accuracy — and a second, related honesty finding

`results/metrics.md`, `RepeatedStratifiedKFold(n_splits=5, n_repeats=10)`:

| Model | Top-1 mean±sd | 95% CI | Top-3 | F1 macro |
|---|---|---|---|---|
| Logistic Regression (shipped) | 1.0000±0.0000 | [0.941,1.000] | 1.0000 | 1.0000 |
| Random Forest (baseline) | 1.0000±0.0000 | [0.941,1.000] | 1.0000 | 1.0000 |
| Gradient Boosting (baseline) | 0.8154±0.0400 | [0.724,0.908] | 0.8525 | 0.7527 |

The knowledge docs driving this build expected 85–95% accuracy on the
de-duplicated corpus and flagged anything higher as a possible leakage
bug. We checked: it is not leakage. Every one of the 304 de-duplicated
rows has a **unique** symptom vector, with **zero collisions** across all
41 disease classes — no two diseases in this dataset share an identical
symptom presentation. That is a real, verifiable property of how this
dataset was constructed (each disease has a small, fixed, disjoint
"characteristic" symptom set), not a property of real clinical
presentation, where many diseases share overlapping symptoms like fever
or fatigue. So: **the de-duplicated dataset is easier than real medicine,
not just smaller than the inflated papers.** Logistic Regression ships
over Random Forest per AD-1 (both tie on accuracy here; LR is 813× smaller
once exported); Gradient Boosting is reported only as a baseline.

## ONNX export

`skl2onnx` with `zipmap=False` (AD-3 — without it, `onnxruntime-web`
fails on the ZipMap node's non-tensor output). Verified against sklearn
on the held-out test set:

- Label parity: **0 mismatches / 61** — PASS
- Probability parity: **max diff 3.58e-07** — PASS
- Model size: **29.8 KB raw / 19.9 KB gzipped**

**A caveat on "how small is this app," stated plainly:** the 19.9 KB
figure is the trained model only. Running it in a browser requires the
`onnxruntime-web` inference engine, which is vendored locally at
`web/js/vendor/` (not the CDN import the build docs originally specified —
that would have broken offline entirely, since a cross-origin fetch fails
outright when the network is down, regardless of ordinary browser HTTP
cache). That runtime's WASM binary alone is **~10.1 MB**. It is a one-time
download cached by the service worker, not a per-request cost, but it is
real weight this project's "190 KB, offline" framing does not cover, and
anyone repeating that figure should know what it does and doesn't include.

## Red-flag engine

14 rules in `src/rules/red_flags.yaml`, checked **before** the model on
every request (S4). If a rule fires, the model is never called — verified
by checking the browser's network log on an EMERGENCY result: no request
for the ONNX model or its WASM runtime is made at all. Red flags can only
escalate a tier (S5); nothing in the model path can lower one.

**These rules are not clinically reviewed.** They were written for this
academic prototype and must not be used with real patients without
clinical sign-off (H4).

Why a rule layer at all, rather than trusting the model to notice danger
signs: Sutaria et al. (2025, *BMC Health Services Research* 25:1263) found
that four commercial symptom checkers sought only 36.9% of red-flag
symptoms a physician would ask about (vs. 71.8% for physicians,
p < 0.001), despite similar overall emergency-triage recall. A written
rule fires 100% of the time it's encoded; a learned pattern does not.

## Vignette results

`results/vignettes.md`, 12 hand-written cases, evaluated through the same
Python engine the browser and API both use:

| ID | Expected | Got | Source | Result |
|---|---|---|---|---|
| V01 | EMERGENCY | EMERGENCY | red_flag | ✓ |
| V02 | EMERGENCY | EMERGENCY | red_flag | ✓ |
| V03 | EMERGENCY | EMERGENCY | red_flag | ✓ |
| V04 | EMERGENCY | EMERGENCY | red_flag | ✓ |
| V05 | ROUTINE | ROUTINE | model | ✓ |
| V06 | ROUTINE | ROUTINE | model | ✓ |
| V07 | ROUTINE | ROUTINE | model | ✓ |
| V08 | ROUTINE | **URGENT** | model | ✗ |
| V09 | URGENT | URGENT | model | ✓ |
| V10 | URGENT | URGENT | model | ✓ |
| V11 | URGENT | URGENT | model | ✓ |
| V12 | ROUTINE | **URGENT** | model | ✗ |

**Emergency recall: 4/4 = 100%** (benchmark: commercial checkers 76.9%,
physicians 85.7%). **Over-triage rate: 0%** — nothing that should have
been non-emergency was escalated to EMERGENCY.

The two misses (V08, V12) are both real, inspected model behaviour, not a
bug: both vignettes present a single, non-specific symptom (`stomach_pain`
alone; `high_fever` alone). We checked what the model actually predicted —
`stomach_pain` alone tops out at "Drug Reaction" (10.1% confidence),
`high_fever` alone at "AIDS" (9.4% confidence) — both severity-mapped
URGENT. Two things worth being honest about here: single non-specific
symptoms genuinely are close to uninformative for a 41-way classifier
trained on 304 rows (hence the low confidence — both would display as
**Uncertain**, not **Likely**, in the UI's confidence band), and the
severity map currently applies to whichever class the model ranks first
**regardless of how confident that top rank is**. That is a real
limitation worth flagging for anyone extending this: a low-confidence
top-1 guess can still drive a tier escalation today.

---

## Safety constraints (absolute, no exceptions)

| ID | Rule |
|---|---|
| S1 | Never output a medication name — brand, generic, or dose. The system has no medication data, so this is structural, not just a copy rule. Reminders (F15) say only "Take your medicine." |
| S2 | Never output a treatment plan, dietary plan, or home remedy. |
| S3 | Every result carries a referral recommendation, never a diagnosis. |
| S4 | Red-flag engine runs before the model. If it fires, the model is not called. |
| S5 | Red flags only escalate. No model output can lower a red-flagged case. |
| S6 | Low-confidence is shown as low-confidence (F13's Uncertain band), never hidden or rounded up. |
| S7 | The disclaimer is always visible — never collapsed, never behind a tap. |

## Honesty constraints

| ID | Rule |
|---|---|
| H1 | Report the accuracy actually measured, not a target. Measured: 100% CV (LR/RF) — investigated and explained above, not silently accepted. |
| H2 | Every metric is printed with its CV scheme and de-duplication counts. |
| H3 | If something doesn't work, or a result is surprising, say so. This README states two real limitations (V08/V12, and the ~10 MB WASM runtime) rather than omitting them. |
| H4 | Red-flag rules are not clinically reviewed — stated here, in `red_flags.yaml`'s own header, and in the in-app rule viewer (F11). |

## Regulatory position

India's CDSCO guidance names **triage** as a function that brings software
under the Medical Devices Rules, 2017. This project is an academic
prototype, evaluated on 12 written vignettes only. It has not been
submitted for regulatory review, is not deployed, and is not clinically
validated. It should not be described, offered, or used as if it were.

## Never built (by design)

User accounts with cloud sync, a medication or dosage database, treatment
or dietary plans, telemedicine or doctor-booking integration, or any
transmission of identifiable health data off-device. Everything F1–F20
store (history, profiles, reminders) lives in `localStorage`, on-device
only, and the UI says so (F14).

---

## Features (F1–F20) — all shipped

| # | Feature | Tier |
|---|---|---|
| F1 | Offline inference (service worker, vendored ONNX runtime) | A |
| F2 | Exact closed-form SHAP explanation | A |
| F3 | Red-flag layer before the model | A |
| F4 | Voice input (Hindi/English, Web Speech API) | A |
| F5 | Vitals feed red-flag rules (not the model) | B |
| F6 | Risk-factor panel (gates red-flag rules) | B |
| F7 | Family profiles (up to 4, localStorage) | C |
| F8 | Co-occurrence "Also common" prompts | B |
| F9 | Follow-up questions refine displayed confidence, not the model output | C |
| F10 | "Why ranked lower?" (closed-form, per AD-4) | B |
| F11 | Rule-set viewer ("How does this decide?") | C |
| F12 | Symptom descriptions + "Not sure" (excluded from the feature vector, not from red flags) | B |
| F13 | Confidence bands (Likely/Possible/Uncertain), tap for exact % | C |
| F14 | Assessment history, 5 per profile, on-device only | C |
| F15 | Medicine reminders — nameless, per S1 | C |
| F16 | Symptom trend tracker (advisory only, never changes tier) | C |
| F17 | Nearest PHC locator (Haversine, tap-to-call) | B |
| F18 | Printable result card for the doctor | B |
| F19 | ASHA worker mode (larger text, simplified Hindi tier labels) | B |
| F20 | Condition information cards | B |

## Architecture decisions

| AD | Decision |
|---|---|
| AD-1 | Logistic Regression ships; Random Forest and Gradient Boosting are reported baselines only — LR ties RF on accuracy here at 813× smaller once exported. |
| AD-2 | ONNX, never TensorFlow Lite (TFLite cannot convert sklearn estimators). |
| AD-3 | `zipmap=False` on every ONNX export — mandatory for `onnxruntime-web` to produce plain-tensor output. |
| AD-4 | SHAP by closed form (`coef · (x - mean)`), computed in-browser — exact, not approximated, and doesn't need the `shap` library client-side. |
| AD-5 | Feature vector order is symptoms (131) → age bands (7, one-hot) → sex (1) = 139. Fixed contract between Python and JS. |
| AD-6 / AD-7 | Vitals and risk factors gate red-flag rules only; they never enter the model's feature vector. |
| AD-8 / AD-9 | Red flags and severity live as YAML (clinician-readable), mirrored to JSON for the browser. |
| AD-10 | Service worker cache-first, versioned; bump on **any** precached file's content change, not just when the file list changes (a real fix made mid-build — see commit history). |
| AD-11 | Bilingual content files (symptom descriptions, condition info, PHC list, follow-ups) are agent-generated, verified for exact key coverage against the real class/symptom names, not the "cleaned" example spellings. |
| AD-12 | No frontend framework, no build step — vanilla ES modules, served with `python -m http.server`. |
| AD-13 | De-duplicate before splitting, always — splitting first would leak duplicate rows across train/test. |
| AD-14 | `RepeatedStratifiedKFold` for evaluation — a single 80/20 split on 304 rows is too small to trust a point estimate. |

---

## Repository layout

```
data/raw/                 Kaggle itachi9604 CSV (gitignored, never edited)
data/processed/           clean.csv + data_manifest.json
src/preprocessing/        dedupe.py (Phase 1)
src/models/                train.py (Phase 2)
src/rules/                red_flags.yaml, severity.yaml, engine.py (Phase 4)
scripts/                  export_onnx.py, run_vignettes.py, vendor_onnxruntime.sh
web/                      index.html, sw.js, js/, data/ (Phase 6, the PWA)
web/js/vendor/            onnxruntime-web runtime (gitignored, fetched by scripts/vendor_onnxruntime.sh)
models/                   lr.joblib (gitignored, regenerated by src/models/train.py)
tests/                    pytest suite, 36 tests
vignettes/                vignettes.csv
results/                  metrics.md, vignettes.md (gitignored, regenerated)
```

## Setup

Requires Python 3.10+ (the system default may be older — this project was
built and tested on 3.11).

```bash
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Place the Kaggle *Disease Symptom Prediction* dataset (itachi9604) at
`data/raw/dataset.csv`, then run each phase in order:

```bash
.venv/bin/python -m src.preprocessing.dedupe     # Phase 1: data_manifest.json, clean.csv
.venv/bin/python -m src.models.train              # Phase 2: results/metrics.md, models/lr.joblib
.venv/bin/python scripts/export_onnx.py           # Phase 3: web/models/arogya.onnx, attributions.json
./scripts/vendor_onnxruntime.sh                   # fetches the ~10MB onnxruntime-web runtime locally
.venv/bin/python scripts/run_vignettes.py         # Phase 7: results/vignettes.md
.venv/bin/python -m pytest -q                     # 36 tests
```

## Demo

```bash
python -m http.server 8080 --directory web/
```

Then open `http://localhost:8080`. To see the offline story: load the
page once online (so the service worker installs), then in DevTools set
Network to Offline and reload — the app, model, and all bilingual content
keep working.
