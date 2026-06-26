# GitHub 到 VPS 完整更新指南

仓库地址：

```text
https://github.com/aedclan/New-project
```

适用流程：

```text
本地电脑修改代码 -> 推送到 GitHub -> VPS 拉取 GitHub 最新代码 -> Docker 重新构建并启动
```

你的 VPS 项目路径：

```text
/opt/personal-hub/New-project
```

你的域名：

```text
https://www.aedclan.com
```

---

## 1. 先理解整体流程

以后每次新增功能、修复问题、调整 UI，都按这个顺序：

1. 在本地项目里修改代码。
2. 本地运行检查，确认项目没明显错误。
3. 把本地代码提交到 Git。
4. 推送到 GitHub 仓库。
5. 登录 VPS。
6. 在 VPS 项目目录执行 `git pull`。
7. 用 Docker 重新构建并启动。
8. 检查网站是否正常。

不要直接在 VPS 上手动改代码。  
VPS 只负责运行项目，本地才是开发位置，GitHub 是中间代码仓库。

---

## 2. 本地电脑：进入项目目录

你的本地项目路径是：

```text
C:\Users\aouiaiu\Documents\New project 2
```

在 PowerShell 里进入项目：

```powershell
cd "C:\Users\aouiaiu\Documents\New project 2"
```

确认当前目录正确：

```powershell
pwd
```

应该看到类似：

```text
C:\Users\aouiaiu\Documents\New project 2
```

---

## 3. 本地电脑：检查 Git 状态

查看当前有哪些文件被修改：

```powershell
git status
```

常见情况：

```text
modified:   scripts/dev-server.mjs
new file:   GITHUB_TO_VPS_FULL_GUIDE.md
```

含义：

- `modified`：已有文件被修改。
- `new file`：新增文件。
- `deleted`：删除文件。
- `untracked files`：Git 还没开始管理的新文件。

---

## 4. 本地电脑：运行项目检查

如果本地装了 Node.js：

```powershell
npm run check
```

如果你使用 Codex 内置 Node，可以执行：

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/check.mjs
```

正常结果：

```text
Project check passed.
```

如果检查不通过，先不要推送到 GitHub，先修复错误。

---

## 5. 本地电脑：本地预览网站

启动本地服务：

```powershell
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

确认页面能正常打开，功能没有明显问题。

如果你没有全局 Node.js，也可以用：

```powershell
.\scripts\start-dev.ps1
```

---

## 6. 本地电脑：把修改加入 Git

把所有改动加入暂存区：

```powershell
git add .
```

再次查看状态：

```powershell
git status
```

如果看到：

```text
Changes to be committed
```

说明文件已经准备提交。

---

## 7. 本地电脑：提交代码

提交代码：

```powershell
git commit -m "fix: handle double slash request path"
```

提交信息建议这样写：

```text
feat: 新增功能
fix: 修复问题
docs: 修改文档
style: 修改样式
chore: 工程配置调整
```

例子：

```powershell
git commit -m "docs: add github to vps deployment guide"
```

```powershell
git commit -m "fix: prevent server crash on double slash path"
```

```powershell
git commit -m "feat: improve bill import workflow"
```

---

## 8. 本地电脑：推送到 GitHub

推送到 GitHub：

```powershell
git push
```

如果第一次推送某个分支，可能需要：

```powershell
git push -u origin main
```

推送成功后，打开 GitHub 仓库确认：

```text
https://github.com/aedclan/New-project
```

你应该能在 GitHub 上看到最新提交。

---

## 9. VPS：登录服务器

从本地 PowerShell 登录 VPS：

```powershell
ssh root@你的VPS_IP
```

如果你不是 root 用户，就用你的实际用户名：

```powershell
ssh 用户名@你的VPS_IP
```

登录成功后，你会看到类似：

```text
root@racknerd-e169714:~#
```

---

## 10. VPS：进入项目目录

你的 VPS 项目目录是：

```bash
cd /opt/personal-hub/New-project
```

确认目录：

```bash
pwd
```

应该显示：

```text
/opt/personal-hub/New-project
```

查看文件：

```bash
ls -la
```

应该能看到：

```text
Dockerfile
docker-compose.yml
package.json
index.html
src
scripts
```

如果没有看到 `docker-compose.yml`，说明你进错目录了。

---

## 11. VPS：拉取 GitHub 最新代码

在 VPS 项目目录执行：

```bash
git pull
```

正常会看到类似：

```text
Updating xxx..xxx
Fast-forward
```

或者：

```text
Already up to date.
```

如果提示输入 GitHub 用户名和密码，说明仓库权限或认证方式需要配置。公开仓库一般不需要登录即可拉取。

---

