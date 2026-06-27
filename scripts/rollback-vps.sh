#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PERSONAL_HUB_APP_DIR:-/opt/New-project}"
HEALTH_URL="${PERSONAL_HUB_HEALTH_URL:-http://127.0.0.1:5173/healthz}"
TARGET_COMMIT="${1:-}"

cd "$APP_DIR"

if [[ -z "$TARGET_COMMIT" ]]; then
  if [[ -f .last-deploy-commit ]]; then
    TARGET_COMMIT="$(cat .last-deploy-commit)"
  else
    echo "Missing rollback commit. Usage: ./scripts/rollback-vps.sh <commit>"
    echo "Recent commits:"
    git log --oneline -5
    exit 1
  fi
fi

echo "== Personal Hub rollback start =="
echo "Target commit: $TARGET_COMMIT"

npm run backup:data || echo "WARN: backup before rollback failed. Check data manually."
git checkout "$TARGET_COMMIT"
docker compose up -d --build
docker compose ps
curl -fsS "$HEALTH_URL" >/dev/null

echo "== Rollback completed =="
echo "Current commit: $(git rev-parse --short HEAD)"
