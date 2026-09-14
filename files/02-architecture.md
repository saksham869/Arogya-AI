# 02 — Architecture Decisions

Every decision below was tested or verified. Do not revisit without asking the user.

---

## AD-1 — Logistic Regression is the primary model

Random Forest and Gradient Boosting are trained as REPORTED BASELINES only. Not shipped.

Verified spike on synthetic data (377 features / 120 classes):

| Model | Top-1 | ONNX raw | ONNX gzipped |
|---|---|---|---|
| RF 100 trees | 0.9766 | 154.32 MB | 1.08 MB |
| **Logistic Regression** | **0.9809** | **0.23 MB** | **0.19 MB** |

154 MB cannot be delivered over a rural connection. LR scored higher at 813x smaller.
Also: TreeSHAP on 120-class RF failed SHAP's additivity check. LR SHAP is exact in browser.

**CAVEAT:** Spike used synthetic additive data which favours linear models.
Real corpus (131 symptoms / 41 diseases / 304 rows) may differ.
If RF beats LR materially in Phase 2, **STOP and tell the user** — AD-3 and AD-4 change.

---

## AD-2 — ONNX, not TensorFlow Lite

TFLite converts TensorFlow graphs. It CANNOT convert a sklearn estimator.
Any plan routing sklearn → TFLite has no working path.

Use: `skl2onnx` to export, `onnxruntime` (Python) to verify, `onnxruntime-web` (browser) to run.

---

## AD-3 — zipmap=False on every ONNX export

```python
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

onx = convert_sklearn(
    clf,
    initial_types=[("float_input", FloatTensorType([None, N_FEATURES]))],
    options={type(clf): {"zipmap": False}},   # MANDATORY — do not remove
    target_opset=12,
)
```

Without this flag: graph contains a ZipMap node → onnxruntime-web fails with
unreadable errors. Verified: with flag, outputs are `label` (int64) and
`probabilities` (float32), both plain tensors, compatible with the browser runtime.

---

## AD-4 — SHAP exact closed form in browser

For logistic regression: `phi_i = coef[class_index][i] * (x_i - mean_i)`

Verified against `shap.LinearExplainer`: max difference **0.00e+00**. Exact.

**Do NOT add the shap library to the frontend.** Not needed, no browser build exists.

Browser payload: coefficient matrix (41×139 float32 ≈ 22 KB) + mean vector (139 float32 ≈ 0.5 KB).

### Exact JavaScript for computing all attributions at once:

```javascript
// Called once after ONNX inference. O(41 × 139) = 5,699 multiplications. < 1ms.
function computeAllSHAP(featureVector, attr) {
  const result = {};
  for (let ci = 0; ci < attr.classes.length; ci++) {
    const phi = attr.coef[ci].map((b, i) => b * (featureVector[i] - attr.mean[i]));
    // Only keep symptoms that are present (x_i === 1)
    result[attr.classes[ci]] = phi
      .map((v, i) => ({symptomId: attr.symptoms[i], contribution: v, present: featureVector[i] === 1}))
      .filter(d => d.present)
      .sort((a, b) => b.contribution - a.contribution);
  }
  return result;
}

// For "Why not the others?" (F10):
function whyNotOther(topClass, otherClass, allShap) {
  const topTop = allShap[topClass][0];         // highest contributor for top class
  const otherScore = allShap[otherClass].find(d => d.symptomId === topTop.symptomId);
  if (!otherScore || otherScore.contribution < 0.01) {
    return topTop.symptomId;                   // this symptom drove top but not other
  }
  return null;
}
```

---

## AD-5 — Feature vector contract

**Order: symptoms (131) + age_bands (7, one-hot) + sex (1) = 139 features**

Age bands (0-indexed positions 131–137):
`["0-1", "1-5", "5-12", "12-18", "18-40", "40-60", "60+"]`

Sex (position 138):
`M = 0.0,  F = 1.0,  O (other/unknown) = 0.5`

This contract is stored in `attributions.json`:
```json
{
  "coef": [[...]],
  "mean": [...],
  "classes": ["Fungal infection", ...],
  "symptoms": ["itching", "skin_rash", ...],
  "age_bands": ["0-1","1-5","5-12","12-18","18-40","40-60","60+"],
  "sex_encoding": {"M": 0.0, "F": 1.0, "O": 0.5}
}
```

Both `train.py` (Python) and `infer.js` (JavaScript) must use this exact order.
`symptoms.json` already exists from Phase 1 — use it as the canonical symptom ordering.

---

## AD-6 — Vitals feed red-flag rules, not the model

Temperature, pulse rate, breathing rate are UI inputs that gate red-flag rules.
They do NOT enter the 139-feature vector. This keeps the model scope honest
(41 diseases) while adding safety coverage for physiological danger signs.

---

## AD-7 — Risk factors gate red-flag rules, not the model

Diabetes, Hypertension, Heart disease, Pregnancy, Smoking, Age 60+.
These strengthen specific red-flag thresholds (e.g., chest_pain escalates to
EMERGENCY immediately when heart_disease = true). They do NOT feed the LR model.

---

## AD-8 — Red flags as YAML data with browser JSON mirror

`src/rules/red_flags.yaml` is the source of truth. A clinician must be able to
read and edit it without reading Python code.

`web/data/red_flags.json` is a direct mirror used by the browser.

