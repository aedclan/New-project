# Personal Hub 数据安全与部署自动化

本文档用于生产使用。当前 VPS 项目路径为：

```bash
/opt/New-project
```

目标：保证数据不丢、账号安全、部署可重复、出问题可回滚。

## 一、数据安全

### 1. 账号与数据隔离

当前系统采用真实账号登录：

- 认证数据库：`/app/data/personal-hub.sqlite`
- 用户数据：`/app/data/users/user-用户ID.json`
- 旧版全局数据：`/app/data/personal-hub-data.json`

后端会根据当前登录 Session 自动读取对应用户数据，普通用户不能访问其他用户的数据。

### 2. 生产环境管理员账号

VPS 的 `.env` 至少配置：

```bash
PERSONAL_HUB_ADMIN_USERNAME=你的管理员账号
PERSONAL_HUB_ADMIN_PASSWORD=至少12位强密码
PERSONAL_HUB_SECURE_COOKIE=true
PERSONAL_HUB_APP_DIR=/opt/New-project
PERSONAL_HUB_DOMAIN=https://www.aedclan.com
PERSONAL_HUB_HEALTH_URL=http://127.0.0.1:5173/healthz
PUBLIC_SITE_URL=https://www.aedclan.com
AUTH_EMAIL_FROM=Personal Hub <notice@example.com>
AUTH_PASSWORD_RESET_MAX_AGE=3600
```

检查生产配置：

```bash
npm run check:production
```

### 3. 注册安全

默认关闭注册：

```bash
PERSONAL_HUB_REGISTRATION_ENABLED=false
```

如果需要开放注册，建议必须配置注册码：

```bash
PERSONAL_HUB_REGISTRATION_ENABLED=true
PERSONAL_HUB_REGISTRATION_CODE=一串只有你知道的邀请码
```

邮箱注册还需要配置邮件服务：

```bash
RESEND_API_KEY=你的 Resend API Key
AUTH_EMAIL_FROM=Personal Hub <notice@example.com>
PUBLIC_SITE_URL=https://www.aedclan.com
AUTH_EMAIL_VERIFICATION_MAX_AGE=86400
AUTH_PASSWORD_RESET_MAX_AGE=3600
```

## 二、备份与恢复

### 1. 手动备份

在 VPS 执行：

```bash
cd /opt/New-project
npm run backup:data
```

备份会覆盖：

- 认证数据库；
- 旧版全局数据；
- 所有用户独立数据文件。

### 2. 查看备份

```bash
cd /opt/New-project
npm run backup:list
```

### 3. 恢复数据

恢复前建议先停止容器：

```bash
cd /opt/New-project
docker compose stop personal-hub
```

恢复认证数据库：

```bash
node scripts/restore-persistent-data.mjs --file personal-hub-xxxx.sqlite --target auth --yes
```

恢复指定用户数据：

```bash
node scripts/restore-persistent-data.mjs --file user-1-xxxx.json --target user:1 --yes
```

恢复后启动：

```bash
docker compose up -d
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 三、VPS 一键部署

首次给脚本执行权限：

```bash
cd /opt/New-project
chmod +x scripts/deploy-vps.sh scripts/rollback-vps.sh
```

以后每次本地推送 GitHub 后，VPS 执行：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

脚本会自动：

1. 加载 `.env`；
2. 检查生产配置；
3. 运行项目检查；
4. 部署前备份；
5. 记录当前 Git 版本；
6. 拉取 GitHub 最新代码；
7. 重新构建 Docker；
8. 检查容器和健康接口；
9. 检查域名访问。

## 四、回滚

如果新版本上线后出问题：

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```

指定回滚版本：

```bash
./scripts/rollback-vps.sh 41d7e92
```

## 五、标准更新流程

本地：

```powershell
npm run check
git status
git add .
git commit -m "feat: 本次更新说明"
git push origin main
```

VPS：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

验证：

```bash
docker compose ps
docker compose logs --tail=80 personal-hub
curl http://127.0.0.1:5173/healthz
curl -I https://www.aedclan.com
```

## 六、上线前检查

- `.env` 已配置真实管理员账号。
- 管理员密码不是默认密码。
- 注册默认关闭，或已配置注册码。
- `npm run check` 通过。
- `npm run check:production` 通过。
- `npm run backup:data` 可以生成备份。
- `docker compose ps` 显示容器 healthy。
- `/healthz` 返回正常。
- `https://www.aedclan.com` 可以访问。
