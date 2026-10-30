import {
  getAccessToken,
  jsonResponse,
  patchDatabase,
  readDatabase,
} from "./_firebase-admin.mjs";
import { sendOwnerEmail } from "./_alert-mail.mjs";
import { isTrial, planHousekeeping, reportText } from "../../shared/housekeeping.mjs";

// Once a week: removes push devices nobody used for half a year and other leftovers. The first week it only
// reports what it would remove (to the owner by e-mail and in `housekeepingReports`), then it removes for real.
export const runHousekeeping = async ({ accessToken, now = Date.now(), send = sendOwnerEmail }) => {
  const [tokens, requestLimits, rebookNudges, broadcastLog, state] = await Promise.all([
    readDatabase("notificationTokens", accessToken),
    readDatabase("requestLimits", accessToken),
    readDatabase("rebookNudges", accessToken),
    readDatabase("broadcastLog", accessToken),
    readDatabase("housekeeping/state", accessToken),
  ]);
  const startedAt = Number(state?.startedAt) || now;
  const trial = isTrial({ startedAt: state?.startedAt, now });
  const plan = planHousekeeping({ tokens, requestLimits, rebookNudges, broadcastLog, now });

  const updates = { "housekeeping/state": { startedAt, lastRunAt: now, trial } };
  if (!trial) for (const { path } of plan.removals) updates[path] = null;
  updates[`housekeepingReports/${now}`] = {
    at: now,
    trial,
    counts: plan.counts,
    total: plan.total,
    paths: plan.removals.slice(0, 50).map(({ path }) => path),
  };
  await patchDatabase("", updates, accessToken);

  const text = reportText({ counts: plan.counts, total: plan.total, trial });
  if (trial || plan.total > 0) await send({ subject: trial ? "BNB: próbne sprzątanie bazy" : "BNB: sprzątanie bazy", text });
  return { ok: true, trial, total: plan.total, counts: plan.counts, removed: trial ? 0 : plan.removals.length };
};

const handler = async () => {
  try {
    return jsonResponse(await runHousekeeping({ accessToken: await getAccessToken() }));
  } catch (error) {
    console.error("Housekeeping failed", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Housekeeping failed." }, 500);
  }
};

// Sunday 03:00 UTC, when nobody is booking.
export const config = {
  schedule: "0 3 * * 0",
};

export default handler;