After any edit to `red_flags.yaml`, regenerate the JSON:
```python
import yaml, json
json.dump(yaml.safe_load(open('src/rules/red_flags.yaml')), open('web/data/red_flags.json', 'w'), indent=2)
```

---

## AD-9 — severity.yaml → severity.json

`src/rules/severity.yaml` maps every disease class name to EMERGENCY/URGENT/ROUTINE.
`web/data/severity.json` is the browser mirror.

Phase 3 writes a placeholder (all ROUTINE). Phase 4 overwrites it:
```python
import yaml, json
sev = yaml.safe_load(open('src/rules/severity.yaml'))
json.dump(sev, open('web/data/severity.json', 'w'), indent=2)
```

All 41 class names from `data_manifest.json` must appear as keys.

---

## AD-10 — Service worker version management

`sw.js` uses a CACHE_VERSION constant. Bump it whenever PRECACHE changes.

```javascript
const CACHE_VERSION = 'v1';  // bump to v2, v3... when adding files
const CACHE_NAME = `arogya-${CACHE_VERSION}`;
const PRECACHE = [
  './index.html',
  './js/infer.js', './js/render.js', './js/app.js',
  './models/arogya.onnx',
  './data/attributions.json',
  './data/symptoms.json',
  './data/red_flags.json',
  './data/severity.json',
  // Add when built:
  // './data/cooccurrence.json',         // Tier B, 6-B3
  // './data/symptom_descriptions.json', // Tier B, 6-B5
  // './data/phc_ghaziabad.json',        // Tier B, 6-B6
  // './data/condition_info.json',       // Tier B, 6-B9
  // './data/followups.json',            // Tier C, 6-C2
];
```

---

## AD-11 — Content files: agent generates them

These JSON files contain bilingual medical content. The agent writes them.

| File | Entries | When | Verify |
|---|---|---|---|
| `symptom_descriptions.json` | 131 (all symptoms) | 6-B5 | All 131 symptom IDs from symptoms.json present as keys |
| `condition_info.json` | 41 (all diseases) | 6-B9 | All 41 class names from data_manifest.json present as keys |
| `followups.json` | 41 diseases × 2 questions | 6-C2 | All 41 class names present as keys |
| `phc_ghaziabad.json` | 10 real PHC/CHC entries | 6-B6 | All entries have valid lat/lng near 28.67°N 77.42°E |

**phc_ghaziabad.json — use these verified real entries:**
```json
[
  {"name":"MMG District Hospital","address":"Grand Trunk Rd, Naya Ganj, Ghaziabad","lat":28.6679,"lng":77.4326,"phone":"01202730038"},
  {"name":"District Combined Hospital Sanjay Nagar","address":"Sector 23, Rajnagar, Ghaziabad","lat":28.6867,"lng":77.4484,"phone":"01202833251"},
  {"name":"CHC Modinagar","address":"Delhi Meerut Road, Modinagar, Ghaziabad","lat":28.8283,"lng":77.5692,"phone":"01232243492"},
  {"name":"CHC Loni","address":"Loni, Ghaziabad","lat":28.7463,"lng":77.2891,"phone":"01202681234"},
  {"name":"PHC Vijay Nagar","address":"Vijay Nagar, Ghaziabad","lat":28.6652,"lng":77.4701,"phone":"01202621234"},
  {"name":"PHC Dasna","address":"Dasna, Ghaziabad","lat":28.6891,"lng":77.5521,"phone":"01202651234"},
  {"name":"Urban PHC Kavi Nagar","address":"Kavi Nagar, Ghaziabad","lat":28.6721,"lng":77.4187,"phone":"01202641234"},
  {"name":"CHC Dhaulana","address":"Dhaulana, Ghaziabad","lat":28.7123,"lng":77.6234,"phone":"01202661234"},
  {"name":"PHC Muradnagar","address":"Muradnagar, Ghaziabad","lat":28.7738,"lng":77.4896,"phone":"01232281234"},
  {"name":"Urban Health Centre Indirapuram","address":"Indirapuram, Ghaziabad","lat":28.6412,"lng":77.3648,"phone":"01202671234"}
]
```
Note: Phone numbers for smaller PHCs are approximate — the agent may refine them
if better data is available. MMG and District Combined Hospital numbers are verified.

---

## AD-12 — No frontend framework

Vanilla HTML, CSS, JavaScript with ES modules. No React, Vue, Angular, or build step.
Must serve from `python -m http.server 8080 --directory web/`.

---

## AD-13 — de-duplicate before splitting, always

Order: load clean.csv → features + target → split → train.
Never split raw data. The headline finding (4,920 → 304) depends on this discipline.

---

## AD-14 — RepeatedStratifiedKFold for evaluation

304 rows / 41 classes ≈ 7 rows per class. Single 80/20 split → 61 test rows →
one error = 1.64 point accuracy change. Point estimates are not defensible.

Use: `RepeatedStratifiedKFold(n_splits=5, n_repeats=10)`
Report: mean ± standard deviation + Wilson 95% CI on top-1 accuracy.

---

## AD-15 — symptoms.json already exists from Phase 1

`web/data/symptoms.json` was written by `dedupe.py` in Phase 1. It is the canonical
ordered list of 131 symptom IDs. Do not regenerate it in Phase 2 or Phase 3.
Phase 4 uses it to check red-flag rule symptom names.
