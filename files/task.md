# task.md — ArogyaAI

One phase at a time. Hard STOP after every phase.
Do not begin the next phase until the user types `approved` or `continue`.

Legend: `[x]` done · `[ ]` not started

---

## ✅ PHASE 0 — Scaffold — COMPLETE

## ✅ PHASE 1 — Data pipeline — COMPLETE

Evidence:
- 4,920 → 304 rows (4,616 duplicates removed, 93.8%)
- 131 symptoms, 41 diseases
- data_manifest.json written. SHA-256 stored.
- web/data/symptoms.json written (131 symptom IDs)
- 4 pytest tests passing. Commit: d8e8b23

---

## PHASE 2 — Train and evaluate · ~2.5 h

### Setup

- [ ] 2.0 Verify min class count before anything else:
```python
import json
manifest = json.load(open('data/processed/data_manifest.json'))
counts = list(manifest['class_counts'].values())
print(f"min class: {min(counts)}, max: {max(counts)}, total: {sum(counts)}")
n_splits = min(5, min(counts))
print(f"will use n_splits={n_splits}")
```

### Training

- [ ] 2.1 Write `src/models/train.py`

```python
import pandas as pd, numpy as np, json, joblib
from datetime import date
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate
from sklearn.metrics import top_k_accuracy_score
from statsmodels.stats.proportion import proportion_confint
import warnings; warnings.filterwarnings('ignore')

# Load
df = pd.read_csv('data/processed/clean.csv')
symptom_cols = [c for c in df.columns if c != 'Disease']
X = df[symptom_cols].values.astype(np.float32)
y = df['Disease'].values
manifest = json.load(open('data/processed/data_manifest.json'))

# Age bands and sex encoding (use defaults for the training baseline)
# The full feature vector (139) is built in export_onnx.py
# For training: use the 131-symptom binary matrix + placeholder age/sex
# or add them here if the dataset contains them
# Currently: the itachi9604 dataset has only symptoms and disease
# So train on 131 features only, export 139-feature model for inference
# NOTE: age_band (7) and sex (1) features are zero-padded during training
# and the browser will fill them with real values
n_sym = X.shape[1]
n_age_bands = 7
n_total = n_sym + n_age_bands + 1  # 139
X_full = np.zeros((len(X), n_total), dtype=np.float32)
X_full[:, :n_sym] = X  # symptom columns; age/sex = 0 in training

# Split
from sklearn.model_selection import train_test_split
Xtr, Xte, ytr, yte = train_test_split(X_full, y, test_size=0.2, random_state=42, stratify=y)

# CV scheme
min_class = min(pd.Series(y).value_counts())
n_splits = min(5, min_class)
cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=10, random_state=42)

models = {
    'LogisticRegression': LogisticRegression(max_iter=2000, C=1.0, random_state=42, n_jobs=-1),
    'RandomForest': RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1),
    'GradientBoosting': GradientBoostingClassifier(n_estimators=100, random_state=42),
}

results = {}
for name, clf in models.items():
    cv_res = cross_validate(clf, X_full, y, cv=cv,
                            scoring=['accuracy', 'f1_macro', 'precision_macro', 'recall_macro'],
                            n_jobs=-1)
    clf.fit(Xtr, ytr)
    proba = clf.predict_proba(Xte)
    top3 = top_k_accuracy_score(yte, proba, k=3, labels=clf.classes_)
    n = len(yte); k = int((proba.argmax(1) == yte).sum())
    lo, hi = proportion_confint(k, n, method='wilson')
    results[name] = {
        'top1_mean': cv_res['test_accuracy'].mean(),
        'top1_std': cv_res['test_accuracy'].std(),
        'top1_ci_lo': lo, 'top1_ci_hi': hi,
        'top3': top3,
        'f1_macro': cv_res['test_f1_macro'].mean(),
        'precision_macro': cv_res['test_precision_macro'].mean(),
        'recall_macro': cv_res['test_recall_macro'].mean(),
    }
    print(f"{name}: {results[name]['top1_mean']:.4f} ± {results[name]['top1_std']:.4f}")

# Save primary model
lr = models['LogisticRegression']
lr.fit(Xtr, ytr)  # refit on full train set for export
joblib.dump({'model': lr, 'feature_means': X_full.mean(axis=0),
             'symptom_cols': symptom_cols, 'classes': list(lr.classes_)},
            'models/lr.joblib')

# Save metrics
header = (f"# ArogyaAI Model Metrics\n"
          f"Date: {date.today()}\n"
          f"De-duplication: {manifest['rows_before']} → {manifest['rows_after']} rows\n"
          f"CV: RepeatedStratifiedKFold(n_splits={n_splits}, n_repeats=10)\n\n")
table = "| Model | Top-1 mean±sd | 95% CI | Top-3 | F1 macro |\n|---|---|---|---|---|\n"
for name, r in results.items():
    table += f"| {name} | {r['top1_mean']:.4f}±{r['top1_std']:.4f} | [{r['top1_ci_lo']:.3f},{r['top1_ci_hi']:.3f}] | {r['top3']:.4f} | {r['f1_macro']:.4f} |\n"
open('results/metrics.md', 'w').write(header + table)
print("\nSaved to results/metrics.md")
```

- [ ] 2.2 Run: `python -m src.models.train`
- [ ] 2.3 Check: does `results/metrics.md` exist with real numbers?
- [ ] 2.4 Check: did `models/lr.joblib` get written?

### Co-occurrence matrix

- [ ] 2.5 Generate `web/data/cooccurrence.json` from de-duplicated data:
```python
import pandas as pd, json
df = pd.read_csv('data/processed/clean.csv')
sym = [c for c in df.columns if c != 'Disease']
co = df[sym].T.dot(df[sym])
result = {s: co[s].drop(s).nlargest(3).index.tolist() for s in sym}
json.dump(result, open('web/data/cooccurrence.json', 'w'), indent=2)
print(f"cooccurrence.json written: {len(result)} entries")
```

