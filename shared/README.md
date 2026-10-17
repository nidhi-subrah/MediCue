# shared/

The contract between backend and frontend. Both read these files directly; there is no copy.

| File | Read by | Purpose |
|---|---|---|
| `catalog.json` | backend (`app/catalog.py`), frontend (`src/catalog.ts` via Vite alias `@shared`) | The ~20 needs, tap vocabulary (body areas, feelings), yes/no questions, chart lookups, risk levels, modes, languages |
| `types.ts` | frontend | TypeScript shapes of every API response and WebSocket message |

## How the catalog drives the model

- **`needs[].prior`**: base prior before context (normalised at load time).
- **`needs[].areas` / `needs[].feelings`**: affinity of each tap for that need. The backend turns these into
  likelihoods `P(tap | need)` with a small background probability for unlisted taps, then mixes in the patient's
  signal reliability.
- **`needs[].question`**: a yes/no question targeting that need. Groups get one question each, plus `extra_questions`.
- **`risk_levels`**: `miss_cost` drives the asymmetric loss (missing chest pain costs 12.5x confusing thirst with
  cold), `urgency` drives the delay cost.
- **`lookups`**: chart fields the decision engine can pull. `p_true` gives `P(field is flagged | need)`.
  Keys are need ids or `group:<id>`.

## Changing things

Adding a need, tap or lookup is a catalog-only change. Changing an API shape means editing `types.ts`
and the backend together, on the `shared` branch first, then merging into `backend` and `frontend`.
