# 03 — Features and Data Contracts

---

## The 20 features

### GROUP A — Core (must ship, ~3.5 h)

**F1 — Offline inference**
Model + rules + SHAP + all JSON assets work with zero signal after first load.
Service worker cache-first. ~190 KB ONNX gzipped.

**F2 — Exact SHAP explanation**
`phi_i = coef[ci][i] * (x_i - mean_i)`. Verified 0.00e+00. Computed in browser.
Rendered as: "Because you reported itching and skin rash."

**F3 — Red-flag layer before AI**
12 core rules + vitals-based rules + risk-factor rules in YAML.
Fires before model. Escalate-only. Bilingual rationale + action per rule.

**F4 — Voice input Hindi/English**
Web Speech API, `hi-IN` and `en-IN`. Microphone button.
Transcript matched against symptom IDs. Fail-graceful (hide button if unsupported).

**F5 — Vital signs feed red flags**
Temperature (°C), pulse (bpm), breathing rate (per min). Optional.
Gate specific red-flag rules. Do NOT enter feature vector.

---

### GROUP B — Personalisation (~7 h)

**F6 — Risk factors panel**
6 toggles: Diabetes · Hypertension · Heart disease · Pregnancy · Smoking · Age 60+.
Gate red-flag rules (AD-7). Do NOT enter feature vector.

**F7 — Family profiles**
4 profiles in localStorage: name, age, sex, risk factors.
Profile switcher in header. Assessment history per profile.

**F8 — Co-occurrence prompts**
After 2+ symptoms selected, show ghost chips of frequently co-occurring symptoms.
Generated from clean.csv in Phase 2. Offline JSON. "Also common: [symptom], [symptom]"

**F9 — Follow-up questions**
After first result, show 2 questions for the top predicted disease.
Answers adjust the displayed confidence band only, not the model output.
Agent generates followups.json (41 diseases × 2 questions).

---

### GROUP C — Trust (~3 h)

**F10 — "Why not the others?"**
Under each non-top differential: expandable "Why ranked lower?"
Uses SHAP values already computed. See AD-4 for the exact algorithm.
Renders: "Ranked lower because you did not report high_fever."

**F11 — Rule-set viewer**
"How does this decide?" link → bottom sheet showing all red-flag rules as cards.
In Hindi + English. Header: "NOT CLINICALLY REVIEWED."

**F12 — Symptom descriptions + "I don't know"**
ℹ button on each chip → 1-sentence plain description in Hindi + English.
"Not sure" option: adds symptom flagged as uncertain (greyed, not in feature vector).
Agent generates symptom_descriptions.json (131 entries).

**F13 — Confidence bands**
Replace raw percentages with: Likely (>60%) / Possible (30–60%) / Uncertain (<30%).
Percentage visible on tap only. Honest at 304-row corpus.

---

### GROUP D — Continuity (~5 h)

**F14 — Assessment history**
Last 5 assessments per profile in localStorage. History tab.
Per entry: date, symptom chips, tier badge, top result. Tap to re-open.
One-tap clear. Notice: "Stored on this device only. Never sent anywhere."

**F15 — Medicine reminders (nameless)**
After ROUTINE result: "Set a reminder to take your medicine?"
PWA Notification API. Time picker + repeat (once/daily/twice/three times).
Notification text: "Take your medicine." Never names the drug. (S1)
Hide feature entirely if Notification API unsupported.

**F16 — Symptom trend tracker**
After saving to history: check if any symptom in 3+ of last 5 assessments.
Yellow notice: "You have reported [symptom] in [N] of your last 5 checks.
If this persists, please see a doctor." Does not change triage tier.

---

### GROUP E — Action (~3 h)

**F17 — Nearest PHC on EMERGENCY**
On EMERGENCY result: top 3 nearest government health centres.
Geolocation + Haversine + phc_ghaziabad.json (10 entries).
Each shows: name, distance in km, tap-to-call (tel: link).
If geolocation denied: show text list of all 10.

**F18 — Printable card for doctor**
"Save for doctor" button → window.print() with @media print CSS.
Shows: date/time, symptoms entered, vitals if entered, risk factors,
triage tier, SHAP explanation, top differential, disclaimer.

**F19 — ASHA worker mode**
Header toggle. When ON:
- 18px base font, 56px touch targets
- Labels → simplified Hindi regardless of language toggle:
  EMERGENCY → "तुरंत अस्पताल जाएं"
  URGENT → "आज डॉक्टर को दिखाएं"
  ROUTINE → "घर पर देखभाल करें"
- Differential collapses to 1 entry only
- Preference stored in localStorage

**F20 — Condition information cards**
Each differential entry is tappable.
Bottom sheet: what this condition is (2 sentences) + common symptoms + when to see doctor.
Hindi + English. Offline.
Agent generates condition_info.json (41 entries).

