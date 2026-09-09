import {
  getAccessToken,
  readDatabase,
  withDatabaseLock,
  writeDatabase,
} from "./_firebase-admin.mjs";
import {
  backupDateKey,
  buildBusinessBackup,
  expiredBackupKeys,
} from "../../shared/business-backup.mjs";

const keepBackupDays = 14;

const readBackupSections = async (accessToken) => {
  const [appointments, clients, waitlistEntries, barbers, team, shopfrontSettings] =
    await Promise.all([
      readDatabase("appointments", accessToken),
      readDatabase("clients", accessToken),
      readDatabase("waitlistEntries", accessToken),
      readDatabase("barbers", accessToken),
      readDatabase("team", accessToken),
      readDatabase("shopfront/settings", accessToken),
    ]);
  return { appointments, clients, waitlistEntries, barbers, team, shopfrontSettings };
};

export const listBusinessBackups = async (accessToken) => {
  const index = (await readDatabase("businessBackupIndex", accessToken)) ?? {};
  return Object.entries(index)
    .map(([id, metadata]) => ({ id, ...metadata }))
    .sort((first, second) => Number(second.createdAt) - Number(first.createdAt));
};

export const createStoredBusinessBackup = async ({ source = "scheduled", now = new Date() } = {}) => {
  const accessToken = await getAccessToken();
  const id = backupDateKey(now);
  const existing = await readDatabase(`businessBackupIndex/${id}`, accessToken);
  if (existing) return { id, metadata: existing, created: false };

  return withDatabaseLock("appointments", accessToken, async () => {
    const repeated = await readDatabase(`businessBackupIndex/${id}`, accessToken);
    if (repeated) return { id, metadata: repeated, created: false };

    const snapshot = buildBusinessBackup(await readBackupSections(accessToken), {
      createdAt: now.getTime(),
      source,
    });
    const path = `businessBackups/${id}`;
    const previousSnapshot = await readDatabase(path, accessToken);
    const created = !previousSnapshot;
    const stored = previousSnapshot || snapshot;
    if (created) await writeDatabase(path, snapshot, accessToken);
    await writeDatabase(`businessBackupIndex/${id}`, stored.metadata, accessToken);

    const currentIndex = (await readDatabase("businessBackupIndex", accessToken)) ?? {};
    for (const expiredId of expiredBackupKeys(currentIndex, keepBackupDays)) {
      await Promise.all([
        writeDatabase(`businessBackups/${expiredId}`, null, accessToken),
        writeDatabase(`businessBackupIndex/${expiredId}`, null, accessToken),
      ]);
    }

    return { id, metadata: stored.metadata, created };
  });
};
