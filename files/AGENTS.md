# AGENTS.md — ArogyaAI

This is the single entry point. Read this first. Then read the files listed in Section 2.

---

## 1. Project in one line

A symptom triage PWA for rural India: patient enters symptoms in Hindi or English,
gets EMERGENCY / URGENT / ROUTINE with a plain-language explanation, works offline,
190 KB, no backend required for the demo.

---

## 2. Read these files before writing a single line of code

```
1. .antigravity/knowledge/01-project-context.md     What + Why + Constraints
2. .antigravity/knowledge/02-architecture.md        How + Settled decisions
3. .antigravity/knowledge/03-features.md            All 20 features + data contracts
4. .antigravity/knowledge/04-verification.md        What counts as done
5. task.md                                          Phase-by-phase checklist
```

Read them in order. Summarise back to the user before writing code.
The summary must cover: current phase status, why zipmap=False, why LR not RF,
what a STOP gate means, how many features and in what tiers.

---

## 3. Current phase status

| Phase | Status |
|---|---|
| 0 — Scaffold | ✅ COMPLETE |
| 1 — Data pipeline | ✅ COMPLETE — 4,920 → 304 rows, commit d8e8b23 |
| 2 — Train + evaluate | ⬜ NOT STARTED |
| 3 — ONNX export | ⬜ NOT STARTED |
| 4 — Red-flag engine | ⬜ NOT STARTED |
| 5 — FastAPI backend | ⬜ OFF CRITICAL PATH |
| 6 — PWA frontend | ⬜ NOT STARTED |
| 7 — Vignettes + demo | ⬜ NOT STARTED |

Start at Phase 2.

---

## 4. The three rules that override everything else

**S1:** Never output a medication name. Ever. Not brand, not generic, not a dose.
Medicine reminders say "Take your medicine" — the app never knows what medicine.

**S4:** The red-flag engine runs BEFORE the model. If it fires, the model is NOT called.
The model's output cannot override a red-flag escalation.

**H3:** If something does not work, say so. Never fabricate a passing test or a metric.

---

## 5. STOP gates

Every phase ends with a hard STOP. Do not begin the next phase until the user
types `approved` or `continue`. Show real evidence — terminal output or screenshot —
not a description of what you expect to see.

---

## 6. Repo layout

```
arogyaai/
  data/
    raw/dataset.csv              Kaggle itachi9604 (never edited)
    processed/
      clean.csv                  304 rows, 131 symptoms, 41 diseases
      data_manifest.json         SHA-256 + counts + class list
  src/
    preprocessing/dedupe.py      Phase 1 DONE
    models/train.py              Phase 2
    rules/
      red_flags.yaml             Phase 4 — source of truth
      severity.yaml              Phase 4 — source of truth
      engine.py                  Phase 4
    api/
      main.py                    Phase 5 (optional)
      schemas.py                 Phase 5 (optional)
  scripts/
    export_onnx.py               Phase 3
    run_vignettes.py             Phase 7
  web/
    index.html                   Phase 6
    sw.js                        Phase 6
    js/
      infer.js                   Phase 6 — core inference
      render.js                  Phase 6 — result display
      app.js                     Phase 6 — wiring
    models/
      arogya.onnx                Phase 3 (zipmap=False MANDATORY)
      arogya.onnx.gz             Phase 3
    data/
      attributions.json          Phase 3 — coef + mean + classes + symptoms
      symptoms.json              Phase 1 DONE
      red_flags.json             Phase 4 — browser copy of red_flags.yaml
      severity.json              Phase 3 (placeholder) → Phase 4 (final)
      cooccurrence.json          Phase 2 step 2.11
      symptom_descriptions.json  Phase 6-B5 — agent writes this
      condition_info.json        Phase 6-B9 — agent writes this
      followups.json             Phase 6-C2 — agent writes this
      phc_ghaziabad.json         Phase 6-B6 — agent writes this
  tests/
  vignettes/vignettes.csv        Phase 7
  results/
    metrics.md                   Phase 2
    vignettes.md                 Phase 7
```
