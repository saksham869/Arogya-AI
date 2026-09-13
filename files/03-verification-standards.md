# Knowledge Item: Verification Standards

Antigravity operates in PLANNING → EXECUTION → **VERIFICATION**. This file
defines what counts as evidence in VERIFICATION for this project.

---

## The rule

**A task is not complete because code was written. It is complete when the
evidence below has been captured and shown to the user.**

Never mark a task done based on the code looking correct. Run it.

## Evidence required per artifact type

| Artifact | Evidence that counts |
|---|---|
| Data pipeline | Terminal output showing the before → after row counts, plus the written `data_manifest.json` |
| Model training | The printed metrics table, plus the saved `results/metrics.md` |
| ONNX export | Both parity assertions printing PASS, plus the reported file sizes |
| Rule engine | `pytest` output showing the count of passing tests |
| API endpoint | A real `curl` command and its actual JSON response |
| UI | A **browser screenshot** of the rendered result |
| Offline behaviour | A screenshot taken with the network disabled in DevTools |

## Use the browser subagent for anything visual

Phases 6 and 7 produce UI. For those:

1. Start the static server
2. Navigate to the page with the browser subagent
3. Enter the actual test input described in the task
4. **Screenshot the result**
5. For the offline test: set network to offline in DevTools, reload, repeat,
   screenshot

A description of what the UI should look like is not evidence. A screenshot is.

## Failure reporting

If verification fails:

1. **Do not** mark the task complete
2. **Do not** silently retry with different code more than twice
3. Report to the user: what was expected, what actually happened, and the exact
   error text
4. Return to PLANNING mode

Never disable an assertion, lower a threshold, or add `check_additivity=False`
to make a test pass. If a threshold is genuinely wrong, say so and ask.

## Definition of "the demo works"

All five must hold simultaneously:

1. `pytest` passes with no skips
2. `curl` against `/predict` with a chest-pain-plus-radiation payload returns
   `tier: EMERGENCY` and `tier_source: red_flag`
3. The browser renders a triage banner, an explanation, and a differential
4. With DevTools network set to offline, reloading the page still produces a
   prediction
5. `results/metrics.md` and `results/vignettes.md` both contain real measured
   numbers

Until all five hold, the project is not demo-ready. Report which of the five are
failing rather than reporting overall progress as a percentage.