**Verify:** paste the metrics table from results/metrics.md.

> ⚠️ If RF beats LR materially (>3 points top-1), STOP and tell the user.
> AD-1, AD-3, AD-4 all change and Phase 3 must be replanned.

### ⛔ STOP — Phase 2. Await approval.

---

## PHASE 3 — ONNX export + JSON assets · ~1.5 h

- [ ] 3.1 Create `models/` directory if not exists
- [ ] 3.2 Write `scripts/export_onnx.py`:

```python
import joblib, json, gzip, numpy as np
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import onnxruntime as ort

# Load
saved = joblib.load('models/lr.joblib')
clf = saved['model']
means = saved['feature_means']
symptom_cols = saved['symptom_cols']
classes = saved['classes']

N_FEATURES = 139  # 131 symptoms + 7 age bands + 1 sex

# Export
onx = convert_sklearn(
    clf,
    initial_types=[("float_input", FloatTensorType([None, N_FEATURES]))],
    options={type(clf): {"zipmap": False}},   # MANDATORY — see AD-3
    target_opset=12,
)
blob = onx.SerializeToString()
open('web/models/arogya.onnx', 'wb').write(blob)
open('web/models/arogya.onnx.gz', 'wb').write(gzip.compress(blob, 9))
print(f"ONNX raw: {len(blob)/1e3:.1f} KB, gzipped: {len(gzip.compress(blob,9))/1e3:.1f} KB")

# Verify
sess = ort.InferenceSession('web/models/arogya.onnx', providers=['CPUExecutionProvider'])

# Load test set
import pandas as pd
from sklearn.model_selection import train_test_split
df = pd.read_csv('data/processed/clean.csv')
sym = [c for c in df.columns if c != 'Disease']
X = df[sym].values.astype(np.float32)
y = df['Disease'].values
X_full = np.zeros((len(X), N_FEATURES), dtype=np.float32)
X_full[:, :len(sym)] = X
_, Xte, _, yte = train_test_split(X_full, y, test_size=0.2, random_state=42, stratify=y)

# Check 1: label parity
sk_labels = clf.predict(Xte)
onnx_out = sess.run(None, {'float_input': Xte})
onnx_labels = onnx_out[0]
mismatches = int((sk_labels != onnx_labels).sum())
print(f"[{'PASS' if mismatches == 0 else 'FAIL'}] Label parity: {mismatches} mismatches / {len(yte)}")

# Check 2: probability parity
sk_proba = clf.predict_proba(Xte)
onnx_proba = onnx_out[1]
max_diff = float(np.abs(sk_proba - onnx_proba).max())
print(f"[{'PASS' if max_diff < 1e-4 else 'FAIL'}] Probability parity: max diff {max_diff:.2e}")

# Write attributions.json (AD-5)
# IMPORTANT: means must be for the FULL 139-feature vector
full_means = means.tolist()  # already 139-length from train.py
attr = {
    "coef": clf.coef_.astype(np.float32).tolist(),
    "mean": full_means,
    "classes": classes,
    "symptoms": symptom_cols,
    "age_bands": ["0-1","1-5","5-12","12-18","18-40","40-60","60+"],
    "sex_encoding": {"M": 0.0, "F": 1.0, "O": 0.5}
}
json.dump(attr, open('web/data/attributions.json', 'w'))
print(f"attributions.json: {len(classes)} classes, {len(symptom_cols)} symptoms")
```

- [ ] 3.3 Run: `python scripts/export_onnx.py`
- [ ] 3.4 Both PASS lines printed?
- [ ] 3.5 `web/models/arogya.onnx` and `arogya.onnx.gz` exist?
- [ ] 3.6 Write `tests/test_onnx_parity.py` covering the same two assertions
- [ ] 3.7 Write placeholder `web/data/severity.json` — all 41 diseases mapped to ROUTINE:
```python
import json
manifest = json.load(open('data/processed/data_manifest.json'))
sev = {d: "ROUTINE" for d in manifest['class_counts']}
json.dump(sev, open('web/data/severity.json', 'w'), indent=2)
print(f"severity.json placeholder: {len(sev)} diseases")
```

**Verify:** paste both PASS lines and the two file sizes.

> ⚠️ If either assertion FAILS, STOP. The offline story depends entirely on this.
> Do not proceed to Phase 6.

### ⛔ STOP — Phase 3. Await approval.

---

## PHASE 4 — Red-flag engine · ~2 h

Read S4 and S5 in knowledge/01 before starting.

### Pre-flight check

- [ ] 4.0 Check which rule symptom names exist in the real dataset:
```python
import json
symptoms = set(json.load(open('web/data/symptoms.json')))
needed = ['chest_pain','breathlessness','sweating','altered_sensorium',
          'weakness_in_limbs','high_fever','stiff_neck','skin_rash',
          'bloody_stool','vomiting','loss_of_balance','headache']
for s in needed:
    print(f"{'OK     ' if s in symptoms else 'MISSING'} {s}")
```
Any MISSING symptom must be added as a UI-only input (does not feed the model,
only feeds the red-flag engine). Comment this in red_flags.yaml.

### Rules

- [ ] 4.1 Write `src/rules/red_flags.yaml`:

