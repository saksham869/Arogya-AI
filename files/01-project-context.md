# 01 — Project Context

---

## What we are building

ArogyaAI is a symptom triage Progressive Web App for rural India.

A patient or ASHA worker enters symptoms in Hindi or English, adds age, sex,
and optional risk factors and vital signs. The system returns:

- A triage tier: EMERGENCY / URGENT / ROUTINE
- A ranked differential diagnosis (top 3)
- A plain-language SHAP explanation: "Because you reported itching and skin rash."
- For EMERGENCY: the nearest government health centre with tap-to-call
- For all results: a printable card to hand to the doctor

The system works offline after the first load. The model is 190 KB gzipped.
This is a **triage and referral aid**, not a diagnostic device.

---

## Phase status

| Phase | Status | Evidence |
|---|---|---|
| 0 — Scaffold | ✅ DONE | pytest 1 passed |
| 1 — Data pipeline | ✅ DONE | 4,920→304 rows, commit d8e8b23 |
| 2 — Train | ⬜ | |
| 3 — ONNX | ⬜ | |
| 4 — Red flags | ⬜ | |
| 5 — API | ⬜ OFF CRITICAL PATH | Build after Phase 6 |
| 6 — Frontend | ⬜ | 20 features, Tier A/B/C |
| 7 — Demo | ⬜ | |

Phase 1 detail:
- Raw: 4,920 rows. After de-duplication: **304 rows** (4,616 removed, 93.8%)
- 131 symptoms, 41 diseases
- Cleaned: "Hypertension " → "Hypertension", "Diabetes " → "Diabetes"
- Cleaned: "dischromic _patches" → "dischromic_patches"
- data_manifest.json written with SHA-256 + class counts
- web/data/symptoms.json written (131 symptom IDs)
- 4 pytest tests passing

---

## The problem

Not a doctor shortage. India's aggregate doctor-patient ratio (~1:811) meets
WHO's 1:1000 benchmark. The problem is **distribution**: government allopathic
doctors serve ~1:11,082 and concentrate in cities.

For a rural patient, reaching a doctor costs a day of travel and ~₹800.
The question is: **"is this symptom worth the journey?"**

Never write motivation copy claiming India lacks doctors. That is wrong.

---

## The headline finding

4,920 rows → 304 rows. 93.8% of the most-used public symptom dataset is exact
duplicates. Papers reporting 95–99% accuracy are reporting on 4,920 rows.
We train on 304. This is the project's primary contribution.

---

## Safety constraints — absolute, no exceptions

| ID | Rule |
|---|---|
| **S1** | **Never output a medication name.** Not brand, not generic, not a dose. Medicine reminders say "Take your medicine" only — the system never knows what medicine. |
| S2 | Never output a treatment plan, dietary plan, or home remedy. |
| S3 | Every result carries a referral recommendation, never a diagnosis. |
| **S4** | **Red-flag engine runs BEFORE the model.** If it fires, model is NOT called. |
| S5 | Red flags only escalate. No model output can lower a red-flagged case. |
| S6 | Low-confidence shown as low-confidence. Never hidden or rounded up. |
| S7 | Disclaimer always visible. Never collapsed, never behind a tap. |

If a task conflicts with S1–S7, **stop and ask the user**.

---

## Honesty constraints

| ID | Rule |
|---|---|
| H1 | Report the accuracy measured. On 41 diseases after de-duplication, expect **85–95%** — this is normal, NOT evidence of leakage. Published large-disease-space accuracy is 34–65%. |
| H2 | Every metric printed with CV scheme and de-duplication counts. |
| H3 | If something does not work, say so. Never fabricate a result or a passing test. |
| H4 | Red-flag rules are NOT clinically reviewed. Every artifact must say so. |

---

## Why the red-flag layer exists

Sutaria et al. (2025), BMC Health Services Research 25:1263:

| Measure | Symptom checkers | Physicians | p-value |
|---|---|---|---|
| Emergency triage recall | 76.9% (range 52–93%) | 85.7% | 0.299 |
| **Red-flag symptoms sought** | **36.9%** | **71.8%** | **< 0.001** |
| Specificity | 83.3% | 91.9% | 0.024 |

A written rule fires 100% of the time. A learned pattern fires 36.9% of the time.
This is why S4 and S5 are non-negotiable.

---

## Competitive position

| | Practo/MFine | DxGPT | Ada | ArogyaAI |
|---|---|---|---|---|
| Offline | No | No | No | **Yes** |
| Explainable | No | No | No | **Exact SHAP** |
| Free | No | Yes | Yes | **Yes** |
| Handles emergency | No | Refuses | Refuses | **Yes, deterministic** |
| Hindi voice | No | Auto | No | **Yes** |
| Rural viable | No | No | No | **Yes** |

---

## Regulatory

CDSCO guidance names triage as a trigger under India's Medical Devices Rules 2017.
This is an academic prototype. Never describe as deployed or clinically validated.

---

## Never build

Medication databases, treatment plans, dietary advice, telemedicine, doctor booking,
server-side identifiable health data storage, user accounts with cloud sync.
