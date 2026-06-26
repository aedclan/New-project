import { createPersistentDataBackup } from "./backup-persistent-data.mjs";

const hourMs = 60 * 60 * 1000;

function isAutoBackupEnabled() {
  return process.env.PERSONAL_HUB_BACKUP_AUTO_ENABLED !== "false";
}

function getIntervalMs() {
  const hours = Number(process.env.PERSONAL_HUB_BACKUP_INTERVAL_HOURS || 24);
  return Math.max(1, hours) * hourMs;
}

function shouldRunOnStart() {
  return process.env.PERSONAL_HUB_BACKUP_ON_START === "true";
}

export function startScheduledBackups() {
  if (!isAutoBackupEnabled()) {
    console.log("Personal Hub automatic backups are disabled.");
    return null;
  }

  const intervalMs = getIntervalMs();

  async function runBackup(reason) {
    try {
      const result = createPersistentDataBackup({ allowEmpty: true });
      const createdText = result.created.length ? result.created.map((item) => item.label).join(", ") : "no files";
      console.log(`Personal Hub backup completed (${reason}): ${createdText}.`);
    } catch (error) {
      console.error(`Personal Hub backup failed (${reason}): ${error.message}`);
    }
  }

  if (shouldRunOnStart()) {
    runBackup("startup");
  }

  const timer = setInterval(() => runBackup("schedule"), intervalMs);
  timer.unref?.();
  console.log(`Personal Hub automatic backups scheduled every ${Math.round(intervalMs / hourMs)} hour(s).`);
  return timer;
}