```yaml
# ArogyaAI Red-Flag Rules
# WARNING: NOT CLINICALLY REVIEWED. Do not use with real patients.
# Last modified: [date]
# Reviewer: [REQUIRED before any patient use — currently unreviewed]

# Rule fields:
#   id: unique string
#   tier: always EMERGENCY
#   all_of: list of symptom IDs that must ALL be present
#   any_of: at least ONE of these must be present (optional)
#   age_max_months: fires only when patient age_years * 12 <= this
#   risk_factor_required: fires only when this risk factor is true
#   vital_temp_above: fires when temperature > this value
#   vital_pulse_above: fires when pulse > this value
#   rationale_en: plain English shown to user
#   rationale_hi: Hindi shown to user
#   action_en: what to do
#   action_hi: Hindi what to do

- id: RF01
  tier: EMERGENCY
  all_of: [chest_pain]
  any_of: [breathlessness, sweating, vomiting]
  rationale_en: "Chest pain with these features can indicate a heart attack."
  rationale_hi: "इन लक्षणों के साथ सीने में दर्द दिल के दौरे का संकेत हो सकता है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

- id: RF01b
  tier: EMERGENCY
  all_of: [chest_pain]
  risk_factor_required: heart_disease
  rationale_en: "Chest pain in someone with heart disease needs immediate attention."
  rationale_hi: "हृदय रोग वाले व्यक्ति में सीने का दर्द गंभीर हो सकता है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

- id: RF02
  tier: EMERGENCY
  all_of: [breathlessness]
  any_of: [chest_pain, high_fever]
  rationale_en: "Severe breathlessness needs urgent medical attention."
  rationale_hi: "सांस लेने में गंभीर कठिनाई के लिए तत्काल चिकित्सा ध्यान जरूरी है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

- id: RF03
  tier: EMERGENCY
  all_of: [loss_of_consciousness]
  rationale_en: "Loss of consciousness needs immediate emergency care."
  rationale_hi: "बेहोशी के लिए तत्काल आपातकालीन देखभाल जरूरी है।"
  action_en: "Call an ambulance or go to the nearest hospital immediately."
  action_hi: "एम्बुलेंस बुलाएं या तुरंत नजदीकी अस्पताल जाएं।"

- id: RF04
  tier: EMERGENCY
  all_of: [weakness_in_limbs]
  any_of: [headache, vomiting, altered_sensorium]
  rationale_en: "One-sided weakness with these symptoms can indicate a stroke."
  rationale_hi: "एकतरफा कमजोरी इन लक्षणों के साथ स्ट्रोक का संकेत हो सकती है।"
  action_en: "This may be a stroke. Go to the nearest hospital immediately."
  action_hi: "यह स्ट्रोक हो सकता है। तुरंत नजदीकी अस्पताल जाएं।"

- id: RF05
  tier: EMERGENCY
  all_of: [stiff_neck, high_fever]
  rationale_en: "Fever with neck stiffness can indicate meningitis."
  rationale_hi: "गर्दन की अकड़न के साथ बुखार मेनिनजाइटिस का संकेत हो सकता है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

- id: RF06
  tier: EMERGENCY
  all_of: [high_fever, skin_rash]
  rationale_en: "Fever with rash needs urgent medical evaluation."
  rationale_hi: "दाने के साथ बुखार के लिए तत्काल चिकित्सा मूल्यांकन जरूरी है।"
  action_en: "Go to the nearest hospital today."
  action_hi: "आज नजदीकी अस्पताल जाएं।"

- id: RF07
  tier: EMERGENCY
  all_of: [high_fever]
  age_max_months: 3
  rationale_en: "Fever in a baby under 3 months needs same-day hospital care."
  rationale_hi: "3 महीने से कम उम्र के शिशु में बुखार के लिए उसी दिन अस्पताल जाना जरूरी है।"
  action_en: "Take the baby to hospital today."
  action_hi: "आज बच्चे को अस्पताल ले जाएं।"

- id: RF08
  tier: EMERGENCY
  all_of: [altered_sensorium]
  rationale_en: "Confusion or altered consciousness needs urgent evaluation."
  rationale_hi: "भ्रम या चेतना में बदलाव के लिए तत्काल जांच जरूरी है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

- id: RF09
  tier: EMERGENCY
  all_of: [bloody_stool]
  any_of: [vomiting, abdominal_pain]
  rationale_en: "Blood in stool with these symptoms needs urgent attention."
  rationale_hi: "इन लक्षणों के साथ मल में खून के लिए तत्काल ध्यान जरूरी है।"
  action_en: "Go to the nearest hospital today."
  action_hi: "आज नजदीकी अस्पताल जाएं।"

- id: RF10
  tier: EMERGENCY
  all_of: [vomiting]
  any_of: [chest_pain, breathlessness]
  rationale_en: "Vomiting with chest symptoms needs urgent evaluation."
  rationale_hi: "सीने के लक्षणों के साथ उल्टी के लिए तत्काल जांच जरूरी है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

# Vital-sign based rules (these use the vitals panel, not symptom checkboxes)
- id: RF-TEMP01
  tier: EMERGENCY
  all_of: [altered_sensorium]
  vital_temp_above: 39.5
  rationale_en: "Very high fever with confusion is a medical emergency."
  rationale_hi: "भ्रम के साथ बहुत तेज बुखार एक चिकित्सा आपातकाल है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

- id: RF-PULSE01
  tier: EMERGENCY
  all_of: [breathlessness]
  vital_pulse_above: 120
  rationale_en: "Very rapid heartbeat with breathlessness needs immediate care."
  rationale_hi: "सांस की तकलीफ के साथ बहुत तेज दिल की धड़कन के लिए तत्काल देखभाल जरूरी है।"
  action_en: "Go to the nearest hospital immediately."
  action_hi: "तुरंत नजदीकी अस्पताल जाएं।"

# Risk-factor based rules
- id: RF-PREG01
  tier: EMERGENCY
  all_of: [abdominal_pain]
  risk_factor_required: pregnancy
  rationale_en: "Abdominal pain in pregnancy needs same-day medical attention."
  rationale_hi: "गर्भावस्था में पेट दर्द के लिए उसी दिन चिकित्सा ध्यान जरूरी है।"
  action_en: "Go to the nearest hospital or maternity centre today."
  action_hi: "आज नजदीकी अस्पताल या प्रसूति केंद्र जाएं।"
```

- [ ] 4.2 Write `src/rules/severity.yaml` — all 41 disease classes mapped to a tier.
      Get all class names from data_manifest.json.
      Use clinical judgment. Default: ROUTINE. Diseases with serious complications: URGENT.
      Example:
