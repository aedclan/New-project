import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const dataFilePath = resolve(process.env.PERSONAL_HUB_DATA_FILE || "/app/data/personal-hub-data.json");
const backupDir = resolve(process.env.PERSONAL_HUB_BACKUP_DIR || "/app/data/backups");
const keepCount = Math.max(1, Number(process.env.PERSONAL_HUB_BACKUP_KEEP || 14));

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

if (!existsSync(dataFilePath)) {
  console.error(`Data file does not exist: ${dataFilePath}`);
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const backupName = `${basename(dataFilePath, ".json")}-${timestamp()}.json`;
const backupPath = join(backupDir, backupName);
copyFileSync(dataFilePath, backupPath);

const backups = readdirSync(backupDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => {
    const filePath = join(backupDir, file);
    return { filePath, mtimeMs: statSync(filePath).mtimeMs };
  })
  .sort((left, right) => right.mtimeMs - left.mtimeMs);

backups.slice(keepCount).forEach((item) => unlinkSync(item.filePath));

console.log(`Backup created: ${backupPath}`);
console.log(`Backups retained: ${Math.min(backups.length, keepCount)}`);
