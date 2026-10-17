# Deploying to Vultr with a GoDaddy Registry domain

One VM runs everything: FastAPI (both engines, WebSockets), the built frontend, TimescaleDB (or Tiger Data),
and Caddy for HTTPS.

## 1. Domain (GoDaddy Registry)
1. Register the domain (e.g. a `.health`, `.care` or `.app` name).
2. In the registrar's DNS, add an **A record** for `@` (and optionally `www`) pointing to the Vultr
   instance's public IPv4. TTL 600 is fine.

## 2. Vultr instance
1. Deploy **Cloud Compute → Ubuntu 24.04**, 2 vCPU / 4 GB is plenty. Add your SSH key.
2. SSH in as root and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/nidhi-subrah/MediCure/main/infra/deploy/setup-vultr.sh -o setup.sh
   bash setup.sh            # first run creates /opt/silentsignal/infra/.env and stops
   nano /opt/silentsignal/infra/.env   # set DOMAIN, POSTGRES_PASSWORD, GEMINI_API_KEY, CORS_ORIGINS
   bash setup.sh            # builds and starts db + app + caddy
   ```
3. Caddy gets a Let's Encrypt certificate as soon as DNS resolves. Check `https://<domain>/api/health`.

## 3. Tiger Data instead of the local database (recommended for the Tiger track)
Create a service in Tiger Cloud, copy the connection string into `DATABASE_URL` in `.env`, then re-run
`bash setup.sh`. The local db container still starts but the app talks only to Tiger.
The backend creates the hypertables and continuous aggregates on startup (`backend/app/store/schema.sql`).

## Updating
```bash
cd /opt/silentsignal && git pull && cd infra && docker compose --profile domain up -d --build
```

## Demo checklist
- `/api/health` shows `"store": "TimescaleStore"` and `"gemini": true`.
- Open `/#/nurse` on a laptop and `/#/patient/p-chen` on a tablet or phone. A chest tap should reach the nurse in under a second.
