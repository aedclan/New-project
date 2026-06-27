# VPS 一键部署脚本使用说明

更新时间：2026-06-27

当前 VPS 项目路径：

```bash
/opt/New-project
```

## 一、脚本用途

`scripts/deploy-vps.sh` 是 VPS 上的一键部署脚本。

它的作用是：在 VPS 上自动完成“拉取 GitHub 最新代码、检查项目、备份数据、重建 Docker、检查网站是否正常”的完整流程。

正常使用方式：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

## 二、脚本会自动做什么

执行后，脚本会依次完成：

1. 进入项目目录 `/opt/New-project`。
2. 读取 `.env` 环境变量。
3. 检查生产环境配置。
4. 运行项目检查。
5. 部署前先备份数据。
6. 记录当前 Git 版本，方便出问题时回滚。
7. 从 GitHub 拉取最新代码。
8. 重新构建并启动 Docker。
9. 检查 Docker 容器状态。
10. 检查本地健康接口 `/healthz`。
11. 检查域名访问状态。

## 三、标准更新流程

### 1. 本地开发完成后

在本地电脑项目目录执行：

```powershell
npm run check
git status
git add .
git commit -m "本次更新说明"
git push origin main
```

### 2. VPS 拉取并部署

在 VPS 执行：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

脚本会自动从 GitHub 拉取最新代码，并重新启动 Docker。

## 四、首次使用前准备

### 1. 确认项目路径

```bash
cd /opt/New-project
```

### 2. 确认脚本存在

```bash
ls -la scripts | grep vps
```

应该看到：

```text
deploy-vps.sh
rollback-vps.sh
```

### 3. 给脚本执行权限

```bash
chmod +x scripts/deploy-vps.sh scripts/rollback-vps.sh
```

### 4. 确认 `.env` 已配置

```bash
nano .env
```

至少需要配置：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
PERSONAL_HUB_APP_DIR=/opt/New-project
PERSONAL_HUB_DOMAIN=https://www.aedclan.com
PERSONAL_HUB_HEALTH_URL=http://127.0.0.1:5173/healthz
```

## 五、脚本不是开机自动部署

`deploy-vps.sh` 不是服务器开机自动执行脚本。

它不会在 VPS 重启后自动拉取 GitHub。

它是你手动执行的部署命令：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

推荐当前阶段先手动执行。这样更安全，因为每次上线都可以确认：

- 本地代码已经提交；
- GitHub 已经推送成功；
- VPS 拉取的是你想上线的版本；
- 部署后网站状态正常。

## 六、如果想做开机自动部署

后续可以用 `systemd` 或定时任务实现自动部署，但不建议现在直接开启。

原因：

- 开机自动拉取代码可能把未验证的新代码直接上线。
- 如果 GitHub 拉取失败，可能影响服务启动判断。
- 自动部署失败时，不如手动部署容易排查。

更稳妥的方式是：

1. Docker 服务开机自动启动。
2. 网站使用上一次稳定版本运行。
3. 你确认新功能没问题后，手动执行 `deploy-vps.sh` 更新。

## 七、回滚脚本

如果一键部署后网站异常，可以执行：

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```

它会尝试回滚到上一次部署前记录的 Git 版本，并重新构建 Docker。

也可以指定版本：

```bash
./scripts/rollback-vps.sh 41d7e92
```

## 八、常见问题

### 1. 提示脚本不存在

说明 VPS 没有拉到最新代码。

执行：

```bash
cd /opt/New-project
git fetch origin
git pull --ff-only origin main
ls -la scripts | grep vps
```

### 2. `git pull` 提示本地文件会被覆盖

说明 VPS 上有本地改动。

先备份并暂存：

```bash
cd /opt/New-project
cp docker-compose.yml docker-compose.yml.vps-backup
git stash push -m "vps local change before pull" -- docker-compose.yml
git pull --ff-only origin main
```

### 3. 部署后网站打不开

查看容器状态：

```bash
cd /opt/New-project
docker compose ps
docker compose logs --tail=120 personal-hub
curl http://127.0.0.1:5173/healthz
```

### 4. 想确认当前线上版本

```bash
cd /opt/New-project
git log --oneline -5
docker compose ps
```