---

## Build tiers

| Tier | Features | Hours | Build if |
|---|---|---|---|
| A | F1 F2 F3 F4 basic form and result | 3.5 h | Always |
| B | F5 F6 F8 F10 F12 F17 F18 F19 F20 | 7 h | Tier A committed + working |
| C | F7 F9 F11 F13 F14 F15 F16 | 5 h | Tier B committed + working |

Commit after every individual feature. Never batch.

---

## Cut order

Never cut: F1 F2 F3 F4 F17 F18 F19

Cut in this order if behind:
F16 → F15 → F14 → F9 → F11 → F13 → F7 → F8 → F12 → F6 → F5 → F10 → F20

---

## Data contracts

### POST /predict (Phase 5, optional)

Request:
```json
{
  "symptoms": ["itching", "skin_rash"],
  "age_years": 34,
  "sex": "M",
  "risk_factors": {"diabetes": false, "heart_disease": false, "pregnancy": false},
  "vitals": {"temp_c": null, "pulse_bpm": null, "breathing_rpm": null},
  "lang": "en"
}
```

Response:
```json
{
  "tier": "ROUTINE",
  "tier_source": "model",
  "rule_id": null,
  "rationale": null,
  "action": null,
  "differential": [
    {"disease": "Fungal infection", "probability": 0.72, "confidence_band": "Likely"},
    {"disease": "Allergy", "probability": 0.18, "confidence_band": "Possible"},
    {"disease": "Drug Reaction", "probability": 0.06, "confidence_band": "Uncertain"}
  ],
  "explanation": [
    {"symptom": "itching", "contribution": 0.34},
    {"symptom": "skin_rash", "contribution": 0.28}
  ],
  "why_not_others": [
    {"disease": "Allergy", "reason": "Ranked lower because you did not report watering_from_eyes"}
  ],
  "disclaimer": "This is not a diagnosis. This is not a medical device. It does not replace a doctor."
}
```

On EMERGENCY (red flag):
```json
{
  "tier": "EMERGENCY",
  "tier_source": "red_flag",
  "rule_id": "RF01",
  "rationale": "Chest pain with these features can indicate a heart attack.",
  "action": "Go to the nearest hospital now.",
  "differential": [],
  "explanation": [],
  "why_not_others": [],
  "disclaimer": "..."
}
```

---

## UI wireframe — three states

### Empty form
```
+---------------------------------------------+
| ArogyaAI          [EN|हिं]     ● Online     |
+---------------------------------------------+
| What are you feeling?                        |
| [🔍 search symptoms...          ] [🎤]       |
|                                              |
| Selected: [itching ✕] [skin_rash ✕]         |
|                                              |
| ▼ Risk factors (optional)                   |
| [Diabetes] [Hypertension] [Heart disease]   |
| [Pregnancy] [Smoking] [Age 60+]             |
|                                              |
| Age [34]    Sex [Male ▾]                    |
|                                              |
| ┌──────────────────────────────────────────┐|
| │              ASSESS                      ││
| └──────────────────────────────────────────┘|
|                                              |
| ⚠ Not a diagnosis. Not a medical device.    |
|   Does not replace a doctor.                |
+---------------------------------------------+
```

### EMERGENCY result
```
+---------------------------------------------+
| ████████████████████████████████████████    |
| █  ⚠ EMERGENCY                          █    |
| █  Go to the nearest hospital now.      █    |
| ████████████████████████████████████████    |
|                                              |
| Chest pain with breathlessness can indicate |
| a heart attack.                             |
|                                              |
| Safety rule RF01 · model not used           |
|                                              |
| 📍 Nearest health centres:                  |
| MMG District Hospital   1.2 km  [📞 Call]  |
| District Combined Hosp  2.8 km  [📞 Call]  |
|                                              |
| [🖨 Save for doctor]  [Start over]          |
|                                              |
| ⚠ Not a diagnosis. Not a medical device.    |
+---------------------------------------------+
```

### ROUTINE result
```
+---------------------------------------------+
| ┌──────────────────────────────────────────┐|
| │ ✓ ROUTINE — manage at home              ││
| │ You can watch this at home.             ││
| └──────────────────────────────────────────┘|
|                                              |
| Because you reported itching and skin_rash  |
|                                              |
| Possible causes:                            |
| Fungal infection  ████████████░░  Likely    |
|   ▸ Why not others?                         |
| Allergy           ████░░░░░░░░░░  Possible  |
| Drug Reaction     ██░░░░░░░░░░░░  Uncertain |
|                                              |
| [🖨 Save for doctor]  [Start over]          |
|                                              |
| ⚠ Not a diagnosis. Not a medical device.    |
+---------------------------------------------+
```
