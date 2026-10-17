# Risk engine backtest: held-out patients (synthetic data)

Engine fa826536, hold 4 h, seed 20261017, generated 2026-10-17T13:38:23+00:00.

- Detection: 3 of 4 storylines flagged before the outcome (75%); 2 of 4 reached elevated (50%).
- Lead time: median 34.4 h (1.4 days), range 21.9-57.0 h (0.9-2.4 days), n = 3.
- False flags on stable controls: 0.27 elevated and 0.27 of any level per patient-week (1 elevated, 1 total over 3.7 patient-weeks). Budget 0.5 / 1.0: within.

| Patient | Storyline | First flag | Lead before outcome | Elevated lead | Other-risk flags |
|---|---|---|---|---|---|
| syn-h1 | fall | watch | 21.9 h (0.9 d) | no flag | 2 |
| syn-h2 | dehydration | watch | 34.4 h (1.4 d) | 22.4 h (0.9 d) | 0 |
| syn-h3 | delirium | watch | 57.0 h (2.4 d) | 49.0 h (2.0 d) | 1 |
| syn-h4 | fall | - | no flag | no flag | 0 |

| Control | Confounder | Patient-weeks | False elevated | False watch |
|---|---|---|---|---|
| syn-h5 | low_appetite | 1.24 | 0 | 0 |
| syn-h6 | bad_day | 1.24 | 1 | 0 |
| syn-h7 | med_change | 1.25 | 0 | 0 |

![Lead time chart](backtest_test.svg)

All data is synthetic. Flags are prompts for clinician review, not diagnoses.
