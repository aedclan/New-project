# GitHub 到 VPS 完整流程

仓库地址：

```text
https://github.com/aedclan/New-project
```

VPS 项目路径：

```bash
/opt/New-project
```

## 一、本地提交到 GitHub

```powershell
cd "C:\Users\aouiaiu\Documents\New project 2"
npm run check
git status
git add .
git commit -m "feat: 本次更新说明"
git push origin main
```

## 二、VPS 首次拉取项目

```bash
cd /opt
git clone https://github.com/aedclan/New-project.git New-project
cd /opt/New-project
cp .env.example .env
nano .env
```

配置 `.env` 后启动：

```bash
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 三、VPS 后续更新

推荐：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

手动备用：

```bash
cd /opt/New-project
git pull --ff-only
docker compose up -d --build
docker compose ps
```

## 四、查看日志

```bash
cd /opt/New-project
docker compose logs --tail=120 personal-hub
```

## 五、回滚

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```
