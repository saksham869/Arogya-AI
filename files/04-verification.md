# 04 — Verification Standards

A task is NOT complete because code was written.
It is complete when the evidence listed below has been captured and shown to the user.
Never mark done based on the code looking correct. RUN IT.

---

## Evidence required per artifact

| Artifact | Evidence |
|---|---|
| Data pipeline | Terminal: "N → M rows (K duplicates removed)" + manifest contents |
| Model training | Printed metrics table in results/metrics.md with CV scheme and date |
| ONNX export | Both parity lines printing PASS + raw and gzipped file sizes in KB |
| Red-flag engine | `pytest tests/test_red_flags.py -v` showing 25+ tests passing |
| API endpoint | Real curl command + actual JSON response pasted verbatim |
| UI component | **Browser screenshot** of the rendered result |
| Offline mode | **Browser screenshot taken with DevTools Network set to Offline** |
| Vignettes | results/vignettes.md with emergency recall percentage |

**A description of what you expect to see is not evidence. A screenshot is.**

---

## Browser subagent workflow for Phase 6

For any UI verification:
1. Start server: `python -m http.server 8080 --directory web/`
2. Navigate browser subagent to `http://localhost:8080`
3. Enter the exact test input specified in the task
4. Screenshot the result
5. For offline: DevTools → Network tab → Offline → reload → screenshot

Do this for every Tier A, B, C feature. Screenshots are mandatory.

---

## Failure handling

If verification fails:
1. Do NOT mark the task complete
2. Do NOT silently retry more than twice with different code
3. Report: what was expected, what actually happened, exact error text
4. Return to PLANNING mode

Never:
- Disable an assertion to make it pass
- Lower a threshold to make a test pass
- Add `check_additivity=False` to SHAP without telling the user
- Report a metric without its CV scheme and de-duplication counts

---

## The five demo-ready criteria

All five must hold simultaneously before demo:

1. `pytest` passes with no failures or skips
2. Browser: entering `chest_pain` + `breathlessness` → tier EMERGENCY, source `red_flag`, model not called
3. Browser: entering `itching` + `skin_rash` → tier ROUTINE, green banner, SHAP sentence visible
4. Browser: DevTools Offline → reload → same result as step 3
5. results/metrics.md and results/vignettes.md exist with real numbers

Report which gate is failing, not overall progress percentage.

---

## Key numbers to watch

| Metric | Expected | Source |
|---|---|---|
| De-dup | 4,920 → ~304 | Phase 1 DONE: exact 304 |
| Accuracy (41 diseases) | 85–95% | Phase 2 |
| ONNX parity | 0 label mismatches, prob diff < 1e-4 | Phase 3 |
| Red-flag tests | 25+ passing | Phase 4 |
| Emergency recall | > 76.9% (commercial checkers) | Phase 7 |
| Over-triage rate | Report it. Low is better. | Phase 7 |

Benchmarks from Sutaria et al. (2025): commercial checkers 76.9% emergency recall,
physicians 85.7%. Target: beat 76.9%.
