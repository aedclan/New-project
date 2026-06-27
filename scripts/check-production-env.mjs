const required = [
  "PERSONAL_HUB_ADMIN_USERNAME",
  "PERSONAL_HUB_ADMIN_PASSWORD",
];

const recommended = [
  "PERSONAL_HUB_BACKUP_DIR",
  "PERSONAL_HUB_BACKUP_KEEP",
  "PERSONAL_HUB_BACKUP_AUTO_ENABLED",
  "PERSONAL_HUB_SESSION_MAX_AGE",
];

function isWeakPassword(value) {
  const password = String(value || "");
  return password.length < 12 || ["admin", "password", "hub2026", "12345678"].includes(password.toLowerCase());
}

const missing = required.filter((key) => !String(process.env[key] || "").trim());
const warnings = recommended.filter((key) => !String(process.env[key] || "").trim());

if (missing.length) {
  console.error(`生产环境缺少必要配置：${missing.join(", ")}`);
  console.error("请在 VPS 的 .env 文件中配置真实管理员账号和强密码。");
  process.exit(1);
}

if (isWeakPassword(process.env.PERSONAL_HUB_ADMIN_PASSWORD)) {
  console.error("PERSONAL_HUB_ADMIN_PASSWORD 过弱，生产环境建议至少 12 位，并混合大小写、数字或符号。");
  process.exit(1);
}

if (process.env.PERSONAL_HUB_REGISTRATION_ENABLED === "true" && !String(process.env.PERSONAL_HUB_REGISTRATION_CODE || "").trim()) {
  console.error("当前开启了注册，但没有配置 PERSONAL_HUB_REGISTRATION_CODE。生产环境不建议开放无邀请码注册。");
  process.exit(1);
}

warnings.forEach((key) => {
  console.warn(`建议配置：${key}`);
});

console.log("生产环境配置检查通过。");
