# 新手部署指南

仓库地址：`https://github.com/aedclan/New-project`

适用场景：

- 你在本地改代码
- 代码先推到 GitHub
- VPS 从 GitHub 拉取
- VPS 用 Docker 跑站点
- 域名：`www.aedclan.com`

---

## 1. 你现在要理解的流程

整个流程只有四步：

1. 本地开发
2. 推到 GitHub
3. VPS 拉取代码
4. Docker 重建并重启

以后每次加功能，都按这条线走。

---

## 2. 本地怎么改代码

### 2.1 打开项目

在本地打开项目文件夹。

### 2.2 先检查项目能不能跑

在项目根目录执行：

```powershell
npm run check
```

如果通过，说明代码基本没问题。

### 2.3 本地预览

执行：

```powershell
npm run dev
```

然后打开：

```text
http://127.0.0.1:5173
```

你可以先确认页面正常，再继续改。

---

## 3. 改完后怎么上传到 GitHub

### 3.1 看看改了什么

```powershell
git status
```

### 3.2 把改动加入暂存区

```powershell
git add .
```

### 3.3 提交版本

```powershell
git commit -m "feat: add new feature"
```

你也可以换成更具体的说明，比如：

```powershell
git commit -m "fix: improve deployment docs"
```

### 3.4 推送到 GitHub

```powershell
git push
```

这一步完成后，GitHub 上就有新代码了。

---

## 4. VPS 上第一次部署

### 4.1 登录 VPS

用 SSH 登录你的 RackNerd Ubuntu 24.04 服务器。

### 4.2 安装 Docker

如果你还没装 Docker，就先装。

### 4.3 准备项目目录

建议放到：

```text
/opt/personal-hub
```

执行：

```bash
sudo mkdir -p /opt/personal-hub
sudo chown -R $USER:$USER /opt/personal-hub
cd /opt/personal-hub
```

### 4.4 克隆 GitHub 仓库

```bash
git clone https://github.com/aedclan/New-project .
```

### 4.5 准备环境变量

```bash
cp .env.example .env
```

如果你要启用订阅邮件通知，编辑 `.env`：

```bash
nano .env
```

填入：

```text
RESEND_API_KEY=你的 Resend API Key
SUBSCRIPTION_EMAIL_FROM=订阅提醒 <notice@你的域名>
```

如果你暂时不填，也能启动，只是邮件通知不会工作。

### 4.6 启动容器

```bash
docker compose up -d --build
```

### 4.7 看容器是否正常

```bash
docker compose ps
```

### 4.8 检查健康状态

```bash
curl http://127.0.0.1:5173/healthz
```

正常会返回：

```json
{"ok":true,"service":"personal-hub"}
```

---

## 5. 域名和 Nginx

你的域名是：

```text
www.aedclan.com
aedclan.com
```

### 5.1 DNS 要做什么

把这两个域名都指向你的 VPS IP。

### 5.2 Nginx 配置

新建站点文件，例如：

```bash
sudo nano /etc/nginx/sites-available/personal-hub
```

填入：

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

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/personal-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5.3 HTTPS

安装证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.aedclan.com -d aedclan.com
```

---

## 6. 以后怎么更新功能

以后你每次加功能，都按这个顺序：

### 6.1 本地改完

先在本地改代码，确认能跑。

### 6.2 推到 GitHub

```powershell
git add .
git commit -m "feat: your message"
git push
```

### 6.3 VPS 拉取最新代码

```bash
cd /opt/personal-hub
git pull
```

### 6.4 重新构建容器

```bash
docker compose up -d --build
```

### 6.5 看日志

```bash
docker compose logs -f --tail=80
```

### 6.6 再检查一下

```bash
curl http://127.0.0.1:5173/healthz
```

---

## 7. 如果更新后出问题怎么办

### 7.1 看日志

```bash
docker compose logs --tail=120 personal-hub
```

### 7.2 重启容器

```bash
docker compose restart personal-hub
```

### 7.3 回滚到旧版本

先看提交记录：

```bash
git log --oneline
```

切到旧版本：

```bash
git checkout <旧提交ID>
docker compose up -d --build
```

如果你只是想回到最新主分支：

```bash
git checkout main
git pull
docker compose up -d --build
```

---

## 8. 最常用的命令

```bash
cd /opt/personal-hub
git pull
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=80
curl http://127.0.0.1:5173/healthz
```

---

## 9. 你现在最适合的工作方式

最稳的方式就是：

1. 本地改代码
2. 本地检查
3. 推到 GitHub
4. VPS 拉取
5. Docker 重建

不要在 VPS 上直接手改代码。
这样以后你才不会忘了改了什么，也更容易回滚。