```yaml
Fungal infection: ROUTINE
Allergy: ROUTINE
GERD: ROUTINE
Chronic cholestasis: URGENT
Drug Reaction: URGENT
Peptic ulcer disease: URGENT
AIDS: URGENT
Diabetes: URGENT
Gastroenteritis: ROUTINE
Bronchial Asthma: URGENT
Hypertension: URGENT
Migraine: ROUTINE
Cervical spondylosis: ROUTINE
Paralysis (brain hemorrhage): EMERGENCY
Jaundice: URGENT
Malaria: URGENT
Chicken pox: ROUTINE
Dengue: URGENT
Typhoid: URGENT
Hepatitis A: URGENT
Hepatitis B: URGENT
Hepatitis C: URGENT
Hepatitis D: URGENT
Hepatitis E: URGENT
Alcoholic hepatitis: URGENT
Tuberculosis: URGENT
Common Cold: ROUTINE
Pneumonia: URGENT
Dimorphic hemorrhoids: ROUTINE
Heart attack: EMERGENCY
Varicose veins: ROUTINE
Hypothyroidism: ROUTINE
Hyperthyroidism: ROUTINE
Hypoglycemia: URGENT
Osteoarthritis: ROUTINE
Arthritis: ROUTINE
Paroymsal Positional Vertigo: ROUTINE
Acne: ROUTINE
Urinary tract infection: URGENT
Psoriasis: ROUTINE
Impetigo: ROUTINE
```

- [ ] 4.3 Write `src/rules/engine.py`:

```python
import yaml
from pathlib import Path

_rules = None
_severity = None

def _load():
    global _rules, _severity
    if _rules is None:
        _rules = yaml.safe_load(Path('src/rules/red_flags.yaml').read_text())
        _severity = yaml.safe_load(Path('src/rules/severity.yaml').read_text())

def evaluate(symptoms: set, age_years: float, sex: str,
             risk_factors: dict = None, vitals: dict = None):
    """
    Returns (tier, rule_id) if a red flag fires, else (None, None).
    symptoms: set of symptom IDs (strings)
    age_years: float (e.g. 0.25 for 3-month-old)
    sex: 'M', 'F', or 'O'
    risk_factors: dict of {condition: bool}, e.g. {'heart_disease': True}
    vitals: dict of {temp_c, pulse_bpm, breathing_rpm}, all optional floats
    """
    _load()
    if risk_factors is None: risk_factors = {}
    if vitals is None: vitals = {}
    age_months = age_years * 12

    for rule in _rules:
        # Check all_of
        if not all(s in symptoms for s in rule.get('all_of', [])):
            continue
        # Check any_of
        if 'any_of' in rule and not any(s in symptoms for s in rule['any_of']):
            continue
        # Check age
        if 'age_max_months' in rule and age_months > rule['age_max_months']:
            continue
        if 'age_min_years' in rule and age_years < rule['age_min_years']:
            continue
        # Check risk factor
        if 'risk_factor_required' in rule:
            if not risk_factors.get(rule['risk_factor_required'], False):
                continue
        # Check vitals
        if 'vital_temp_above' in rule:
            temp = vitals.get('temp_c')
            if temp is None or temp <= rule['vital_temp_above']:
                continue
        if 'vital_pulse_above' in rule:
            pulse = vitals.get('pulse_bpm')
            if pulse is None or pulse <= rule['vital_pulse_above']:
                continue
        # All conditions met
        return (rule['tier'], rule['id'])
    return (None, None)

def get_triage(disease, model_prob):
    """Returns triage tier for a given disease based on severity map."""
    _load()
    return _severity.get(disease, 'ROUTINE')
```

- [ ] 4.4 Overwrite `web/data/severity.json` from severity.yaml:
```python
import yaml, json
json.dump(yaml.safe_load(open('src/rules/severity.yaml')),
          open('web/data/severity.json', 'w'), indent=2)
print("severity.json updated")
```

- [ ] 4.5 Write `web/data/red_flags.json` from red_flags.yaml:
```python
import yaml, json
json.dump(yaml.safe_load(open('src/rules/red_flags.yaml')),
          open('web/data/red_flags.json', 'w'), indent=2)
print("red_flags.json updated")
```

- [ ] 4.6 Write `tests/test_red_flags.py` — per rule: one firing case AND one near-miss.
      Also: empty symptom set never fires. Vitals rules fire and don't fire correctly.
      Risk factor rules fire and don't fire correctly.
      Target: 25+ tests.

**Verify:** `pytest tests/test_red_flags.py -v` — paste the test count and result.

### ⛔ STOP — Phase 4. Await approval.

---

## PHASE 5 — FastAPI backend · ~2 h · OFF CRITICAL PATH

Build Phase 6 first. Only build Phase 5 if Phase 6 is working.

- [ ] 5.1 Write `src/api/schemas.py` with request/response models per knowledge/03 contracts
- [ ] 5.2 Write `src/api/main.py` — same pipeline as browser: red-flag first, then model
- [ ] 5.3 POST /predict must return tier_source: "red_flag" or "model"
- [ ] 5.4 GET /health returns {status, n_diseases, model_version}
- [ ] 5.5 Disclaimer on every response
- [ ] 5.6 tests/test_api.py: red-flag case returns red_flag; NO response contains medication name

**Verify:** paste curl for both cases with actual JSON.

### ⛔ STOP — Phase 5. Await approval.

---

## PHASE 6 — PWA frontend · 20 features · 3 tiers

**Server:** `python -m http.server 8080 --directory web/`
**Offline test:** DevTools → Network → Offline → reload → predict

Commit after EVERY individual feature. Never batch.
Screenshots are mandatory evidence for every UI feature.

---

### TIER A — Core (3.5 h) — demo does not exist without these

#### 6-A1: Page shell (45 min)

