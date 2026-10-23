import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import {
  createStoredBusinessBackup,
  listBusinessBackups,
} from "./_business-backup.mjs";

export const config = { path: "/api/data-backup" };

const requireOwner = async (request, accessToken) => {
  const user = await verifyRequestUser(request);
  if (!user) return null;
  const context = await getAdminContext(user, accessToken);
  return context.isOwner && context.active ? user : null;
};

export default async function handler(request) {
  try {
    if (!["GET", "POST"].includes(request.method)) {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const accessToken = await getAccessToken();
    if (!(await requireOwner(request, accessToken))) {
      return jsonResponse({ error: "Owner access required" }, 403);
    }

    if (request.method === "POST") {
      const result = await createStoredBusinessBackup({ source: "manual" });
      return jsonResponse({ ok: true, ...result });
    }

    return jsonResponse({ backups: await listBusinessBackups(accessToken) });
  } catch (error) {
    console.error("Business backup request failed", error);
    return jsonResponse({ error: "Backup service unavailable" }, 503);
  }
}
