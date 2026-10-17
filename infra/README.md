# infra/

| File | Purpose |
|---|---|
| `docker-compose.yml` | TimescaleDB + app (API + built UI), with Caddy for HTTPS under the `domain` profile |
| `deploy/vultr.md` | Step-by-step Vultr + GoDaddy Registry domain + Tiger Data deployment |
| `deploy/setup-vultr.sh` | Idempotent server bootstrap (Docker, firewall, clone, compose up) |
| `deploy/Caddyfile` | Reverse proxy with automatic TLS |
| `../.github/workflows/ci.yml` | Backend tests + engine metrics + frontend build on every push/PR |

Local full stack: `cd infra && cp .env.example .env && docker compose up --build`, then open http://localhost:8000.
