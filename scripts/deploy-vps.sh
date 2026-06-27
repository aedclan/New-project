#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PERSONAL_HUB_APP_DIR:-/opt/New-project}"
DOMAIN="${PERSONAL_HUB_DOMAIN:-https://www.aedclan.com}"
HEALTH_URL="${PERSONAL_HUB_HEALTH_URL:-http://127.0.0.1:5173/healthz}"

cd "$APP_DIR"

echo "== Personal Hub VPS deploy start =="
echo "App dir: $APP_DIR"
echo "Current commit: $(git rev-parse --short HEAD)"

if [[ ! -f .env ]]; then
  echo "ERROR: .env file is missing. Copy .env.example to .env and configure production variables first."
  exit 1
fi

set -a
source .env
set +a

node scripts/check-production-env.mjs
npm run check
npm run backup:data

PREVIOUS_COMMIT="$(git rev-parse --short HEAD)"
echo "$PREVIOUS_COMMIT" > .last-deploy-commit

git pull --ff-only
docker compose up -d --build
docker compose ps

echo "Checking health endpoint: $HEALTH_URL"
curl -fsS "$HEALTH_URL" >/dev/null

echo "Checking domain: $DOMAIN"
curl -fsSI "$DOMAIN" >/dev/null || echo "WARN: domain check failed. Check Cloudflare, Nginx, or HTTPS settings."

echo "== Deploy completed =="
echo "Site: $DOMAIN"
echo "Previous commit recorded: $PREVIOUS_COMMIT"
