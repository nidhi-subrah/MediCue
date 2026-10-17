# frontend/

React + Vite + TypeScript. No UI framework; one stylesheet (`src/styles.css`) with light/dark tokens, IBM Plex from Google Fonts, and line icons in `src/components/Icon.tsx`.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, proxies /api and /ws to BACKEND_URL (default http://localhost:8000)
npm run build      # type-check + build to dist/ (the backend serves dist/ when it exists)
```

| Route | Who | What |
|---|---|---|
| `#/` | demo | Pick a role and a synthetic patient |
| `#/patient/:id` | patient | Tablet: body map → feeling → yes/no questions. Grid (body map), large-tile and switch-scanning modes, optional read-aloud, welfare-check overlay. "Engine" reveals the live belief, conformal set and decision scores |
| `#/nurse` | nurse | Live alerts (WebSocket) in SBAR format, one-tap confirmation, Catch It Early trend flags with 8-day sparklines |
| `#/family/:personId` | family / regular nurse | Answer consult questions; request a welfare check |
| `#/research` | clinical lead | Review findings: validate, reject, needs more data |

Types come from `../shared/types.ts` and the catalog from `../shared/catalog.json` via the `@shared` alias.
