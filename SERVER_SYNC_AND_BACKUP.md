# 服务器同步与备份

VPS 项目路径：

```bash
/opt/New-project
```

## 数据位置

```text
/app/data/personal-hub.sqlite
/app/data/personal-hub-data.json
/app/data/users/user-用户ID.json
/app/data/backups
```

这些路径位于 Docker 容器内，并通过 Docker volume 持久化保存。

## 手动备份

```bash
cd /opt/New-project
npm run backup:data
```

## 查看备份

```bash
cd /opt/New-project
npm run backup:list
```

## 恢复用户数据

```bash
cd /opt/New-project
docker compose stop personal-hub
node scripts/restore-persistent-data.mjs --file user-1-xxxx.json --target user:1 --yes
docker compose up -d
```

## 自动备份配置

`.env` 中配置：

```bash
PERSONAL_HUB_BACKUP_DIR=/app/data/backups
PERSONAL_HUB_BACKUP_KEEP=14
PERSONAL_HUB_BACKUP_AUTO_ENABLED=true
PERSONAL_HUB_BACKUP_INTERVAL_HOURS=24
PERSONAL_HUB_BACKUP_ON_START=false
```

## 同步说明

登录账号后，前端会通过服务器接口读写当前账号的数据。同一个账号在不同浏览器登录，应使用同一份服务器数据。
