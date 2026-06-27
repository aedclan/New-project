import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (item.startsWith("--")) {
    const key = item.slice(2);
    const next = process.argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      index += 1;
    }
  }
}

function getBackupDir() {
  return resolve(process.env.PERSONAL_HUB_BACKUP_DIR || "/app/data/backups");
}

function getDataFile() {
  return resolve(process.env.PERSONAL_HUB_DATA_FILE || "/app/data/personal-hub-data.json");
}

function getAuthDbFile() {
  return resolve(process.env.PERSONAL_HUB_AUTH_DB_FILE || "/app/data/personal-hub.sqlite");
}

function getUserDataFile(userId) {
  return resolve(join(dirname(getDataFile()), "users", `user-${userId}.json`));
}

function listBackups() {
  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) {
    console.log(`备份目录不存在：${backupDir}`);
    return;
  }

  const files = readdirSync(backupDir)
    .filter((file) => /\.(json|sqlite|db|bak)$/i.test(file))
    .map((file) => {
      const filePath = join(backupDir, file);
      const stats = statSync(filePath);
      return { file, filePath, size: stats.size, mtimeMs: stats.mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (!files.length) {
    console.log(`没有找到备份文件：${backupDir}`);
    return;
  }

  files.forEach((item) => {
    console.log(`${item.file}\t${item.size} bytes\t${item.filePath}`);
  });
}

function resolveTarget(target) {
  if (target === "data") return getDataFile();
  if (target === "auth") return getAuthDbFile();
  if (/^user:\d+$/.test(target)) return getUserDataFile(target.split(":")[1]);
  throw new Error("恢复目标不正确。可用目标：data、auth、user:用户ID");
}

function restoreBackup() {
  const file = String(args.get("file") || "").trim();
  const target = String(args.get("target") || "").trim();
  const confirmed = args.get("yes") === true;

  if (!file || !target) {
    throw new Error("缺少参数。示例：node scripts/restore-persistent-data.mjs --file 备份文件 --target user:1 --yes");
  }
  if (!confirmed) {
    throw new Error("恢复会覆盖目标数据。确认恢复请增加 --yes 参数。");
  }

  const backupPath = resolve(file.includes("/") || file.includes("\\") ? file : join(getBackupDir(), file));
  if (!existsSync(backupPath)) {
    throw new Error(`备份文件不存在：${backupPath}`);
  }

  const targetPath = resolveTarget(target);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(backupPath, targetPath);
  console.log(`恢复完成：${backupPath} -> ${targetPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (args.get("list")) {
      listBackups();
    } else {
      restoreBackup();
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
