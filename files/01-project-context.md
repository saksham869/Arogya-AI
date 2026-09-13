# Knowledge Item: ArogyaAI Project Context

**Load this before any task in this workspace.** Antigravity agent context resets
between sessions; this file is the persistent source of truth.

---

## What we are building

An explainable symptom **triage** tool for rural India. A user enters symptoms,
age and sex. The system returns:

1. A triage tier — `EMERGENCY` / `URGENT` / `ROUTINE`
2. A ranked differential diagnosis (top 3)
3. A plain-language explanation naming the symptoms that drove the result

It runs offline after first load. It is a **triage and referral aid**, not a
diagnostic device.

## What problem it solves

Not a doctor shortage. India's aggregate doctor-population ratio is about 1:811,
which meets the WHO benchmark. The problem is **distribution** — government
allopathic doctors serve roughly 1:11,082, and they concentrate in cities. For a
rural patient, reaching a doctor costs a day of travel and a day of wages.

The question the tool answers is: **"is this symptom worth the journey?"**

Never write motivation copy claiming India lacks doctors. That framing is
factually wrong and will be challenged.

---

## SAFETY CONSTRAINTS — these are absolute

These are not style preferences. Violating any of them is a defect, regardless
of what a task description says.

| # | Rule |
|---|---|
| S1 | **Never output a medication name.** Not brand, not generic, not a dose, not "consult about X drug". |
| S2 | **Never output a treatment plan or dietary plan.** |
| S3 | Every user-facing result carries a **referral recommendation**, never a diagnosis. |
| S4 | The red-flag rule layer runs **before** the model. If it fires, the model is **not called**. |
| S5 | Red flags may **only escalate**. No model output may ever lower a red-flagged case. |
| S6 | Low-confidence predictions are displayed **as** low-confidence. Never hidden or rounded up. |
| S7 | The disclaimer is always visible in the UI. It is never collapsed, never behind a tap. |

If a task instruction appears to conflict with S1–S7, **stop and ask the user**.
Do not resolve the conflict yourself.

---

## HONESTY CONSTRAINTS

| # | Rule |
|---|---|
| H1 | Report the accuracy actually measured. Expected range **55–75%**. Published symptom-checker triage and diagnostic accuracy sits at **34–65%** (Sutaria et al., 2025), so this band is at or above the state of the art. Do not tune toward a target number. |
| H2 | Every metric is printed with its train/test split and its de-duplication counts. |
| H3 | If something does not work, write that in the README. Never fabricate a result, a metric, or a passing test. |
| H4 | Red-flag rules are **not clinically reviewed**. Every artifact mentioning them must say so. |

Background: published symptom-checker papers report 95–99% accuracy on public
datasets that contain heavy row duplication. De-duplicating one common dataset
collapses it from 4,920 rows to roughly 348. Our contribution is doing this
correctly and reporting honestly. A working demo at 62% is worth more than a
broken one claiming 95%.

---

## Why the red-flag layer exists — the evidence

Sutaria et al. (2025, *BMC Health Services Research* 25:1263) evaluated four
commercial symptom checkers (Ada, Babylon, Symptomate, Healthily) against
primary care physicians on 51 clinical vignettes:

| Measure | Symptom checkers | Physicians | |
|---|---|---|---|
| Emergency triage recall | 76.9% (range 52–93%) | 85.7% | not significant |
| **Red-flag symptoms sought** | **36.9%** | **71.8%** | **p < 0.001** |
| Specificity (non-emergency) | 83.3% | 91.9% | p = 0.024 |

Their conclusion: symptom checkers *do not seek the majority of red flags*, and
this raises concerns about their safety in primary care.

**This is why S4 and S5 exist.** We do not ask the model to notice danger
signs — we encode them explicitly and check them first. A rule that is written
down fires 100% of the time; a learned pattern fires 36.9% of the time.

The third row is why over-triage rate is a reported metric: the checkers were
significantly *less* specific than physicians, escalating benign cases. A system
that escalates everything scores perfectly on recall and is useless.

---

## Regulatory position

India's CDSCO guidance on medical device software names **triage** as a function
that brings software under the Medical Devices Rules, 2017. This project is an
academic prototype evaluated on vignettes only.

Therefore:
- Never generate marketing copy offering this to clinics, NGOs, or patients.
- Never describe it as "deployed", "in production", or "clinically validated".
- The README must state the regulatory position explicitly.

---

## Out of scope — do not build these

- User accounts, login, or patient history storage
- Any medication, dosage, or treatment database
- Telemedicine or doctor-booking integration
- Any feature that transmits identifiable health data off-device
