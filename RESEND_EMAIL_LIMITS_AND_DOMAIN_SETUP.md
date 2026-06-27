# Resend 邮件发送限制与域名配置

更新时间：2026-06-27

当前 Personal Hub 的邮箱注册验证码、邮箱验证、忘记密码邮件，都依赖 Resend 发送邮件。

## 一、当前提示是什么意思

如果注册或发送验证码时出现：

```text
You can only send testing emails to your own email address (aouiaiu@outlook.com).
To send emails to other recipients, please verify a domain at resend.com/domains,
and change the `from` address to an email using this domain.
```

意思是：当前 Resend 账号还没有验证自己的发件域名，只能给 Resend 账号本人的邮箱发送测试邮件。

例如你的 Resend 账号邮箱是：

```text
aouiaiu@outlook.com
```

那么测试阶段只能给这个邮箱发送注册验证码、邮箱验证邮件、密码重置邮件。  
如果你使用 QQ 邮箱、Gmail 或其它邮箱测试，Resend 会拒绝发送。

## 二、临时测试配置

如果只是先测试网站注册流程，VPS 的 `.env` 可以这样配置：

```bash
RESEND_API_KEY=你的 Resend API Key
AUTH_EMAIL_FROM="Personal Hub <onboarding@resend.dev>"
PUBLIC_SITE_URL=https://www.aedclan.com
PERSONAL_HUB_REGISTRATION_ENABLED=true
```

然后注册时使用你的 Resend 账号邮箱：

```text
aouiaiu@outlook.com
```

这样可以先测试：

1. 邮箱注册验证码发送。
2. 注册验证码校验。
3. 注册后自动登录。
4. 忘记密码邮件发送。

## 三、正式使用配置

如果你希望给 QQ 邮箱、Gmail、Outlook 或其它用户邮箱发送验证码，必须在 Resend 验证自己的发件域名。

建议验证：

```text
aedclan.com
```

正式发件地址建议设置为：

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

3. Resend 会生成几条 DNS 记录，常见类型包括：

- TXT
- MX
- DKIM
- SPF

4. 打开 Cloudflare。
5. 进入 `aedclan.com` 的 DNS 管理页面。
6. 按 Resend 提供的内容逐条添加 DNS 记录。
7. 回到 Resend 点击验证。
8. 等 Resend 显示域名状态为 `Verified`。

## 五、验证完成后的 VPS 配置

进入 VPS 项目目录：

```bash
cd /opt/New-project
nano .env
```

建议配置：

```bash
RESEND_API_KEY=你的 Resend API Key
AUTH_EMAIL_FROM="Personal Hub <notice@aedclan.com>"
PUBLIC_SITE_URL=https://www.aedclan.com
PERSONAL_HUB_REGISTRATION_ENABLED=true
AUTH_EMAIL_VERIFICATION_MAX_AGE=86400
AUTH_PASSWORD_RESET_MAX_AGE=3600
AUTH_REGISTER_CODE_MAX_AGE=600
AUTH_REGISTER_CODE_COOLDOWN=60
AUTH_REGISTER_CODE_MAX_ATTEMPTS=5
```

保存后重建 Docker：

```bash
docker compose up -d --build
```

检查环境变量是否进入容器：

```bash
docker compose exec personal-hub printenv | grep -E "RESEND_API_KEY|AUTH_EMAIL_FROM|PUBLIC_SITE_URL|AUTH_REGISTER_CODE"
```

应该能看到：

```bash
RESEND_API_KEY=re_xxx
AUTH_EMAIL_FROM=Personal Hub <notice@aedclan.com>
PUBLIC_SITE_URL=https://www.aedclan.com
AUTH_REGISTER_CODE_MAX_AGE=600
AUTH_REGISTER_CODE_COOLDOWN=60
AUTH_REGISTER_CODE_MAX_ATTEMPTS=5
```

## 六、推荐上线流程

测试阶段：

1. 先使用 `onboarding@resend.dev`。
2. 使用 `aouiaiu@outlook.com` 测试注册验证码。
3. 确认网站邮箱注册流程正常。

正式阶段：

1. 在 Resend 验证 `aedclan.com`。
2. 在 Cloudflare 添加 Resend 要求的 DNS 记录。
3. 将 `AUTH_EMAIL_FROM` 改为 `Personal Hub <notice@aedclan.com>`。
4. 再测试发送到 QQ 邮箱、Gmail、Outlook。

## 七、安全提醒

不要把 `RESEND_API_KEY` 发到聊天、截图或公开仓库。

如果 API Key 已经泄露：

1. 进入 Resend API Keys。
2. 删除旧 Key。
3. 创建新 Key。
4. 更新 VPS `.env`。
5. 重建 Docker。
