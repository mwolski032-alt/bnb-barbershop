import {
  getAccessToken,
  jsonResponse,
} from "./_firebase-admin.mjs";
import { mutateScopedDatabase } from "./_scoped-database.mjs";
import { processDueNotificationJobs } from "./_notification-service.mjs";
import {
  advanceExpiredWaitlistOffers,
  offerAvailableWaitlistSlots,
} from "../../shared/waitlist.mjs";

const advanceWaitlist = async (accessToken, now) => {
  return mutateScopedDatabase(
    accessToken,
    (database) => {
    const expired = advanceExpiredWaitlistOffers(database, now);
    const available = offerAvailableWaitlistSlots(database, {
      now,
      excludedEntryIds: expired.expiredEntryIds,
    });
    const changed = expired.changed || available.changed;
    const result = {
      changed,
      expiredCount: expired.expiredCount,
      offeredCount: available.offeredCount,
      notificationOperationIds: [
        ...expired.notificationOperationIds,
        ...available.notificationOperationIds,
      ],
    };
    if (!changed) return { ...result, database, idempotent: true };
    return { ...result, database };
    },
    {
      lockScope: "appointments",
      sections: [
        "appointments",
        "waitlistEntries",
        "appointmentOperations",
        "notificationOutbox",
        "team",
        "barbers",
      ],
    },
  );
};

const handler = async () => {
  try {
    const accessToken = await getAccessToken();
    const now = Date.now();
    const waitlist = await advanceWaitlist(accessToken, now);
    const result = await processDueNotificationJobs({
      accessToken,
      now,
      siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL,
      limit: 20,
    });
    return jsonResponse({ ...result, waitlist }, result.ok ? 200 : 207);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Notification worker failed." },
      500,
    );
  }
};

export const config = {
  schedule: "* * * * *",
};

export default handler;
