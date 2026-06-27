# Personal Hub 当前开发路线

更新时间：2026-06-27

之前的功能扩展路线暂时停止。当前优先做两件事：

1. 数据安全
2. 部署自动化

VPS 当前项目路径：

```bash
/opt/New-project
```

## 第一阶段：数据安全

目标：保证用户数据不会因为浏览器缓存、Docker 重建、误操作、服务器更新或账号混乱而丢失。

已落实内容：

1. 真实登录基础
   - 使用服务器账号登录。
   - 使用 HttpOnly Cookie 保存登录状态。
   - 用户密码使用哈希存储。
   - 管理员和普通用户区分权限。

2. 多用户数据隔离
   - 每个用户拥有独立数据文件。
   - 后端根据当前登录用户读取对应数据。
   - 普通用户不能访问其他用户数据。

3. 数据持久化
   - Docker 数据卷保存 `/app/data`。
   - 认证数据库保存到 `/app/data/personal-hub.sqlite`。
   - 用户数据保存到 `/app/data/users/user-用户ID.json`。

4. 备份增强
   - `npm run backup:data` 支持手动备份。
   - 自动备份覆盖认证数据库、旧版全局数据、所有用户数据。

5. 恢复工具
   - `npm run backup:list` 查看备份。
   - `npm run restore:data` 恢复数据。
   - 恢复操作必须显式增加 `--yes`，避免误覆盖。

6. 生产配置检查
   - `npm run check:production` 检查管理员账号、强密码、注册安全和备份配置。

下一步可继续加强：

1. 设置页面增加备份列表查看。
2. 设置页面增加手动备份按钮。
3. 设置页面增加备份恢复入口。
4. 增加导入 JSON 前的数据预览和二次确认。
5. 增加账号修改密码功能。

## 第二阶段：部署自动化

目标：让本地开发、GitHub 推送、VPS 拉取、Docker 重建、健康检查、失败回滚形成固定流程。

已落实内容：

1. VPS 一键部署脚本
   - 文件：`scripts/deploy-vps.sh`
   - 默认路径：`/opt/New-project`

2. VPS 回滚脚本
   - 文件：`scripts/rollback-vps.sh`
   - 默认路径：`/opt/New-project`

3. 部署文档
   - 文件：`DATA_SECURITY_AND_DEPLOYMENT.md`

标准更新流程：

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

异常回滚：

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```

当前优先验收：

1. `npm run check` 通过。
2. `npm run backup:data` 能生成备份。
3. `npm run backup:list` 能查看备份。
4. VPS `.env` 配置真实管理员账号和强密码。
5. `npm run check:production` 通过。
6. `./scripts/deploy-vps.sh` 可以完成更新。
7. `./scripts/rollback-vps.sh` 可以回滚。
8. `https://www.aedclan.com` 正常访问。
