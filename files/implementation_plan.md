# Implementation Plan — ArogyaAI

**Status:** approved baseline. Timebox: 2 working days.
**Read first:** `.antigravity/knowledge/01`, `02`, `03`.

---

## 1. System architecture

```
+==================================================================+
|  CLIENT  (PWA - functional offline after first load)             |
|                                                                  |
|  [1] Symptom multi-select (EN/HI)    [2] Age, Sex                |
|            |                               |                     |
|            v                               |                     |
|  [3] RED-FLAG ENGINE  <-- deterministic, runs FIRST              |
|      match -> EMERGENCY, return immediately, model NOT called    |
|            |  no match                                           |
|            v                                                     |
|  [4] Feature vector  [n_symptoms binary | age_band | sex]        |
|            |                                                     |
|            v                                                     |
|  [5] onnxruntime-web  -->  arogya.onnx  (LogisticRegression)     |
|            |                                                     |
|            v                                                     |
|  [6] Top-3 differential + probabilities                          |
|            |                                                     |
|            v                                                     |
|  [7] severity.yaml : disease -> baseline tier                    |
|      TRIAGE = max(red_flag_tier, severity_tier)                  |
|            |                                                     |
|            v                                                     |
|  [8] SHAP, exact:  phi_i = coef[ci][i] * (x_i - mean_i)          |
|      -> top 5 present symptoms -> plain-language sentence        |
+==================================================================+
              |  (optional, online only - parity check)
              v
+==================================================================+
|  SERVER  (FastAPI + Uvicorn)                                     |
|  POST /predict   same pipeline, server-side                      |
|  GET  /health    model version, disease count                    |
+==================================================================+
```

**Design note.** The client is authoritative. The server exists so the same
pipeline can be tested with `curl` and so vignettes can be scripted. The demo
runs entirely in the browser.

## 2. Data contracts

### 2.1 `data/processed/data_manifest.json`

```json
{
  "source": "data/raw/dataset.csv",
  "generated": "2026-09-13",
  "sha256": "<hex>",
  "rows_before": 4920,
  "rows_after": 0,
  "duplicates_removed": 0,
  "n_symptoms": 0,
  "n_diseases": 0,
  "class_counts": { "Fungal infection": 0 }
}
```

`rows_after` is the number that governs every claim in this project.

### 2.2 `web/data/attributions.json`

```json
{
  "coef":     [[0.12, -0.03, "..."]],
  "mean":     [0.04, 0.11, "..."],
  "classes":  ["Fungal infection", "Allergy", "..."],
  "symptoms": ["itching", "skin_rash", "..."],
  "age_bands": ["0-1","1-5","5-12","12-18","18-40","40-60","60+"]
}
```

Feature order is `symptoms` then `age_bands` then `sex`. **This order is the
contract between Python and JavaScript.** Both sides build the vector this way.

### 2.3 `src/rules/red_flags.yaml`

```yaml
# NOT CLINICALLY REVIEWED. Do not use with real patients.
- id: RF01
  tier: EMERGENCY
  all_of: [chest_pain]
  any_of: [breathlessness, sweating, vomiting]
  rationale_en: "Chest pain with these features can indicate a heart attack."
  rationale_hi: "..."
  action_en: "Go to the nearest hospital now."
```

Optional keys: `age_max_months`, `age_min_years`, `sex`.

### 2.4 `POST /predict`

Request:
```json
{ "symptoms": ["chest_pain","breathlessness"], "age_years": 54,
  "sex": "M", "lang": "en" }
```

Response:
```json
{
  "tier": "EMERGENCY",
  "tier_source": "red_flag",
  "rule_id": "RF01",
  "rationale": "Chest pain with these features can indicate a heart attack.",
  "action": "Go to the nearest hospital now.",
  "differential": [],
  "explanation": [],
  "disclaimer": "This is not a diagnosis and not a medical device. It does not replace a doctor."
}
```

When no red flag fires, `tier_source` is `"model"`, `rule_id` is null,
`differential` holds 3 entries, and `explanation` holds up to 5 entries of
`{symptom, contribution}`.

## 3. Triage derivation

```
tier = max(red_flag_tier, severity_tier)      # EMERGENCY > URGENT > ROUTINE
```

Never derive the tier from classifier confidence alone. A confident prediction
of a mild condition is still ROUTINE; an uncertain prediction of a severe one is
not downgraded by its uncertainty.

`severity.yaml` maps each disease label to a baseline tier. Unmapped → ROUTINE,
and every unmapped disease is listed in the README as a known gap.

## 4. Phase dependency graph

```
P0 scaffold
   |
P1 data + dedupe ---------> P2 train + evaluate
                                  |
                            P3 ONNX export + attributions.json
                                  |            |
P4 red-flag engine ---------------+            |
        |                                      |
        +--------> P5 API <--------------------+
                     |
                   P6 PWA (6a -> 6b -> 6c -> 6d)
                     |
                   P7 vignettes + README + demo
```

P4 can proceed in parallel with P2/P3 — it depends only on the symptom list
from P1.

## 5. Risks

| Risk | Trigger | Response |
|---|---|---|
| RF beats LR on real data | P2 metrics | **Stop, tell the user.** AD-1/3/4 change |
| De-dup leaves too few rows | P1 manifest | Report the number, continue. The finding is the contribution |
| ONNX parity fails | P3 | Stop. Offline story depends on it. Do not proceed to P6 |
| Symptom names in red flags absent from dataset | P4 | Add as UI-only input, comment it, list in README |
| Time runs out | any | Cut order: P7 vignettes → Hindi strings → service worker → P2 baselines. **Never cut** dedupe manifest, red-flag engine, or SHAP |

## 6. Out of scope for this timebox

773-disease corpus · full 400-term Hindi dictionary · demographic encoding study
· Docker · clinical review of red flags · user accounts · deployment
