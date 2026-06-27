# 部署说明

当前 VPS 项目路径：

```bash
/opt/New-project
```

## 推荐架构

```text
浏览器 -> Cloudflare / HTTPS -> VPS -> Docker 容器 personal-hub:5173
```

## 首次部署

```bash
cd /opt
git clone https://github.com/aedclan/New-project.git New-project
cd /opt/New-project
cp .env.example .env
nano .env
```

`.env` 至少配置：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
PERSONAL_HUB_APP_DIR=/opt/New-project
PERSONAL_HUB_DOMAIN=https://www.aedclan.com
PERSONAL_HUB_HEALTH_URL=http://127.0.0.1:5173/healthz
```

启动：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 后续更新

推荐使用一键部署脚本：

```bash
cd /opt/New-project
chmod +x scripts/deploy-vps.sh scripts/rollback-vps.sh
./scripts/deploy-vps.sh
```

## 回滚

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```

## 常用排查

```bash
docker compose ps
docker compose logs --tail=120 personal-hub
docker compose restart personal-hub
curl http://127.0.0.1:5173/healthz
```
