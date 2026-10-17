#!/usr/bin/env bash
# One-time setup on a fresh Vultr Ubuntu 24.04 instance. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/<you>/MediCure/main/infra/deploy/setup-vultr.sh | bash
# or copy it over and run it. Then edit /opt/silentsignal/infra/.env and run the last command again.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/nidhi-subrah/MediCure.git}"
BRANCH="${BRANCH:-main}"
DIR=/opt/silentsignal

apt-get update -y
apt-get install -y ca-certificates curl git ufw
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin "$BRANCH" && git -C "$DIR" checkout "$BRANCH" && git -C "$DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR"
fi

cd "$DIR/infra"
[ -f .env ] || { cp .env.example .env; echo "Created $DIR/infra/.env. Fill it in, then re-run this script."; exit 0; }

docker compose --profile domain up -d --build
docker compose ps
