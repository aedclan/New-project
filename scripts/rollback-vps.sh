#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${PERSONAL_HUB_APP_DIR:-/opt/personal-hub/New-project}"
HEALTH_URL="${PERSONAL_HUB_HEALTH_URL:-http://127.0.0.1:5173/healthz}"
TARGET_COMMIT="${1:-}"

cd "$APP_DIR"

if [[ -z "$TARGET_COMMIT" ]]; then
  if [[ -f .last-deploy-commit ]]; then
    TARGET_COMMIT="$(cat .last-deploy-commit)"
  else
    echo "缺少回滚版本。用法：./scripts/rollback-vps.sh <commit>"
    echo "最近提交："
    git log --oneline -5
    exit 1
  fi
fi

echo "== Personal Hub 回滚开始 =="
echo "目标版本：$TARGET_COMMIT"

npm run backup:data || echo "提醒：回滚前备份失败，请手动确认数据状态。"
git checkout "$TARGET_COMMIT"
docker compose up -d --build
docker compose ps
curl -fsS "$HEALTH_URL" >/dev/null

echo "== 回滚完成 =="
echo "当前版本：$(git rev-parse --short HEAD)"
