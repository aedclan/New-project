# 生产部署检查清单

VPS 项目路径：

```bash
/opt/New-project
```

上线前检查：

- [ ] `.env` 已配置真实管理员账号。
- [ ] 管理员密码不是默认密码，并且至少 12 位。
- [ ] `PERSONAL_HUB_SECURE_COOKIE=true`。
- [ ] 注册默认关闭，或已配置注册码。
- [ ] Docker 数据卷没有删除。
- [ ] `npm run check` 通过。
- [ ] `npm run check:production` 通过。
- [ ] `npm run backup:data` 可以生成备份。
- [ ] `docker compose ps` 显示容器 healthy。
- [ ] `curl http://127.0.0.1:5173/healthz` 返回正常。
- [ ] `https://www.aedclan.com` 可以访问。
- [ ] 登录、退出、新增、修改、删除数据正常。

常用命令：

```bash
cd /opt/New-project
docker compose ps
docker compose logs --tail=120 personal-hub
curl http://127.0.0.1:5173/healthz
```
