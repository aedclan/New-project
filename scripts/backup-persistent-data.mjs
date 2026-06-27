import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultTargets = [
  {
    envKey: "PERSONAL_HUB_DATA_FILE",
    fallback: "/app/data/personal-hub-data.json",
    label: "data",
  },
  {
    envKey: "PERSONAL_HUB_AUTH_DB_FILE",
    fallback: "/app/data/personal-hub.sqlite",
    label: "auth",
  },
];

function collectUserDataTargets() {
  const dataFile = resolve(process.env.PERSONAL_HUB_DATA_FILE || "/app/data/personal-hub-data.json");
  const usersDir = resolve(process.env.PERSONAL_HUB_USER_DATA_DIR || join(dirname(dataFile), "users"));
  if (!existsSync(usersDir)) return [];

  return readdirSync(usersDir)
    .filter((file) => /^user-\d+\.json$/i.test(file))
    .map((file) => ({
      filePath: join(usersDir, file),
      label: `user-${file.match(/\d+/)?.[0] || "data"}`,
    }));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getBackupDir() {
  return resolve(process.env.PERSONAL_HUB_BACKUP_DIR || "/app/data/backups");
}

function getKeepCount() {
  return Math.max(1, Number(process.env.PERSONAL_HUB_BACKUP_KEEP || 14));
}

function buildBackupName(filePath, label, createdAt) {
  const extension = extname(filePath) || ".bak";
  const baseName = basename(filePath, extension);
  const suffix = baseName.toLowerCase().includes(label.toLowerCase()) ? "" : `-${label}`;
  return `${baseName}${suffix}-${createdAt}${extension}`;
}

function pruneBackups(backupDir, keepCount) {
  const backups = readdirSync(backupDir)
    .filter((file) => /\.(json|sqlite|db|bak)$/i.test(file))
    .map((file) => {
      const filePath = join(backupDir, file);
      return { filePath, mtimeMs: statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  backups.slice(keepCount).forEach((item) => unlinkSync(item.filePath));
  return Math.min(backups.length, keepCount);
}

export function createPersistentDataBackup(options = {}) {
  const backupDir = getBackupDir();
  const keepCount = getKeepCount();
  const createdAt = timestamp();
  const created = [];
  const skipped = [];

  mkdirSync(backupDir, { recursive: true });

  const targets = [
    ...defaultTargets.map((target) => ({
      sourcePath: resolve(process.env[target.envKey] || target.fallback),
      label: target.label,
    })),
    ...collectUserDataTargets(),
  ];

  targets.forEach((target) => {
    const sourcePath = target.sourcePath;
    if (!existsSync(sourcePath)) {
      skipped.push({ label: target.label, sourcePath, reason: "missing" });
      return;
    }

    const backupName = buildBackupName(sourcePath, target.label, createdAt);
    const backupPath = join(backupDir, backupName);
    copyFileSync(sourcePath, backupPath);
    created.push({ label: target.label, sourcePath, backupPath });
  });

  if (!created.length && !options.allowEmpty) {
    throw new Error(`No backup targets exist. Checked: ${skipped.map((item) => item.sourcePath).join(", ")}`);
  }

  return {
    backupDir,
    keepCount,
    retained: pruneBackups(backupDir, keepCount),
    created,
    skipped,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = createPersistentDataBackup();
    result.created.forEach((item) => console.log(`Backup created: ${item.backupPath}`));
    result.skipped.forEach((item) => console.log(`Backup skipped: ${item.sourcePath} (${item.reason})`));
    console.log(`Backups retained: ${result.retained}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
