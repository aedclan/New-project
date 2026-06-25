# 部署与更新说明

## 推荐架构

正式使用建议部署到 VPS，并使用 Docker Compose 管理服务。

```text
用户浏览器 -> Nginx HTTPS -> Docker 容器 personal-hub:5173
```

## 首次部署

1. 安装 Docker 和 Docker Compose。
2. 将项目上传到 VPS，例如 `/opt/personal-hub`。
3. 推荐复制环境变量文件。即使不创建 `.env`，网站也能启动；只是订阅邮件通知不可用。

```bash
cp .env.example .env
```

4. 如需订阅邮件通知，填写 `.env`：

```bash
RESEND_API_KEY=你的 Resend API Key
SUBSCRIPTION_EMAIL_FROM=订阅提醒 <notice@example.com>
```

5. 构建并启动：

```bash
docker compose up -d --build
```

6. 本机验证：

```bash
curl http://127.0.0.1:5173/healthz
curl http://127.0.0.1:5173
```

## Nginx 反向代理示例

```nginx
server {
  listen 80;
  server_name your-domain.com;

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

生产环境建议再用 Certbot 配置 HTTPS。

## 后续更新功能

推荐流程：

```bash
git pull
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=80
```

如果更新后异常，可以回到上一版代码再重新构建：

```bash
git checkout <上一版提交>
docker compose up -d --build
```

## 常用排查命令

```bash
docker compose ps
docker compose logs --tail=120 personal-hub
docker compose restart personal-hub
curl http://127.0.0.1:5173/healthz
```

如果 `healthz` 返回 `{"ok":true,"service":"personal-hub"}`，说明容器内服务正常。

## 版本号建议

- `0.22.0`：新增功能或模块。
- `0.22.1`：修复 UI、导入、交互问题。
- `0.23.0`：数据结构、登录、部署架构升级。

当前项目仍以浏览器本地存储为主。正式长期使用前，建议优先规划数据库或服务端数据备份，避免更换浏览器或清理缓存后丢失数据。
