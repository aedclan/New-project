# 本地到 VPS 更新流程

适用流程：本地开发 -> GitHub -> VPS Docker 部署

## 1. 本地开发

1. 在本地修改代码。
2. 运行检查：

```bash
npm run check
```

3. 本地预览确认：

```bash
npm run dev
```

## 2. 提交到 GitHub

1. 查看改动：

```bash
git status
```

2. 提交代码：

```bash
git add .
git commit -m "feat: your message"
```

3. 推送到 GitHub：

```bash
git push
```

## 3. VPS 更新

在 VPS 上进入项目目录：

```bash
cd /opt/personal-hub
git pull
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=80
```

## 4. 更新后验证

```bash
curl http://127.0.0.1:5173/healthz
```

如果返回：

```json
{"ok":true,"service":"personal-hub"}
```

说明容器服务正常。

## 5. 典型发布节奏

- `v0.22.0`：新增功能。
- `v0.22.1`：修复问题。
- `v0.23.0`：部署、数据结构或登录升级。

## 6. 回滚

如果新版有问题：

```bash
git log --oneline
git checkout <旧提交>
docker compose up -d --build
```

## 7. 建议

- GitHub 是唯一代码来源。
- VPS 只负责部署，不手工改代码。
- 所有功能更新都走“本地 -> GitHub -> VPS”。
