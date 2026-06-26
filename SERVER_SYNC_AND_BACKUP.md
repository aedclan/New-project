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

## 2. VPS 配置登录与同步

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
PERSONAL_HUB_BACKUP_AUTO_ENABLED=true
PERSONAL_HUB_BACKUP_INTERVAL_HOURS=24
PERSONAL_HUB_BACKUP_ON_START=false
PERSONAL_HUB_ADMIN_USERNAME=admin
PERSONAL_HUB_ADMIN_PASSWORD=请换成一个强密码
PERSONAL_HUB_SESSION_MAX_AGE=604800
PERSONAL_HUB_REGISTRATION_ENABLED=false
PERSONAL_HUB_REGISTRATION_CODE=
```

`PERSONAL_HUB_ADMIN_USERNAME` 和 `PERSONAL_HUB_ADMIN_PASSWORD` 是网页真实登录账号。登录成功后，网页可以直接读取和保存服务器数据。

`PERSONAL_HUB_SYNC_TOKEN` 是备用同步密钥：当你没有登录账号会话、但仍想通过设置页手动同步时才需要它。建议同步密钥至少 24 位，不要使用生日、手机号、简单英文。

示例：

```env
PERSONAL_HUB_SYNC_TOKEN=8Yk3mA9sQx2026ChangeThisLongToken
PERSONAL_HUB_BACKUP_KEEP=14
PERSONAL_HUB_BACKUP_AUTO_ENABLED=true
PERSONAL_HUB_BACKUP_INTERVAL_HOURS=24
PERSONAL_HUB_BACKUP_ON_START=false
PERSONAL_HUB_ADMIN_USERNAME=admin
PERSONAL_HUB_ADMIN_PASSWORD=ChangeThisAdminPassword2026
PERSONAL_HUB_SESSION_MAX_AGE=604800
PERSONAL_HUB_REGISTRATION_ENABLED=false
PERSONAL_HUB_REGISTRATION_CODE=
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

如果同步密钥或登录会话可用，第二条命令会看到：

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

每个用户的数据会单独保存：

```text
/app/data/users/user-用户ID.json
```

管理员账号首次升级时，如果自己的用户数据文件还不存在，会兼容读取旧的 `/app/data/personal-hub-data.json`；保存后会写入自己的用户数据文件。普通注册用户只会读写自己的数据文件，互相隔离。

### 开启注册

如果需要开放注册，在 `.env` 中设置：

```env
PERSONAL_HUB_REGISTRATION_ENABLED=true
PERSONAL_HUB_REGISTRATION_CODE=请换成一个只告诉家人的注册码
```

然后重建容器：

```bash
docker compose up -d --build
```

注册完成后，如果不再需要新账号注册，建议改回：

```env
PERSONAL_HUB_REGISTRATION_ENABLED=false
```

### 管理用户

管理员登录后进入：

```text
设置 -> 账号与多用户 -> 打开用户管理
```

当前用户管理支持：

- 查看所有用户。
- 查看用户是否已有独立数据文件。
- 禁用或启用普通用户。
- 重置用户密码。

禁用用户后，该用户现有登录会话会被清除，需要管理员重新启用后才能登录。

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

1. 点击右上角“登录”，输入 VPS `.env` 里的管理员账号和密码。
2. 登录成功后，网页会自动从服务器读取数据。
3. 如果服务器还没有数据，可以进入“设置 -> 服务器数据同步”，点击“保存到服务器”，把当前浏览器数据保存到 VPS。
4. 确认保存成功后，可以打开“自动保存到服务器”。

同步密钥输入框只是备用方式。正常使用时，登录账号后可以不填写同步密钥。

以后换浏览器或换电脑时：

1. 打开网站。
2. 点击右上角“登录”，输入管理员账号和密码。
3. 登录成功后，网页会自动从服务器读取数据。
4. 如果当前浏览器和服务器两边都有新数据，进入“设置 -> 服务器数据同步”，点击“合并服务器数据”。

注意：“从服务器读取”会覆盖当前浏览器里的本地数据。执行前建议先点“导出 JSON”留一份本地备份。

“合并服务器数据”会先打开合并前数据对照弹窗，按模块列出本地独有、服务器独有、冲突记录和相同记录。确认后才会按记录 ID 合并本地和服务器数据；如果两边存在相同 ID，优先保留更新时间较新的记录。合并完成后会同时写入当前浏览器和服务器。

