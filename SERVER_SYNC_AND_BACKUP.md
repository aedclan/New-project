# V0.25 服务器同步与备份说明

这份文档用于记录当前项目的服务器数据同步方案。当前阶段仍保留浏览器本地存储，但已经可以把数据手动保存到 VPS 的 Docker 数据卷中，作为进入真实登录和数据库前的安全底座。

## 1. 当前同步逻辑

当前网站有两份数据位置：

- 浏览器本地数据：网页日常使用时主要读取这里。
- 服务器数据文件：通过设置页手动保存到 VPS，用于长期备份和跨浏览器恢复。

服务器数据文件默认位置：

```text
/app/data/personal-hub-data.json
```

Docker Compose 已经把 `/app/data` 挂载为持久化数据卷：

```yaml
volumes:
  - personal-hub-data:/app/data
```

所以执行 `docker compose up -d --build` 或重建容器时，服务器数据文件不会随容器一起丢失。

## 2. VPS 配置同步密钥

在 VPS 项目目录进入仓库：

```bash
cd /opt/personal-hub/New-project
```

创建或编辑 `.env`：

```bash
nano .env
```

加入下面内容：

```env
PERSONAL_HUB_SYNC_TOKEN=请换成一串足够长的随机密码
PERSONAL_HUB_BACKUP_KEEP=14
PERSONAL_HUB_ADMIN_USERNAME=admin
PERSONAL_HUB_ADMIN_PASSWORD=请换成一个强密码
PERSONAL_HUB_SESSION_MAX_AGE=604800
```

建议同步密钥至少 24 位，不要使用生日、手机号、简单英文。

示例：

```env
PERSONAL_HUB_SYNC_TOKEN=8Yk3mA9sQx2026ChangeThisLongToken
PERSONAL_HUB_BACKUP_KEEP=14
PERSONAL_HUB_ADMIN_USERNAME=admin
PERSONAL_HUB_ADMIN_PASSWORD=ChangeThisAdminPassword2026
PERSONAL_HUB_SESSION_MAX_AGE=604800
```

保存后重建容器：

```bash
docker compose up -d --build
```

检查服务：

```bash
curl http://127.0.0.1:5173/healthz
curl http://127.0.0.1:5173/api/data/status
```

如果同步密钥已配置，第二条命令会看到：

```json
{"ok":true,"configured":true}
```

检查真实登录是否配置：

```bash
curl http://127.0.0.1:5173/api/auth/session
```

如果管理员账号已配置，会看到：

```json
{"ok":true,"configured":true,"authenticated":false}
```

## 3. 真实登录配置

当前 `V0.25` 已加入 SQLite 登录底座。

数据库文件默认位置：

```text
/app/data/personal-hub.sqlite
```

这个文件同样位于 Docker 数据卷 `/app/data` 中，容器重建后不会丢失。

第一次配置管理员账号时，在 `.env` 中填写：

```env
PERSONAL_HUB_ADMIN_USERNAME=admin
PERSONAL_HUB_ADMIN_PASSWORD=请换成一个强密码
```

重建容器后，系统会自动创建管理员用户：

```bash
docker compose up -d --build
```

如果后续想重置管理员密码，可以临时在 `.env` 增加：

```env
PERSONAL_HUB_ADMIN_RESET=true
```

然后执行：

```bash
docker compose up -d --build
```

确认能用新密码登录后，建议把这行删除：

```env
PERSONAL_HUB_ADMIN_RESET=true
```

再执行一次：

```bash
docker compose up -d --build
```

这样可以避免每次重启都强制覆盖密码。

## 4. 在网页中使用同步

打开网站：

[https://www.aedclan.com](https://www.aedclan.com)

进入：

```text
设置 -> 服务器数据同步
```

第一次使用时：

1. 在“同步密钥”输入 VPS `.env` 里的 `PERSONAL_HUB_SYNC_TOKEN`。
2. 点击“检查服务器”，确认服务器已配置。
3. 点击“保存到服务器”，把当前浏览器数据保存到 VPS。
4. 确认保存成功后，可以打开“自动保存到服务器”。

以后换浏览器或换电脑时：

1. 打开网站。
2. 登录本地编辑模式。
3. 进入“设置 -> 服务器数据同步”。
4. 输入同步密钥。
5. 如果当前浏览器没有重要新数据，点击“从服务器读取”。
6. 如果当前浏览器和服务器两边都有新数据，点击“合并服务器数据”。

注意：“从服务器读取”会覆盖当前浏览器里的本地数据。执行前建议先点“导出 JSON”留一份本地备份。

“合并服务器数据”会先打开合并前数据对照弹窗，按模块列出本地独有、服务器独有、冲突记录和相同记录。确认后才会按记录 ID 合并本地和服务器数据；如果两边存在相同 ID，优先保留更新时间较新的记录。合并完成后会同时写入当前浏览器和服务器。

### 自动保存说明

打开“自动保存到服务器”后：

- 新增、修改、删除数据后，会延迟约 1 秒自动保存到服务器。
- 自动保存需要当前浏览器已经保存同步密钥。
- 自动保存不会自动从服务器读取数据。
- 从服务器读取数据仍然需要手动点击，避免服务器旧数据误覆盖当前浏览器数据。

## 5. 手动备份服务器数据

进入 VPS 项目目录：

```bash
cd /opt/personal-hub/New-project
```

执行：

```bash
docker compose exec personal-hub npm run backup:data
```

备份文件会保存到容器内：

```text
/app/data/backups/
```

由于 `/app/data` 是 Docker 数据卷，备份文件也会持久保存。

查看备份：

```bash
docker compose exec personal-hub ls -lah /app/data/backups
```

默认保留最近 14 份备份，可以通过 `.env` 修改：

```env
PERSONAL_HUB_BACKUP_KEEP=30
```

修改后执行：

```bash
docker compose up -d --build
```

## 6. 从备份恢复

先查看备份文件：

```bash
docker compose exec personal-hub ls -lah /app/data/backups
```

选择要恢复的文件，例如：

```text
personal-hub-data-2026-06-26T10-20-30-000Z.json
```

恢复命令：

```bash
docker compose exec personal-hub sh -c 'cp /app/data/backups/personal-hub-data-2026-06-26T10-20-30-000Z.json /app/data/personal-hub-data.json'
```

然后打开网站，在设置页点击“从服务器读取”，把恢复后的服务器数据同步回浏览器。

## 7. 当前阶段的边界

当前 `V0.25.0` 已完成：

- 服务器同步 API。
- 同步密钥保护。
- Docker 数据卷。
- 设置页手动同步入口。
- 手动备份脚本。
- SQLite 真实登录底座。
- HttpOnly Cookie 会话。
- 可选自动保存到服务器。
- 本地与服务器数据合并入口。

尚未完成：

- 业务数据拆分进 SQLite 表。
- 自动定时备份。
- 多用户隔离。

下一轮建议继续做：

1. SQLite 数据表设计。
2. 真实登录接口。
3. 登录后自动从服务器读取数据。
4. 保存数据时自动写入服务器。
5. 定时备份任务。
