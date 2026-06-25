# 个人工作台

一个面向个人和家庭场景的本地工作台，用于管理事项、生活收支、订阅、人情往来、笔记、项目集和外部收藏。

## 当前能力

- 总览：查看今日事项、近期笔记、订阅提醒和整体统计。
- 事项：按状态管理待办、进行中、已完成事项。
- 生活收支：支持月度历史、累计汇总、家庭现金流、固定支出、房贷压力、支付宝/微信/Excel/CSV 导入。
- 订阅：记录订阅项目、到期提醒、续费、复盘和邮件通知。
- 人情往来：管理人物台账、送礼收礼、差额、年度详情、事件统计和导入校验。
- 笔记：支持 Markdown、灵感、链接、回顾和笔记转事项。
- 收藏夹：保存外部资料链接。
- 设置：统一管理数据导入导出、清空数据和通知配置。

## 本地启动

如果系统已经安装 Node.js：

```powershell
npm run dev
```

如果当前机器没有全局 Node.js，可以使用 Codex 桌面内置 Node：

```powershell
.\scripts\start-dev.ps1
```

启动后打开：

```text
http://127.0.0.1:5173
```

## 项目检查

```powershell
npm run check
```

或使用 Codex 内置 Node：

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/check.mjs
```

## 本地演示登录

未登录只能浏览。需要新增、编辑、删除、导入、导出或清空数据时，使用本地演示账号：

```text
账号：admin
密码：hub2026
```

## Docker 部署

复制环境变量文件：

```bash
cp .env.example .env
```

构建并启动：

```bash
docker compose up -d --build
```

更多 VPS、Nginx 和更新流程见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 邮件通知

订阅邮件通知需要配置：

```text
RESEND_API_KEY
SUBSCRIPTION_EMAIL_FROM
```

详细说明见 [EMAIL_NOTIFICATION_SETUP.md](EMAIL_NOTIFICATION_SETUP.md)。
