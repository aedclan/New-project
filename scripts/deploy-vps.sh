#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PERSONAL_HUB_APP_DIR:-/opt/personal-hub/New-project}"
DOMAIN="${PERSONAL_HUB_DOMAIN:-https://www.aedclan.com}"
HEALTH_URL="${PERSONAL_HUB_HEALTH_URL:-http://127.0.0.1:5173/healthz}"

cd "$APP_DIR"

echo "== Personal Hub VPS 部署开始 =="
echo "项目目录：$APP_DIR"
echo "当前版本：$(git rev-parse --short HEAD)"

if [[ ! -f .env ]]; then
  echo "错误：缺少 .env 文件。请先复制 .env.example 并配置生产环境变量。"
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

echo "检查本机健康接口：$HEALTH_URL"
curl -fsS "$HEALTH_URL" >/dev/null

echo "检查域名访问：$DOMAIN"
curl -fsSI "$DOMAIN" >/dev/null || echo "提醒：域名检查失败，请检查 Cloudflare / Nginx / HTTPS 配置。"

echo "== 部署完成 =="
echo "上线地址：$DOMAIN"
echo "上一个版本已记录：$PREVIOUS_COMMIT"
