#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PERSONAL_HUB_APP_DIR:-/opt/New-project}"
DOMAIN="${PERSONAL_HUB_DOMAIN:-https://www.aedclan.com}"
HEALTH_URL="${PERSONAL_HUB_HEALTH_URL:-http://127.0.0.1:5173/healthz}"

cd "$APP_DIR"

echo "== Personal Hub VPS 閮ㄧ讲寮€濮?=="
echo "椤圭洰鐩綍锛?APP_DIR"
echo "褰撳墠鐗堟湰锛?(git rev-parse --short HEAD)"

if [[ ! -f .env ]]; then
  echo "閿欒锛氱己灏?.env 鏂囦欢銆傝鍏堝鍒?.env.example 骞堕厤缃敓浜х幆澧冨彉閲忋€?
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

echo "妫€鏌ユ湰鏈哄仴搴锋帴鍙ｏ細$HEALTH_URL"
curl -fsS "$HEALTH_URL" >/dev/null

echo "妫€鏌ュ煙鍚嶈闂細$DOMAIN"
curl -fsSI "$DOMAIN" >/dev/null || echo "鎻愰啋锛氬煙鍚嶆鏌ュけ璐ワ紝璇锋鏌?Cloudflare / Nginx / HTTPS 閰嶇疆銆?

echo "== 閮ㄧ讲瀹屾垚 =="
echo "涓婄嚎鍦板潃锛?DOMAIN"
echo "涓婁竴涓増鏈凡璁板綍锛?PREVIOUS_COMMIT"
