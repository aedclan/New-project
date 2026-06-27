# 更新流程

## 本地

```powershell
npm run check
git status
git add .
git commit -m "feat: 本次更新说明"
git push origin main
```

## VPS

当前路径：

```bash
/opt/New-project
```

更新：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

手动更新备用命令：

```bash
cd /opt/New-project
git pull --ff-only
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 回滚

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```
