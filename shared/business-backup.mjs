import crypto from "node:crypto";

export const backupDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export const buildBusinessBackup = (sections, { createdAt = Date.now(), source = "scheduled" } = {}) => {
  const data = {
    appointments: sections.appointments ?? {},
    clients: sections.clients ?? {},
    waitlistEntries: sections.waitlistEntries ?? {},
    barbers: sections.barbers ?? {},
    team: sections.team ?? {},
    shopfrontSettings: sections.shopfrontSettings ?? {},
  };
  const serialized = JSON.stringify(data);
  const checksum = crypto.createHash("sha256").update(serialized).digest("hex");
  const metadata = {
    createdAt,
    source: source === "manual" ? "manual" : "scheduled",
    schemaVersion: 1,
    checksum,
    sizeBytes: Buffer.byteLength(serialized),
    counts: {
      appointments: Object.keys(data.appointments).length,
      clients: Object.keys(data.clients).length,
      waitlistEntries: Object.keys(data.waitlistEntries).length,
      barbers: Object.keys(data.barbers).length,
    },
  };
  return { metadata, data };
};

export const expiredBackupKeys = (index = {}, keep = 14) =>
  Object.entries(index)
    .sort((first, second) => Number(second[1]?.createdAt) - Number(first[1]?.createdAt))
    .slice(Math.max(1, keep))
    .map(([key]) => key);
