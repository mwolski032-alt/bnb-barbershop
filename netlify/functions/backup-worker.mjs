import { jsonResponse } from "./_firebase-admin.mjs";
import { createStoredBusinessBackup } from "./_business-backup.mjs";

export const config = {
  schedule: "30 2 * * *",
};

export default async function handler() {
  try {
    const result = await createStoredBusinessBackup({ source: "scheduled" });
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    console.error("Daily business backup failed", error);
    return jsonResponse({ ok: false, error: "Backup unavailable" }, 503);
  }
}
