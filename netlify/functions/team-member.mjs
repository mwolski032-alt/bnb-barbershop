import {
  DatabaseLeaseError,
  getAccessToken,
  getAdminContext,
  jsonResponse,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
  verifyRequestUser,
  withDatabaseLock,
} from "./_firebase-admin.mjs";
import { BARBER_ID_PATTERN } from "../../shared/team-invite.mjs";
import { planBarberRemoval } from "../../shared/team-removal.mjs";

export const config = {
  path: "/api/team-member",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

// The owner deletes a barber who has no visits and no waiting-list entries. The team record is not writable with
// the scheduling credential, so this uses the server's own, inside the same lock as every booking: nobody can
// book the barber between the check and the deletion.
export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  try {
    const user = await verifyRequestUser(request);
    const accessToken = await getAccessToken();
    const context = user ? await getAdminContext(user, accessToken) : null;
    if (!context?.isOwner || !context.active) {
      return jsonResponse({ ok: false, error: "Tylko właściciel może usuwać barberów." }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const barberId = String(body?.barberId ?? "");
    if (!BARBER_ID_PATTERN.test(barberId)) return jsonResponse({ ok: false, error: "Nieprawidłowy barber." }, 400);

    const result = await withDatabaseLock("appointments", accessToken, async () => {
      const [members, barberAppointments, barberWaitlist, clients, gallery] = await Promise.all([
        readDatabase("team/barbers", accessToken),
        readDatabaseQuery("appointments", { orderBy: "barberId", equalTo: barberId }, accessToken),
        readDatabaseQuery("waitlistEntries", { orderBy: "barberId", equalTo: barberId }, accessToken),
        readDatabase("clients", accessToken),
        readDatabase("shopfront/gallery", accessToken),
      ]);
      const plan = planBarberRemoval({ barberId, members, barberAppointments, barberWaitlist, clients, gallery });
      if (plan.error) return plan;
      await patchDatabase("", plan.updates, accessToken);
      return plan;
    });
    if (result.error) return jsonResponse({ ok: false, error: result.error }, result.status ?? 409);
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof DatabaseLeaseError) return jsonResponse({ ok: false, error: error.message }, 409);
    return jsonResponse({ ok: false, error: "Nie udało się usunąć barbera. Spróbuj ponownie." }, 500);
  }
}
