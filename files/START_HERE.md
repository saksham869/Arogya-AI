# START HERE

This document set supersedes all previous Antigravity documents.
Delete the old docs before copying these in.

---

## Step 1 — Copy files into your repo

```
arogyaai/
  AGENTS.md
  task.md
  .antigravity/knowledge/
    01-project-context.md
    02-architecture.md
    03-features.md
    04-verification.md
  START_HERE.md          (this file — for you, not the agent)
```

Verify `.antigravity/` is present (it is a hidden directory):
```bash
ls -la | grep antigravity
# should show: drwxr-xr-x  .antigravity
```

---

## Step 2 — Kickoff prompt (paste this once per session)

```
Read these files in order:
1. AGENTS.md
2. .antigravity/knowledge/01-project-context.md
3. .antigravity/knowledge/02-architecture.md
4. .antigravity/knowledge/03-features.md
5. .antigravity/knowledge/04-verification.md
6. task.md

Then give me back, in under 20 lines:
- Which phases are already complete and what the evidence was
- What phase we start from
- Why zipmap=False is mandatory
- Why Logistic Regression is the primary model (with the caveat)
- What the 20 features are, in their tiers
- What you must do at a STOP gate
- What counts as evidence in VERIFICATION mode

Do not write any code until I approve your summary.
```

If the summary is wrong about phase status, zipmap, LR reasoning, or features:
say "Re-read [file]" and check again before approving.

---

## Step 3 — Phase execution prompt

For each phase:

```
Execute PHASE [N] from task.md.

Rules:
- Execute exactly what task.md says for this phase only.
- Stop at the STOP gate. Do not begin Phase [N+1] without my explicit approval.
- Verify per knowledge/04-verification.md: show real evidence (terminal output or screenshot).
- If any task conflicts with a safety constraint (S1-S7) or architecture decision (AD-1 to AD-15), stop and ask me rather than deciding yourself.
- Tick each checkbox in task.md as you complete it.
```

For Phase 6, run one tier at a time:
```
Execute Phase 6 TIER A only.
```
```
Execute Phase 6 TIER B only.
```
```
Execute Phase 6 TIER C only.
```

---

## Phase 2 — what to watch for

**Expected accuracy: 85–95%.** On 41 diseases after de-duplication this is normal,
not suspicious. Do NOT re-run expecting different numbers.

**RepeatedStratifiedKFold (n_splits=5, n_repeats=10)** is mandatory.
Single 80/20 split gives 61 test rows — one error = 1.64 point accuracy swing.

**If RF beats LR materially (>3 points), STOP.** AD-1, AD-3, AD-4 all change.

---

## Phase 6 — build order matters

Tier A → commit → Tier B → commit → Tier C.
Never batch. Never start the next tier until the current one is committed and working.

Demo minimum: Tier A + F17 (PHC) + F18 (print card) + F19 (ASHA mode).
These four are in Tier B. You need Tier A working first.

---

## When the agent goes wrong

| Symptom | Response |
|---|---|
| Started next phase without approval | "You passed a STOP gate. Revert Phase N+1 work and report Phase N evidence." |
| Marked done without running | "Run it and paste the actual output." |
| Suggested TensorFlow Lite | "See AD-2. TFLite cannot convert sklearn. Use skl2onnx." |
| Added React or a framework | "See AD-12. Vanilla JS only, no build step." |
| Named a medication | "Safety constraint S1. Remove it and add a test preventing recurrence." |
| Vitals entered feature vector | "See AD-6. Vitals only gate red-flag rules. Never enter the 139-feature vector." |
| Risk factors entered feature vector | "See AD-7. Risk factors only gate red-flag rules. Never enter the model." |
| Lowered an assertion threshold | "Never weaken assertions. Report the failure and return to PLANNING." |
| Generated phc_ghaziabad.json with fake entries | "See AD-11. Use the real entries in AD-11 exactly." |

---

## Cut order if running short on time

Never cut: F1 F2 F3 F4 F17 F18 F19

Cut in this order if behind:
F16 → F15 → F14 → F9 → F11 → F13 → F7 → F8 → F12 → F6 → F5 → F10 → F20