- [ ] `web/index.html` — no framework, no build step (AD-12)
- [ ] Header: app title · language toggle [EN|हिं] · online/offline dot
- [ ] Symptom section: search input + results dropdown (filter symptoms.json as user types)
- [ ] Selected chips with ✕ remove button
- [ ] Vitals section (collapsed by default): Temperature °C · Pulse bpm · Breathing rpm
- [ ] Risk factors section (collapsed): 6 toggle chips
- [ ] Age input (number, min 0, max 120, step 0.1)
- [ ] Sex select (Male/Female/Other)
- [ ] Large ASSESS button (min-height 56px)
- [ ] Disclaimer permanently visible at bottom (S7)
- [ ] Empty results area
- [ ] Mobile-first CSS, min 44px touch targets throughout

**Verify:** Screenshot of rendered empty form.

#### 6-A2: Voice input (25 min) — F4

- [ ] Microphone button (🎤) next to symptom search input
- [ ] `new webkitSpeechRecognition()` with `lang = currentLang === 'hi' ? 'hi-IN' : 'en-IN'`
- [ ] On result: match transcript words against symptom IDs in symptoms.json
- [ ] Show "Listening..." indicator while recording
- [ ] If `webkitSpeechRecognition` undefined: hide button entirely

**Verify:** Screenshot showing mic button. Console log showing matched symptom name.

#### 6-A3: Core inference engine (75 min) — F1, F2, F3

- [ ] `web/js/infer.js`:

```javascript
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/esm/ort.min.js';

let session = null;
let attr = null;
let symptoms_list = null;
let red_flags = null;

export async function init() {
  [session, attr, symptoms_list, red_flags] = await Promise.all([
    ort.InferenceSession.create('./models/arogya.onnx'),
    fetch('./data/attributions.json').then(r => r.json()),
    fetch('./data/symptoms.json').then(r => r.json()),
    fetch('./data/red_flags.json').then(r => r.json()),
  ]);
}

function buildFeatureVector(selectedSymptoms, ageYears, sex) {
  const vec = new Float32Array(139).fill(0);
  // Symptoms (0-130)
  selectedSymptoms.forEach(s => {
    const i = symptoms_list.indexOf(s);
    if (i >= 0) vec[i] = 1;
  });
  // Age bands (131-137), one-hot
  const bands = [[0,1],[1,5],[5,12],[12,18],[18,40],[40,60],[60,200]];
  const bi = bands.findIndex(([lo,hi]) => ageYears >= lo && ageYears < hi);
  if (bi >= 0) vec[131 + bi] = 1;
  // Sex (138)
  vec[138] = attr.sex_encoding[sex] ?? 0.5;
  return vec;
}

function checkRedFlags(selectedSymptoms, ageYears, sex, riskFactors, vitals) {
  const sympSet = new Set(selectedSymptoms);
  const ageMonths = ageYears * 12;
  for (const rule of red_flags) {
    if (!rule.all_of.every(s => sympSet.has(s))) continue;
    if (rule.any_of && !rule.any_of.some(s => sympSet.has(s))) continue;
    if (rule.age_max_months && ageMonths > rule.age_max_months) continue;
    if (rule.age_min_years && ageYears < rule.age_min_years) continue;
    if (rule.risk_factor_required && !riskFactors[rule.risk_factor_required]) continue;
    if (rule.vital_temp_above && (!vitals.temp_c || vitals.temp_c <= rule.vital_temp_above)) continue;
    if (rule.vital_pulse_above && (!vitals.pulse_bpm || vitals.pulse_bpm <= rule.vital_pulse_above)) continue;
    return { fired: true, tier: rule.tier, ruleId: rule.id,
             rationale: rule.rationale_en, action: rule.action_en };
  }
  return { fired: false };
}

function computeAllSHAP(featureVector) {
  const result = {};
  for (let ci = 0; ci < attr.classes.length; ci++) {
    const phi = attr.coef[ci].map((b, i) => b * (featureVector[i] - attr.mean[i]));
    result[attr.classes[ci]] = phi
      .map((v, i) => ({ symptomId: attr.symptoms[i] || `age_band_${i-131}`, contribution: v, present: featureVector[i] === 1 }))
      .filter(d => d.present)
      .sort((a, b) => b.contribution - a.contribution);
  }
  return result;
}

export async function predict(selectedSymptoms, ageYears, sex, riskFactors = {}, vitals = {}) {
  if (!session) await init();

  // 1. Red-flag check FIRST (S4)
  const rf = checkRedFlags(selectedSymptoms, ageYears, sex, riskFactors, vitals);
  if (rf.fired) {
    return { tier: rf.tier, tierSource: 'red_flag', ruleId: rf.ruleId,
             rationale: rf.rationale, action: rf.action,
             differential: [], explanation: [], allShap: {} };
  }

  // 2. Build feature vector
  const vec = buildFeatureVector(selectedSymptoms, ageYears, sex);

  // 3. Run ONNX
  const tensor = new ort.Tensor('float32', vec, [1, 139]);
  const output = await session.run({ float_input: tensor });
  const probs = Array.from(output.probabilities.data);

  // 4. Compute SHAP for all classes (AD-4)
  const allShap = computeAllSHAP(vec);

  // 5. Top-3 differential
  const top3 = probs
    .map((p, i) => ({ disease: attr.classes[i], probability: p }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  const topClass = top3[0].disease;
  const explanation = (allShap[topClass] || []).slice(0, 5);

  // 6. Severity tier
  let tier = 'ROUTINE';
  // (severity.json loaded separately by app.js)

  return { tier, tierSource: 'model', ruleId: null, rationale: null, action: null,
           differential: top3, explanation, allShap, topClass };
}
```

- [ ] `web/js/app.js`: load severity.json, wire ASSESS button to predict(), apply severity to tier

**Verify:** Console log showing the full return object with tier, explanation, allShap.

#### 6-A4: Result rendering (60 min) — F2 display, F3 display

- [ ] `web/js/render.js`:
- [ ] Red/amber/green banner based on tier
- [ ] EMERGENCY: show rationale + action, hide differential (S4)
- [ ] Show "Safety rule RF01 · model not used" line when tierSource === 'red_flag'
- [ ] ROUTINE/URGENT: plain-language explanation from top contributors
  Format: "Because you reported [symptom1] and [symptom2]."