## 12. VPS：重新构建 Docker 容器

拉取代码后，重新构建并启动：

```bash
docker compose up -d --build
```

含义：

- `docker compose`：使用当前目录的 `docker-compose.yml`
- `up`：启动服务
- `-d`：后台运行
- `--build`：重新构建镜像，确保新代码进入容器

---

## 13. VPS：查看容器状态

执行：

```bash
docker compose ps
```

正常应该看到 `personal-hub` 正在运行。

如果看到 `restarting`，说明容器启动后崩溃了，需要看日志。

---

## 14. VPS：查看日志

查看最近日志：

```bash
docker compose logs --tail=80 personal-hub
```

持续查看日志：

```bash
docker compose logs -f --tail=80
```

正常日志类似：

```text
Personal Content Hub is running at http://0.0.0.0:5173
```

如果看到 `TypeError`、`Cannot find module`、`Invalid URL` 等错误，把日志复制出来继续排查。

---

## 15. VPS：健康检查

执行：

```bash
curl http://127.0.0.1:5173/healthz
```

正常返回：

```json
{"ok":true,"service":"personal-hub"}
```

如果这里不正常，说明 Docker 容器内服务还没正常工作。

---

## 16. VPS：检查首页

执行：

```bash
curl -I http://127.0.0.1:5173/
```

正常应该看到：

```text
HTTP/1.1 200 OK
```

检查 JS 文件：

```bash
curl -I http://127.0.0.1:5173/src/main.js
```

正常应该看到：

```text
HTTP/1.1 200 OK
Content-Type: text/javascript; charset=utf-8
```

如果 `src/main.js` 是 404，页面就会停在“页面尚未完成初始化”。

---

## 17. VPS：检查域名访问

检查域名首页：

```bash
curl -I https://www.aedclan.com/
```

检查域名下的 JS：

```bash
curl -I https://www.aedclan.com/src/main.js
```

正常应该都是：

```text
HTTP/2 200
```

如果本地 `127.0.0.1:5173` 正常，但域名不正常，问题通常在 Nginx 或 Cloudflare。

---

## 18. Nginx 常用检查

检查 Nginx 配置：

```bash
sudo nginx -t
```

重载 Nginx：

```bash
sudo systemctl reload nginx
```

查看 Nginx 状态：

```bash
sudo systemctl status nginx
```

查看当前域名配置：

```bash
sudo nginx -T | grep -A20 -B5 "server_name www.aedclan.com"
```

---

## 19. 你的 Nginx 应该反代到 Docker

配置应类似：

```nginx
server {
  listen 80;
  server_name www.aedclan.com aedclan.com;

  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

重点：

```nginx
proxy_pass http://127.0.0.1:5173;
```

不要让 Nginx 直接读取某个旧的 `index.html`，否则 Docker 更新了，网站仍然可能显示旧页面。

---

## 20. 常见问题

### 20.1 docker compose ps 提示 no configuration file

原因：你不在项目目录。

解决：

```bash
cd /opt/personal-hub/New-project
docker compose ps
```

### 20.2 页面显示“页面尚未完成初始化”

原因：`src/main.js` 没加载或没执行。

检查：

```bash
curl -I http://127.0.0.1:5173/src/main.js
curl -I https://www.aedclan.com/src/main.js
```

### 20.3 容器一直 restarting

看日志：

```bash
docker compose logs --tail=120 personal-hub
```

### 20.4 git pull 后网站没变化

通常是没有重新构建 Docker：

```bash
docker compose up -d --build
```

### 20.5 GitHub 有新代码，但 VPS git pull 没更新

检查当前分支：

```bash
git branch
```

检查远程地址：

```bash
git remote -v
```

远程地址应该是：

```text
https://github.com/aedclan/New-project
```

---

## 21. 回滚到旧版本

如果新版本上线后出问题：

```bash
cd /opt/personal-hub/New-project
git log --oneline
```

找到旧提交 ID，例如：

```text
abc1234 fix: previous stable version
```

回滚：

```bash
git checkout abc1234
docker compose up -d --build
```

回到最新主分支：

```bash
git checkout main
git pull
docker compose up -d --build
```

---

## 22. 每次更新最短命令

本地：

```powershell
cd "C:\Users\aouiaiu\Documents\New project 2"
npm run check
git add .
git commit -m "fix: update project"
git push
```

VPS：

```bash
cd /opt/personal-hub/New-project
git pull
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

---

## 23. 最重要的原则

- 本地负责开发。
- GitHub 负责保存代码版本。
- VPS 负责运行 Docker。
- 不要在 VPS 上直接手改代码。
- 每次更新后都要执行 `docker compose up -d --build`。
- 每次更新后都要检查 `/healthz`。

