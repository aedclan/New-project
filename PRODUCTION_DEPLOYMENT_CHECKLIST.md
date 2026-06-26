# 生产部署清单

适用环境：RackNerd VPS / Ubuntu 24.04 / Docker / Nginx / HTTPS

## 1. DNS

- [ ] `www.aedclan.com` 指向 VPS IP
- [ ] `aedclan.com` 指向同一 VPS IP

## 2. 服务器准备

- [ ] 安装 Docker
- [ ] 安装 Docker Compose
- [ ] 安装 Nginx
- [ ] 安装 Certbot

## 3. 项目部署

- [ ] 将项目放到 `/opt/personal-hub`
- [ ] 复制 `.env.example` 为 `.env`
- [ ] 如需邮件通知，填写 `RESEND_API_KEY`
- [ ] 如需邮件通知，填写 `SUBSCRIPTION_EMAIL_FROM`
- [ ] 执行 `docker compose up -d --build`

## 4. 服务验证

- [ ] 访问 `http://127.0.0.1:5173/healthz`
- [ ] 确认返回 `{"ok":true,"service":"personal-hub"}`
- [ ] 访问 `http://127.0.0.1:5173/`

## 5. Nginx 反代

- [ ] 配置 `server_name www.aedclan.com aedclan.com`
- [ ] `proxy_pass http://127.0.0.1:5173`
- [ ] 执行 `nginx -t`
- [ ] 重载 Nginx

## 6. HTTPS

- [ ] 执行 `certbot --nginx -d www.aedclan.com -d aedclan.com`
- [ ] 检查 HTTPS 自动跳转

## 7. 防火墙

- [ ] 放行 SSH
- [ ] 放行 Nginx Full

## 8. 更新流程

- [ ] `git pull`
- [ ] `docker compose up -d --build`
- [ ] `docker compose ps`
- [ ] `docker compose logs -f --tail=80`

## 9. 常用排查

- [ ] `curl http://127.0.0.1:5173/healthz`
- [ ] `docker compose restart personal-hub`
- [ ] `docker compose logs --tail=120 personal-hub`

## 10. 备忘

- 当前项目仍以浏览器本地存储为主。
- 正式长期使用前，建议继续规划数据备份或数据库。
- 站点域名统一使用 `www.aedclan.com` 和 `aedclan.com`。
