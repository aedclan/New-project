# VPS 部署说明

当前推荐路径：

```bash
/opt/New-project
```

## 首次部署

```bash
cd /opt
git clone https://github.com/aedclan/New-project.git New-project
cd /opt/New-project
cp .env.example .env
nano .env
```

`.env` 至少需要配置：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
PERSONAL_HUB_DOMAIN=https://你的域名
PUBLIC_SITE_URL=https://你的域名
```

如果启用财务 AI 问答，再配置：

```bash
FINANCE_AI_API_KEY=你的大模型API Key
FINANCE_AI_MODEL=你的模型名称
FINANCE_AI_API_URL=https://api.openai.com/v1/chat/completions
```

启动：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 数据持久化

Docker 会持久化两类数据：

- `/app/data`：账号、账本、备份等核心数据。
- `/app/assets/login-covers`：登录封面上传的图片、动图和视频。

## 后续更新

```bash
cd /opt/New-project
chmod +x scripts/deploy-vps.sh scripts/rollback-vps.sh
./scripts/deploy-vps.sh
```

## 常用排查

```bash
docker compose ps
docker compose logs --tail=120 personal-hub
docker compose restart personal-hub
curl http://127.0.0.1:5173/healthz
```
