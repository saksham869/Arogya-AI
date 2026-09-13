# START HERE — Driving this build in Antigravity

## 1. Install the docs

Copy into your empty repo root, preserving the dot-directory:

```
arogyaai/
├── .antigravity/knowledge/01-project-context.md
├── .antigravity/knowledge/02-architecture-decisions.md
├── .antigravity/knowledge/03-verification-standards.md
├── implementation_plan.md
├── task.md
└── START_HERE.md
```

Put `data/raw/dataset.csv` in place before Phase 1 — the Kaggle *Disease Symptom
Prediction* dataset by itachi9604.

## 2. Why it is split this way

Antigravity agents **lose context between sessions**. Anything you only say in
chat is gone when you reopen the IDE. So:

| File | Job |
|---|---|
| `.antigravity/knowledge/*` | Survives resets. Constraints and settled decisions live here, not in chat |
| `implementation_plan.md` | The technical spec — architecture, data contracts, API shape |
| `task.md` | The executable checklist with hard STOP gates |

You never re-explain the project. You point at the files.

## 3. Kickoff prompt

Paste this once, at the start:

```
Read .antigravity/knowledge/01-project-context.md,
02-architecture-decisions.md, and 03-verification-standards.md, then
implementation_plan.md and task.md.

Summarise back to me, in under 15 lines:
- what we are building
- the three safety constraints you consider most important
- why we use Logistic Regression rather than Random Forest
- why zipmap must be False
- what you must do at a STOP gate

Do not write any code yet.
```

**Check the summary before continuing.** If it gets zipmap or the LR reasoning
wrong, it did not read the knowledge files — say so and have it re-read.

## 4. Phase loop

For each phase:

```
Execute PHASE <n> from task.md. Follow it exactly.

Rules:
- One phase only. Stop at the ⛔ STOP gate.
- Verify per .antigravity/knowledge/03-verification-standards.md and
  paste the real evidence — actual terminal output or a screenshot, not a
  description of what you expect.
- Tick the checkboxes in task.md as you complete them.
- If a task conflicts with a safety constraint or an architecture decision,
  stop and ask instead of resolving it yourself.
```

Then review the evidence and reply `approved` — or push back.

For Phase 6, run the sub-phases separately: *"Execute PHASE 6a only."*

## 5. The two gates that actually matter

**After Phase 1** — look at the before/after row count. That number governs
every claim the project can honestly make. If de-duplication removes most of the
dataset, that is not a bug; it is the finding your demo leads with.

**After Phase 2** — if Random Forest beats Logistic Regression by a real margin
on the real data, stop and tell me. My verification ran on synthetic data with
additive symptom signatures, which structurally favours linear models. If RF
wins, the model-size and browser-SHAP decisions change and Phase 3 needs
replanning.

## 6. When the agent goes wrong

| Symptom | Say this |
|---|---|
| Started Phase N+1 without approval | "You passed a STOP gate. Revert anything from Phase N+1 and report Phase N evidence." |
| Marked done without running it | "Verification standards require real output. Run it and paste what it actually printed." |
| Suggested TensorFlow Lite | "See AD-2. TFLite cannot convert sklearn estimators. Use skl2onnx." |
| Lowered a threshold to pass | "Never weaken an assertion to pass. Report the failure and return to PLANNING." |
| Added a dependency | "AD fixed technology list. Ask before adding anything outside it." |
| Output a medication name | "Safety constraint S1. Remove it and add a test that prevents recurrence." |

## 7. Two-day schedule

| | Phases | Hours |
|---|---|---|
| **Day 1** | 0, 1, 2, 3, 4 | ~7.5 |
| **Day 2** | 5, 6, 7 | ~8.5 |

Behind schedule? Cut in this order: Phase 7 vignettes → Hindi strings →
service worker → Phase 2 baselines.

**Never cut:** the de-duplication manifest, the red-flag engine, or the SHAP
explanation. Those three are the project.

## 8. Demo, 6 minutes

1. **Problem (45s)** — not a doctor shortage, a distribution problem. Government doctors ~1:11,082. The question is whether a symptom is worth a day's travel.
2. **The finding (60s)** — open `data_manifest.json`, show rows before and after. Say: *papers reporting 95–99% are reporting on the left-hand number.* Lead with this.
3. **Red flags (90s)** — enter chest pain with breathlessness. EMERGENCY fires instantly. Point out the model was never called. Open `red_flags.yaml` and show it is readable data a doctor could edit.
4. **Explanation (60s)** — normal case. Show the differential and the plain-language reason. Note the SHAP is exact and computed on the device.
5. **Offline (60s)** — DevTools offline, reload, predict. Model is under 200 KB gzipped.
6. **Honesty (45s)** — state the real accuracy, that red flags are not clinically reviewed, and that CDSCO classifies triage software as a medical device.

Point 6 is not a weakness. Stating your own limitations before you are asked is
what separates a project from a demo.
