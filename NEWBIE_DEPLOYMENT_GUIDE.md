# 新手部署指南

当前 VPS 项目路径：

```bash
/opt/New-project
```

## 1. 进入 VPS

使用 SSH 登录你的 RackNerd VPS。

## 2. 准备目录并拉取项目

```bash
cd /opt
git clone https://github.com/aedclan/New-project.git New-project
cd /opt/New-project
```

如果目录已经存在：

```bash
cd /opt/New-project
git pull --ff-only
```

## 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

至少填写：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
PERSONAL_HUB_APP_DIR=/opt/New-project
PERSONAL_HUB_DOMAIN=https://www.aedclan.com
```

## 4. 启动网站

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 5. 后续更新

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

## 6. 出问题查看日志

```bash
cd /opt/New-project
docker compose logs --tail=120 personal-hub
```