- [ ] Top-3 differential with probability bars
- [ ] Each differential entry has "▸ Why ranked lower?" expander (F10 — add now)
- [ ] Disclaimer always visible (S7)
- [ ] Start over button
- [ ] Bilingual strings object: all UI text in both en and hi

**Verify:** Two screenshots — one EMERGENCY (red flag fired), one ROUTINE.

#### 6-A5: Offline service worker (30 min) — F1

- [ ] `web/sw.js` with CACHE_VERSION = 'v1' (AD-10)
- [ ] Initial PRECACHE list (see AD-10)
- [ ] Cache-first strategy
- [ ] Register from index.html using `navigator.serviceWorker.register('./sw.js')`
- [ ] Online/offline dot: green when navigator.onLine, grey when not

**Verify:** Screenshot of working prediction with DevTools Network set to Offline.
Test this twice. This is the demo's most important moment.

---

### TIER B — Strong demo (7 h) — build only after Tier A is committed and working

#### 6-B1: Vitals feed red flags (1.5 h) — F5

- [ ] Expand the vitals section in the form (it was collapsed in A1)
- [ ] Pass vitals to `predict()` in infer.js
- [ ] infer.js already handles vitals in checkRedFlags
- [ ] Display entered vitals on the printable card (F18)

**Verify:** Enter temp=41.0, any symptom → EMERGENCY from RF-TEMP01. Console log confirms model not called.

#### 6-B2: Risk factors panel (2 h) — F6

- [ ] Expand risk factors section
- [ ] Pass riskFactors dict to predict()
- [ ] infer.js already handles risk_factors in checkRedFlags
- [ ] Store selected risk factors in each assessment history entry

**Verify:** Toggle Heart disease ON + enter chest_pain → EMERGENCY from RF01b. Toggle OFF + same input → model runs.

#### 6-B3: Co-occurrence prompts (1 h) — F8

- [ ] Load web/data/cooccurrence.json
- [ ] After 2+ symptoms selected: show up to 3 ghost chips labelled "Also common:"
- [ ] Tapping ghost chip adds it as a real selected chip
- [ ] Bump sw.js CACHE_VERSION to v2, add cooccurrence.json to PRECACHE

**Verify:** Select itching + skin_rash → ghost chips appear for related symptoms.

#### 6-B4: "Why not the others?" (1 h) — F10

- [ ] Each non-top differential entry has a "▸ Why ranked lower?" expander (already added in A4)
- [ ] On expand: run whyNotOther() function from AD-4
- [ ] Render: "Ranked lower because the model found [symptom] is not a strong signal for this condition."
- [ ] If no differentiating symptom found: "Similar symptom pattern to [top disease]."

**Verify:** Screenshot of expanded "Why ranked lower?" for the second differential entry.

#### 6-B5: Symptom descriptions (1 h) — F12

- [ ] AGENT: generate web/data/symptom_descriptions.json
  Format: `{"symptom_id": {"en": "Plain 1-sentence description.", "hi": "Hindi description."}}`
  All 131 symptom IDs from symptoms.json must be keys.
  Example entries:
  ```json
  {
    "itching": {"en": "An uncomfortable sensation on the skin that makes you want to scratch.", "hi": "त्वचा पर खुजली की अनुभूति।"},
    "skin_rash": {"en": "Red, irritated patches or bumps on the skin.", "hi": "त्वचा पर लाल चकत्ते या उभार।"},
    "high_fever": {"en": "Body temperature above 38.5°C (101.3°F).", "hi": "शरीर का तापमान 38.5°C से ऊपर।"}
  }
  ```
- [ ] ℹ️ button on each symptom chip → bottom sheet with description
- [ ] "Not sure" chip option in search dropdown: adds symptom greyed out, not in feature vector
- [ ] Bump sw.js CACHE_VERSION, add symptom_descriptions.json to PRECACHE

**Verify:** Tap ℹ on any chip → description appears in current language.

#### 6-B6: Nearest PHC locator (1 h) — F17

- [ ] AGENT: confirm web/data/phc_ghaziabad.json from AD-11 is written
  (10 real Ghaziabad PHC/CHC entries with lat/lng/phone)
- [ ] On EMERGENCY result: show "📍 Nearest health centres" section
- [ ] Request geolocation. On success: Haversine sort, show top 3
- [ ] Each entry: name, distance in km, tap-to-call [📞 Call] button
- [ ] On geolocation denied: show all 10 as a plain list, no distances
- [ ] Bump sw.js CACHE_VERSION, add phc_ghaziabad.json to PRECACHE

**Verify:** Screenshot of EMERGENCY result with PHC list showing distances.

#### 6-B7: Printable result card (45 min) — F18

- [ ] "🖨 Save for doctor" button on result screen
- [ ] @media print CSS: hide everything except the card
- [ ] Card content: date + time, symptoms entered (full names), vitals if entered,
  risk factors if any, triage tier, SHAP explanation sentence,
  top 3 differential with confidence bands, disclaimer,
  "Generated by ArogyaAI (academic prototype — not clinically validated)"
- [ ] window.print() on button click

**Verify:** Screenshot of print preview showing clean card with all fields.

#### 6-B8: ASHA worker mode (1 h) — F19

- [ ] "ASHA Mode" toggle in header
- [ ] When ON: add class `asha-mode` to `<body>`
- [ ] CSS: font-size 18px base, touch-targets 56px, button padding increased
- [ ] Labels use simplified Hindi (defined in bilingual strings object)
- [ ] Differential collapses to 1 entry only
- [ ] Store preference in localStorage: `localStorage.setItem('ashaMode', 'true')`
- [ ] Apply on page load from localStorage

**Verify:** Screenshot of ASHA mode active with large text and simplified Hindi banner.

#### 6-B9: Condition information cards (1 h) — F20

- [ ] AGENT: generate web/data/condition_info.json
  Format: `{"Disease Name": {"en": "...", "hi": "...", "when_to_see": "..."}}`
  All 41 class names from data_manifest.json must be keys.
  2 sentences each: what it is, then what it commonly involves.
  `when_to_see`: one line on when professional care is needed.
