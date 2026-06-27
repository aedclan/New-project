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
    echo "缂哄皯鍥炴粴鐗堟湰銆傜敤娉曪細./scripts/rollback-vps.sh <commit>"
    echo "鏈€杩戞彁浜わ細"
    git log --oneline -5
    exit 1
  fi
fi

echo "== Personal Hub 鍥炴粴寮€濮?=="
echo "鐩爣鐗堟湰锛?TARGET_COMMIT"

npm run backup:data || echo "鎻愰啋锛氬洖婊氬墠澶囦唤澶辫触锛岃鎵嬪姩纭鏁版嵁鐘舵€併€?
git checkout "$TARGET_COMMIT"
docker compose up -d --build
docker compose ps
curl -fsS "$HEALTH_URL" >/dev/null

echo "== 鍥炴粴瀹屾垚 =="
echo "褰撳墠鐗堟湰锛?(git rev-parse --short HEAD)"
