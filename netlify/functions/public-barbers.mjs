import { getAccessToken, readDatabase, jsonResponse } from "./_firebase-admin.mjs";
import { publicBarber } from "../../shared/shopfront.mjs";

// Read the canonical profiles so legacy accounts appear without a migration,
// and deactivated team members disappear without a second public copy.
export default async function handler(request) {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const token = await getAccessToken();
    const members = await readDatabase("team/barbers", token) || {};
    const barbers = await Promise.all(Object.entries(members)
      .filter(([, member]) => member.active === true)
      .map(async ([id, member]) => publicBarber(id, member,
        await readDatabase(`barbers/${encodeURIComponent(id)}/profile`, token) || {})));
    return jsonResponse({ barbers });
  } catch {
    return jsonResponse({ error: "Nie udało się wczytać zespołu." }, 503);
  }
}