- [ ] Each differential entry is tappable (not just the expander)
- [ ] Bottom sheet: 2-sentence description + when_to_see + common symptoms list
- [ ] Hindi + English based on current language toggle
- [ ] Bump sw.js CACHE_VERSION, add condition_info.json to PRECACHE

**Verify:** Tap any differential entry → info sheet slides up in current language.

---

### TIER C — Impressive (5 h) — only if Tier B is committed and working

#### 6-C1: Assessment history (1.5 h) — F14

- [ ] localStorage key: `arogya_history` → JSON array, max 5 entries
- [ ] Each entry: {timestamp, profile, symptoms, vitals, riskFactors, tier, topDisease}
- [ ] "History" tab in page navigation
- [ ] Per entry: date, symptom chips, tier badge, top disease
- [ ] Tap to re-open (repopulate inputs with that entry's data)
- [ ] "Clear all history" button with confirmation
- [ ] Notice: "Stored on this device only. Never sent anywhere."

**Verify:** Complete 2 assessments → History tab shows both with correct data.

#### 6-C2: Follow-up questions (2 h) — F9

- [ ] AGENT: generate web/data/followups.json
  Format:
  ```json
  {
    "Fungal infection": [
      {"q_en": "How long have you had the symptoms?", "q_hi": "यह लक्षण कितने समय से हैं?",
       "options": [
         {"label_en": "Less than 1 week", "label_hi": "1 हफ्ते से कम", "confidence_delta": 0},
         {"label_en": "1-4 weeks", "label_hi": "1-4 हफ्ते", "confidence_delta": 0.05},
         {"label_en": "More than a month", "label_hi": "एक महीने से अधिक", "confidence_delta": 0.1}
       ]
      }
    ]
  }
  ```
  All 41 class names from data_manifest.json must be keys.
- [ ] After initial result: show 2 follow-up questions for the top predicted disease
- [ ] Applying answers adjusts the displayed probability ± confidence_delta
- [ ] Label the change: "Refined based on your answers"
- [ ] The underlying model output does not change — only the displayed confidence band
- [ ] Bump sw.js CACHE_VERSION, add followups.json to PRECACHE

**Verify:** Get a ROUTINE result → follow-up questions appear for top disease → answer changes confidence band.

#### 6-C3: Family profiles (2 h) — F7

- [ ] Profile switcher dropdown in header (icon + name)
- [ ] "Add profile" → name input + age + sex + risk factors form
- [ ] Up to 4 profiles stored in localStorage
- [ ] Active profile shown in header. Switch reloads the form with that profile's defaults.
- [ ] History filtered by active profile
- [ ] "For: [name]" label on every result
- [ ] Delete profile button (with confirmation)

**Verify:** Create 2 profiles → switch between them → each shows different history.

#### 6-C4: Confidence bands display (30 min) — F13

- [ ] Replace "72%" with "Likely" (>60%), "Possible" (30-60%), "Uncertain" (<30%)
- [ ] Tap the band label → show the actual percentage in a tooltip/popover
- [ ] Apply to all differential entries

**Verify:** Screenshot showing Likely/Possible/Uncertain labels with percentage on tap.

#### 6-C5: Medicine reminders (1.5 h) — F15

- [ ] After ROUTINE result: "💊 Set a reminder to take your medicine?"
- [ ] If yes: time picker (hour + minute) + repeat select (Once / Daily / Twice daily / 3×/day)
- [ ] `Notification.requestPermission()` on user acceptance
- [ ] Schedule with setTimeout / setInterval for same-session, or store in localStorage
  and re-schedule on page load
- [ ] Notification body: "Take your medicine" — NEVER names the drug (S1)
- [ ] If Notification API not supported: hide the feature entirely

**Verify:** Set reminder → notification fires at the specified time.

#### 6-C6: Symptom trend tracker (1.5 h) — F16

- [ ] After each assessment: check all symptoms in the last 5 entries
- [ ] If any symptom appears in 3 or more: show yellow notice below result:
  EN: "You have reported [symptom_name] in [N] of your last 5 checks. If this persists, please see a doctor."
  HI: "[symptom_name] आपने अपनी पिछली 5 जांचों में से [N] में बताया है। यदि यह जारी रहे, तो डॉक्टर से मिलें।"
- [ ] Does NOT change triage tier
- [ ] Only shown when history has ≥ 3 entries

**Verify:** Add the same symptom to 3 assessments → yellow notice appears after 3rd.

#### 6-C7: Rule-set viewer (30 min) — F11

- [ ] "How does this decide?" link at bottom of results
- [ ] Bottom sheet: all red-flag rules rendered as cards
- [ ] Each card: rule ID, conditions in plain language, rationale in current language
- [ ] Prominent header: "⚠ NOT CLINICALLY REVIEWED. Not for use with real patients."

**Verify:** Screenshot of rule viewer showing at least 3 rule cards.

### ⛔ STOP — Phase 6. Await approval.

---

## PHASE 7 — Vignettes, README, demo prep · ~2.5 h

- [ ] 7.1 Create `vignettes/vignettes.csv`:
```csv
id,description,symptoms,age_years,sex,risk_factors,vitals,expected_tier
V01,"52yo male, chest pain radiating to left arm, sweating","chest_pain|sweating",52,"M","{""heart_disease"":false}","{}",EMERGENCY
V02,"2-month-old baby with high fever","high_fever",0.17,"F","{}","{}",EMERGENCY
V03,"35yo with fever and severe neck stiffness","high_fever|stiff_neck",35,"M","{}","{}",EMERGENCY
V04,"45yo, sudden weakness in right arm and headache","weakness_in_limbs|headache",45,"F","{}","{}",EMERGENCY
V05,"28yo with skin rash and itching, no fever","skin_rash|itching",28,"M","{}","{}",ROUTINE
V06,"22yo with common cold symptoms","continuous_sneezing|runny_nose|cough",22,"F","{}","{}",ROUTINE
V07,"40yo with mild back pain","back_pain",40,"M","{}","{}",ROUTINE
V08,"31yo with mild stomach ache after eating","stomach_pain",31,"F","{}","{}",ROUTINE
V09,"55yo diabetic with high fever, chills, vomiting","high_fever|chills|vomiting",55,"M","{""diabetes"":true}","{}",URGENT
V10,"38yo with cough and breathing difficulty","cough|breathlessness",38,"M","{}","{}",URGENT
V11,"27yo with 5 days of fatigue and yellow eyes","fatigue|yellowing_of_eyes",27,"F","{}","{}",URGENT
V12,"29yo with fever, but mild, duration 2 days","high_fever",29,"M","{}","{""temp_c"":37.8}",ROUTINE
```

- [ ] 7.2 Write `scripts/run_vignettes.py` — POST each vignette to the browser
  infer function via a Node.js script or directly test the Python engine:

```python
import json, csv
from src.rules.engine import evaluate, get_triage
import joblib, numpy as np

saved = joblib.load('models/lr.joblib')
clf = saved['model']
symptoms_list = saved['symptom_cols']
manifest = json.load(open('data/processed/data_manifest.json'))

results = []
with open('vignettes/vignettes.csv') as f:
    for row in csv.DictReader(f):
        syms = set(row['symptoms'].split('|'))
        age = float(row['age_years'])
        sex = row['sex']
        rf = json.loads(row['risk_factors'])
        vitals = json.loads(row['vitals'])
        expected = row['expected_tier']

        # Red-flag check
        tier, rule_id = evaluate(syms, age, sex, rf, vitals)
        source = 'red_flag'
        if tier is None:
            vec = np.zeros((1, 139), dtype=np.float32)
            for s in syms:
                i = symptoms_list.index(s) if s in symptoms_list else -1
                if i >= 0: vec[0, i] = 1.0
            pred_disease = clf.predict(vec)[0]
            tier = get_triage(pred_disease, 0)
            source = 'model'

        correct = tier == expected
        results.append({'id': row['id'], 'expected': expected, 'got': tier, 'source': source, 'correct': correct})
        print(f"{row['id']} {'✓' if correct else '✗'} expected={expected} got={tier} ({source})")

# Metrics
emergency = [r for r in results if r['expected'] == 'EMERGENCY']
tp = sum(r['got'] == 'EMERGENCY' for r in emergency)
recall = tp / len(emergency) if emergency else 0

non_emerg = [r for r in results if r['expected'] != 'EMERGENCY']
overtriage = sum(r['got'] == 'EMERGENCY' for r in non_emerg) / len(non_emerg) if non_emerg else 0

print(f"\nEmergency recall: {tp}/{len(emergency)} = {recall:.1%}")
print(f"Over-triage rate: {overtriage:.1%}")
print(f"Benchmark: commercial checkers 76.9%, physicians 85.7%")

md = f"# Vignette Results\nDate: {__import__('datetime').date.today()}\n\n"
md += "| ID | Expected | Got | Source | Result |\n|---|---|---|---|---|\n"
for r in results:
    md += f"| {r['id']} | {r['expected']} | {r['got']} | {r['source']} | {'✓' if r['correct'] else '✗'} |\n"
md += f"\n**Emergency recall:** {tp}/{len(emergency)} = {recall:.1%} (benchmark: commercial 76.9%, physicians 85.7%)\n"
md += f"**Over-triage rate:** {overtriage:.1%}\n"
open('results/vignettes.md', 'w').write(md)
print("\nSaved to results/vignettes.md")
```

- [ ] 7.3 Write `README.md` with:
  - What this is and what it is NOT
  - The headline finding: 4,920 → 304 rows, 93.8% duplication
  - Honest accuracy from results/metrics.md with CV scheme
  - Vignette results vs benchmarks
  - Red flags NOT clinically reviewed
  - CDSCO regulatory position (triage = Medical Devices Rules 2017)
  - All 20 features with status (F1–F20)
  - Setup: `pip install -r requirements.txt` → run phases
  - Demo: `python -m http.server 8080 --directory web/`

- [ ] 7.4 Verify the five demo-ready criteria from knowledge/04

**Verify:** paste results/vignettes.md.

### ⛔ STOP — Phase 7. Project complete.

---

## Demo script — 8 minutes

**1. The finding (60s)**
Open data/processed/data_manifest.json live.
Show: `"rows_before": 4920, "rows_after": 304`.
Say: "93.8% of this dataset is exact duplicates. Papers reporting 95-99% are on
the left number. We train on 304."

**2. Red flags (90s)**
Enter: chest_pain + sweating. Press ASSESS.
Show: red screen, "Safety rule RF01 · model not used."
If F11 built: tap "How does this decide?" and show the YAML-derived rules.
Say: "Commercial symptom checkers seek 36.9% of red flags.
This system seeks 100% of the ones we encoded. Because they're written rules."

**3. Explanation (60s)**
Start over. Enter: itching + skin_rash. Press ASSESS.
Show: green screen, "Because you reported itching and skin_rash."
Expand "Why ranked lower?" for the second differential.

**4. Voice (30s)**
Switch to हिं. Tap mic. Say symptoms in Hindi.
Show chips appearing.

**5. ASHA mode (30s)**
Toggle ASHA mode. Show large font, simplified Hindi banner.

**6. PHC locator (30s)**
Show the EMERGENCY result's PHC list with distances and call buttons.

**7. Offline (60s)**
DevTools → Network → Offline.
Reload page. Enter: itching + skin_rash. Press ASSESS. Same result.
Say: "Model is 190 KB gzipped. Works with zero signal."

**8. Honesty (60s)**
Show results/metrics.md. State the real accuracy with the CI.
Say: "These rules have not been reviewed by a clinician — that's on the
README. CDSCO classifies triage software as a medical device.
Stating your own limitations before being asked is what separates a project from a demo."
