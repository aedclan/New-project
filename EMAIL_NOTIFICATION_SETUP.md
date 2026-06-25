# 邮件通知配置说明

本项目的订阅到期邮件通知使用 Resend 发送邮件。站内提醒和浏览器通知不需要此配置；只有点击“发送测试邮件”或“扫描并发送邮件”时才需要配置邮件服务。

## 1. 获取 Resend API Key

1. 打开 Resend API Keys 页面：
   - https://resend.com/api-keys
2. 登录 Resend 账号。
3. 点击 `Create API Key`。
4. 名称建议填写：

```text
Personal Hub Subscription Notice
```

5. 权限选择：

```text
Sending access
```

6. 如果页面要求选择 Domain，选择已经验证过的发信域名。
7. 创建后复制 API Key，格式通常类似：

```text
re_xxxxxxxxxxxxxxxxx
```

注意：Resend API Key 创建后通常只完整显示一次，请及时保存到安全位置。

## 2. 配置环境变量

在 PowerShell 中运行：

```powershell
$env:RESEND_API_KEY="你的 Resend API Key"
$env:SUBSCRIPTION_EMAIL_FROM="Personal Hub <notice@你的域名.com>"
```

示例：

```powershell
$env:RESEND_API_KEY="re_xxxxxxxxxxxxxxxxx"
$env:SUBSCRIPTION_EMAIL_FROM="Personal Hub <notice@example.com>"
```

`SUBSCRIPTION_EMAIL_FROM` 必须使用 Resend 允许发送的邮箱，通常是已经验证过的域名邮箱。

## 3. 启动网站服务

设置环境变量后，需要重新启动本地服务：

```powershell
.\scripts\start-dev.ps1
```

然后打开：

```text
http://127.0.0.1:5173/
```

注意：如果网站服务已经在运行，必须重启服务；否则服务读不到新设置的环境变量。

## 4. 在网页中使用

1. 打开 `设置` 页面。
2. 找到 `订阅通知`。
3. 填写接收邮箱。
4. 勾选 `邮件通知`。
5. 点击 `保存通知设置`。
6. 点击 `发送测试邮件`，确认邮箱可以收到邮件。
7. 点击 `扫描并发送邮件`，对当前到期订阅发送提醒邮件。

## 5. 常见问题

### 提示“邮件服务未配置”

说明当前服务没有读到环境变量。

检查：
- 是否设置了 `RESEND_API_KEY`。
- 是否设置了 `SUBSCRIPTION_EMAIL_FROM`。
- 设置后是否重启了 `.\scripts\start-dev.ps1`。

### 邮件发送失败

可能原因：
- API Key 填错。
- API Key 权限不足。
- 发信邮箱不是 Resend 允许的邮箱。
- 域名没有完成 Resend 验证。
- 网络无法访问 Resend API。

### 没收到测试邮件

检查：
- 垃圾邮件箱。
- 接收邮箱是否填写正确。
- Resend 控制台是否有发送记录。
- 发信域名是否已验证。

## 6. 命令行定时发送

后续如果要用 Windows 计划任务定时发送订阅提醒，可以使用：

```powershell
$env:RESEND_API_KEY="你的 Resend API Key"
$env:SUBSCRIPTION_EMAIL_FROM="Personal Hub <notice@你的域名.com>"
$env:SUBSCRIPTION_NOTIFY_EMAIL="你的接收邮箱"
$env:SUBSCRIPTION_NOTIFY_LEAD_DAYS="0,1,3,7"
$env:SUBSCRIPTION_DATA_FILE="C:\path\to\personal-hub-full-data.json"
npm run send-subscription-emails
```

`SUBSCRIPTION_DATA_FILE` 需要指向从网站导出的 JSON 数据文件。
