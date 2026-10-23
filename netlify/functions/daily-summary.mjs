import {
  getAccessToken,
  jsonResponse,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
} from "./_firebase-admin.mjs";
import { sendDirectPush } from "./_notification-service.mjs";
import {
  END_OF_DAY_DELAY_MINUTES,
  collectEndOfDay,
  decideEndOfDay,
  formatDailySummary,
  formatUnsettledReminder,
  getEndOfDayMinutes,
  getWarsawParts,
  toMinutes,
} from "../../shared/daily-summary.mjs";

// An hour after the barber's working hours end, one push per barber says either "check what you have not
// settled" (only if something is open) or, once everything is closed, "here is your day" (only if anyone
// was served). Nothing is sent per client, so the notification panel stays clean.
export const sendEndOfDayPushes = async ({ accessToken, now = new Date(), siteUrl }) => {
  const warsaw = getWarsawParts(now);
  const members = (await readDatabase("team/barbers", accessToken)) ?? {};
  const sent = [];

  for (const [barberId, member] of Object.entries(members)) {
    if (member?.active !== true || !member.userId) continue;
    const key = encodeURIComponent(barberId);
    const markerPath = `dailySummaries/${key}/${warsaw.dateKey}`;
    const marker = (await readDatabase(markerPath, accessToken)) ?? {};
    if (marker.reminderAt && marker.summaryAt) continue;

    const window = await readDatabase(`barbers/${key}/workSettings/availability/${warsaw.dateKey}`, accessToken);
    const workEnd = typeof window?.endTime === "string" ? window.endTime : "";
    // Cheap exit before the larger read: working hours have not ended long enough ago.
    if (workEnd && warsaw.minutes < toMinutes(workEnd) + END_OF_DAY_DELAY_MINUTES) continue;

    const appointments = await readDatabaseQuery(
      "appointments",
      { orderBy: "barberId", equalTo: barberId },
      accessToken,
    );
    if (warsaw.minutes < getEndOfDayMinutes(appointments, { dateKey: warsaw.dateKey, workEnd })) continue;

    const counts = collectEndOfDay(appointments, warsaw);
    const kind = decideEndOfDay(counts, { reminder: Boolean(marker.reminderAt), summary: Boolean(marker.summaryAt) });
    if (!kind) continue;

    const copy = kind === "reminder"
      ? formatUnsettledReminder(counts.unsettled)
      : formatDailySummary(counts, member.name);
    const result = await sendDirectPush({
      accessToken,
      uid: String(member.userId),
      title: copy.title,
      body: copy.body,
      tag: `${kind === "reminder" ? "unsettled" : "daily-summary"}-${barberId}-${warsaw.dateKey}`,
      siteUrl,
      event: kind === "reminder" ? "unsettled" : "daily_summary",
      // The reminder opens the settle-up window; the summary just opens the app where it was left.
      query: kind === "reminder" ? {} : undefined,
    });
    if (result.sent > 0) {
      await patchDatabase(
        `dailySummaries/${key}/${warsaw.dateKey}`,
        kind === "reminder"
          ? { reminderAt: Date.now(), unsettled: counts.unsettled }
          : { summaryAt: Date.now(), completed: counts.completed, revenue: counts.revenue },
        accessToken,
      );
      sent.push({ barberId, kind });
    }
  }
  return { ok: true, sent };
};

const handler = async () => {
  try {
    const result = await sendEndOfDayPushes({
      accessToken: await getAccessToken(),
      siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL || "https://bnbbarbershop.pl",
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "End of day check failed." },
      500,
    );
  }
};

// Netlify cron runs in UTC: 10:00-21:59 UTC covers 11:00-23:59 Warsaw in both summer and winter time.
// The exact moment is decided above from each barber's own working hours.
export const config = {
  schedule: "*/15 10-21 * * *",
};

export default handler;
