# Resend 邮件发送限制与域名配置

更新时间：2026-06-27

当前 Personal Hub 的邮箱注册、邮箱验证、忘记密码，都依赖 Resend 发送邮件。

## 一、当前遇到的提示

如果注册时出现：

```text
You can only send testing emails to your own email address (aouiaiu@outlook.com).
To send emails to other recipients, please verify a domain at resend.com/domains,
and change the `from` address to an email using this domain.
```

意思是：当前 Resend 账号还没有验证发件域名，只能给 Resend 账号自己的邮箱发送测试邮件。

例如你的 Resend 账号邮箱是：

```text
aouiaiu@outlook.com
```

那么测试阶段只能给这个邮箱发送验证邮件。

如果你用下面这个邮箱注册：

```text
2228133513@qq.com
```

Resend 会拒绝发送。

## 二、临时测试方案

如果只是想先测试网站注册流程，可以这样配置：

```bash
AUTH_EMAIL_FROM="Personal Hub <onboarding@resend.dev>"
PUBLIC_SITE_URL=https://www.aedclan.com
RESEND_API_KEY=你的 Resend API Key
PERSONAL_HUB_REGISTRATION_ENABLED=true
```

然后注册时使用你的 Resend 账号邮箱：

```text
aouiaiu@outlook.com
```

这样可以先测试：

1. 邮箱注册；
2. 验证邮件发送；
3. 点击验证链接；
4. 邮箱登录；
5. 忘记密码邮件。

## 三、正式使用方案

如果你希望给 QQ 邮箱、Gmail、Outlook 或其他用户邮箱发送验证邮件，必须验证自己的发件域名。

建议使用：

```text
aedclan.com
```

正式发件地址可以设置为：

```bash
AUTH_EMAIL_FROM="Personal Hub <notice@aedclan.com>"
```

## 四、Resend 验证域名步骤

1. 打开 Resend Domains：

```text
https://resend.com/domains
```

2. 添加域名：

```text
aedclan.com
```

3. Resend 会生成几条 DNS 记录。

常见类型包括：

- TXT
- MX
- DKIM
- SPF

4. 打开 Cloudflare。

5. 进入 `aedclan.com` 的 DNS 管理页面。

6. 按 Resend 提供的内容逐条添加 DNS 记录。

7. 回到 Resend 点击验证。

8. 等 Resend 显示域名状态为 Verified。

## 五、验证完成后的 VPS 配置

修改 VPS 项目 `.env`：

```bash
cd /opt/New-project
nano .env
```

改成：

```bash
RESEND_API_KEY=你的 Resend API Key
AUTH_EMAIL_FROM="Personal Hub <notice@aedclan.com>"
PUBLIC_SITE_URL=https://www.aedclan.com
AUTH_EMAIL_VERIFICATION_MAX_AGE=86400
AUTH_PASSWORD_RESET_MAX_AGE=3600
PERSONAL_HUB_REGISTRATION_ENABLED=true
```

保存后重建 Docker：

```bash
docker compose up -d --build
```

检查环境变量是否进入容器：

```bash
docker compose exec personal-hub printenv | grep -E "RESEND_API_KEY|AUTH_EMAIL_FROM|PUBLIC_SITE_URL"
```

应该看到：

```bash
RESEND_API_KEY=re_xxx
AUTH_EMAIL_FROM=Personal Hub <notice@aedclan.com>
PUBLIC_SITE_URL=https://www.aedclan.com
```

## 六、推荐流程

当前阶段：

1. 先使用 `onboarding@resend.dev`。
2. 用 `aouiaiu@outlook.com` 测试注册和验证。
3. 确认网站邮箱注册流程正常。

正式使用：

1. 在 Resend 验证 `aedclan.com`。
2. 在 Cloudflare 添加 Resend 要求的 DNS 记录。
3. 将 `AUTH_EMAIL_FROM` 改为 `notice@aedclan.com`。
4. 再测试发送到 QQ 邮箱、Gmail、Outlook。

## 七、安全提醒

不要把 `RESEND_API_KEY` 发到聊天、截图或公开仓库。

如果 API Key 已经泄露：

1. 进入 Resend API Keys。
2. 删除旧 Key。
3. 创建新 Key。
4. 更新 VPS `.env`。
5. 重建 Docker。