### 自动保存说明

打开“自动保存到服务器”后：

- 新增、修改、删除数据后，会延迟约 1 秒自动保存到服务器。
- 自动保存优先使用当前登录账号会话。
- 如果没有登录账号会话，也可以使用当前浏览器保存的同步密钥。
- 登录成功后会自动从服务器读取数据；手动“从服务器读取”仍会覆盖当前浏览器数据，使用前建议先导出 JSON。

## 5. 备份服务器数据

当前备份会同时处理：

- `/app/data/personal-hub-data.json`：整站业务数据快照。
- `/app/data/personal-hub.sqlite`：真实登录账号与会话数据库。

### 自动定时备份

Docker 容器启动后，会根据 `.env` 自动开启定时备份。

推荐配置：

```env
PERSONAL_HUB_BACKUP_AUTO_ENABLED=true
PERSONAL_HUB_BACKUP_INTERVAL_HOURS=24
PERSONAL_HUB_BACKUP_ON_START=false
PERSONAL_HUB_BACKUP_KEEP=14
```

含义：

- `PERSONAL_HUB_BACKUP_AUTO_ENABLED=true`：开启自动备份。
- `PERSONAL_HUB_BACKUP_INTERVAL_HOURS=24`：每 24 小时备份一次。
- `PERSONAL_HUB_BACKUP_ON_START=false`：容器启动时不立即备份，只按周期备份。
- `PERSONAL_HUB_BACKUP_KEEP=14`：保留最近 14 个备份文件。

如果你希望每次重启容器都先备份一次，可以改成：

```env
PERSONAL_HUB_BACKUP_ON_START=true
```

修改 `.env` 后重建容器：

```bash
docker compose up -d --build
```

查看自动备份是否启动：

```bash
docker compose logs -f --tail=80
```

看到类似下面的内容，说明自动备份已启动：

```text
Personal Hub automatic backups scheduled every 24 hour(s).
```

### 手动备份

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

选择要恢复的业务数据文件，例如：

```text
personal-hub-data-2026-06-26T10-20-30-000Z.json
```

恢复命令：

```bash
docker compose exec personal-hub sh -c 'cp /app/data/backups/personal-hub-data-2026-06-26T10-20-30-000Z.json /app/data/personal-hub-data.json'
```

然后打开网站，在设置页点击“从服务器读取”，把恢复后的服务器数据同步回浏览器。

如果要恢复登录数据库，选择 `.sqlite` 文件，例如：

```text
personal-hub-auth-2026-06-26T10-20-30-000Z.sqlite
```

先停止容器，再覆盖数据库，最后重启：

```bash
docker compose down
docker compose run --rm --entrypoint sh personal-hub -c 'cp /app/data/backups/personal-hub-auth-2026-06-26T10-20-30-000Z.sqlite /app/data/personal-hub.sqlite'
docker compose up -d
```

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
- 合并前冲突详情弹窗。
- 自动定时备份任务。

尚未完成：

- 业务数据拆分进 SQLite 表。
- 多用户隔离。

下一轮建议继续做：

1. SQLite 数据表设计。
2. 登录后自动从服务器读取数据。
3. 保存数据时自动写入服务器。
4. 多用户隔离。
## V0.25 用户数据迁移工具

用途：
- 把旧版服务器全局数据 `/app/data/personal-hub-data.json` 迁移到指定登录账号。
- 适合从“单用户全局数据”升级到“注册账号、多用户隔离数据”时使用。

入口：
- 登录管理员账号。
- 打开网站设置面板。
- 点击“账号与多用户 / 用户管理”。
- 在目标用户行点击“迁移旧数据”。

迁移规则：
- 来源文件：`/app/data/personal-hub-data.json`。
- 目标文件：`/app/data/users/user-用户ID.json`。
- 迁移会覆盖目标用户现有服务器数据。
- 点击按钮前会弹出确认提示，建议先导出或备份数据。
- 迁移完成后，该用户登录时会自动读取自己的服务器数据文件。

VPS 上确认数据文件：
```bash
cd /opt/personal-hub/New-project
docker compose exec personal-hub ls -lah /app/data
docker compose exec personal-hub ls -lah /app/data/users
```

建议操作顺序：
1. 先执行一次手动备份。
2. 管理员登录网站。
3. 打开用户管理。
4. 给目标账号执行“迁移旧数据”。
5. 退出管理员账号，登录目标账号确认数据是否正确。
