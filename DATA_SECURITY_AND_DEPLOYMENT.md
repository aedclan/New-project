# Personal Hub 数据安全与部署自动化

本文档用于当前项目的生产使用。目标是保证数据不丢、账号安全、部署可重复、出问题可回滚。

## 一、数据安全策略

### 1. 账号与数据隔离

当前系统采用真实账号登录：

- 用户账号保存在 SQLite：`/app/data/personal-hub.sqlite`
- 用户数据保存在独立 JSON 文件：`/app/data/users/user-用户ID.json`
- 旧版全局数据保存在：`/app/data/personal-hub-data.json`

后端根据当前登录 Session 自动读取对应用户数据，普通用户不能访问其他用户的数据。

### 2. 生产环境必须配置管理员账号

VPS 的 `.env` 必须配置：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
```

不建议继续使用原型账号 `admin / hub2026`。

检查生产配置：

```bash
npm run check:production
```

该命令会检查：

- 是否配置管理员账号；
- 管理员密码是否过弱；
- 如果开放注册，是否配置了注册码；
- 是否配置了备份相关环境变量。

### 3. 注册安全

默认关闭注册：

```bash
PERSONAL_HUB_REGISTRATION_ENABLED=false
```

如果确实需要开放注册，建议必须配置注册码：

```bash
PERSONAL_HUB_REGISTRATION_ENABLED=true
PERSONAL_HUB_REGISTRATION_CODE=一串只有你知道的邀请码
```

## 二、备份与恢复

### 1. 自动备份

Docker Compose 已经配置自动备份环境变量：

```bash
PERSONAL_HUB_BACKUP_DIR=/app/data/backups
PERSONAL_HUB_BACKUP_KEEP=14
PERSONAL_HUB_BACKUP_AUTO_ENABLED=true
PERSONAL_HUB_BACKUP_INTERVAL_HOURS=24
PERSONAL_HUB_BACKUP_ON_START=false
```

自动备份会覆盖：

- 认证数据库；
- 旧版全局数据；
- 所有用户独立数据文件。

### 2. 手动备份

在 VPS 项目目录执行：

```bash
npm run backup:data
```

查看备份列表：

```bash
npm run backup:list
```

### 3. 恢复数据

恢复前建议先停掉容器，避免恢复过程中被写入覆盖：

```bash
docker compose stop personal-hub
```

恢复认证数据库：

```bash
node scripts/restore-persistent-data.mjs --file personal-hub-xxxx.sqlite --target auth --yes
```

恢复旧版全局数据：

```bash
node scripts/restore-persistent-data.mjs --file personal-hub-data-xxxx.json --target data --yes
```

恢复指定用户数据：

```bash
node scripts/restore-persistent-data.mjs --file user-1-xxxx.json --target user:1 --yes
```

恢复后重新启动：

```bash
docker compose up -d
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 三、VPS 一键部署

### 1. 首次准备

进入 VPS 项目目录：

```bash
cd /opt/personal-hub/New-project
```

复制环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
nano .env
```

至少填写：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
PERSONAL_HUB_APP_DIR=/opt/personal-hub/New-project
PERSONAL_HUB_DOMAIN=https://www.aedclan.com
PERSONAL_HUB_HEALTH_URL=http://127.0.0.1:5173/healthz
```

给脚本执行权限：

```bash
chmod +x scripts/deploy-vps.sh scripts/rollback-vps.sh
```

### 2. 一键更新

以后每次本地推送 GitHub 后，VPS 执行：

```bash
./scripts/deploy-vps.sh
```

脚本会自动执行：

1. 进入项目目录；
2. 加载 `.env`；
3. 检查生产环境配置；
4. 运行项目检查；
5. 先做一次数据备份；
6. 记录当前 Git 版本；
7. 拉取 GitHub 最新代码；
8. 重新构建 Docker；
9. 检查容器状态；
10. 检查健康接口；
11. 检查域名访问。

### 3. 回滚

如果新版本上线后出问题，执行：

```bash
./scripts/rollback-vps.sh
```

脚本会优先读取 `.last-deploy-commit`，回滚到上一次部署前记录的版本。

也可以指定版本：

```bash
./scripts/rollback-vps.sh 41d7e92
```

## 四、本地到 GitHub 到 VPS 的标准流程

### 1. 本地开发完成后

```powershell
npm run check
git status
git add .
git commit -m "feat: 数据安全和部署自动化"
git push origin main
```

### 2. VPS 更新

```bash
cd /opt/personal-hub/New-project
./scripts/deploy-vps.sh
```

### 3. 验证网站

```bash
docker compose ps
docker compose logs --tail=80 personal-hub
curl http://127.0.0.1:5173/healthz
curl -I https://www.aedclan.com
```

浏览器打开：

```text
https://www.aedclan.com
```

## 五、上线前检查清单

- `.env` 已配置真实管理员账号。
- 管理员密码不是默认密码。
- 注册默认关闭，或已配置注册码。
- Docker 数据卷没有删除。
- `npm run check` 通过。
- `npm run check:production` 通过。
- `npm run backup:data` 可以生成备份。
- `docker compose ps` 显示容器 healthy。
- `/healthz` 返回正常。
- 域名可以访问。
- 登录、退出、新增、修改、删除数据正常。
- 同账号多设备数据同步正常。

## 六、常见问题

### 1. 登录后没有数据

优先检查当前登录账号是否正确。多用户模式下，每个账号的数据是隔离的。

### 2. 更新后数据不见了

先不要继续写入新数据，执行：

```bash
npm run backup:list
docker compose logs --tail=120 personal-hub
```

确认是否是账号切换、数据迁移、或数据卷挂载问题。

### 3. 部署失败

查看日志：

```bash
docker compose logs --tail=120 personal-hub
```

必要时回滚：

```bash
./scripts/rollback-vps.sh
```
