import { jsonResponse } from "./_firebase-admin.mjs";
import { processDueNotificationJobs } from "./_notification-service.mjs";

const handler = async () => {
  try {
    const result = await processDueNotificationJobs({
      siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL,
      limit: 20,
    });
    return jsonResponse(result, result.ok ? 200 : 207);
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
