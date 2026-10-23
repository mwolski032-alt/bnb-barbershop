import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
  readDatabaseQuery,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import { publicAppointmentAudit } from "../../shared/appointment-audit.mjs";

export const config = { path: "/api/appointment-history" };

export default async function handler(request) {
  try {
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
    const accessToken = await getAccessToken();
    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ error: "Owner access required" }, 403);
    const context = await getAdminContext(user, accessToken);
    if (!context.isOwner || !context.active) {
      return jsonResponse({ error: "Owner access required" }, 403);
    }

    const value = (await readDatabaseQuery(
      "appointmentAudit",
      { orderBy: "createdAt", limitToLast: 100 },
      accessToken,
    )) ?? {};
    const events = Object.values(value)
      .map(publicAppointmentAudit)
      .sort((first, second) => second.createdAt - first.createdAt);
    return jsonResponse({ events });
  } catch (error) {
    console.error("Appointment history request failed", error);
    return jsonResponse({ error: "History service unavailable" }, 503);
  }
}
