import {
  getAccessToken,
  jsonResponse,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
} from "./_firebase-admin.mjs";
import { sendOwnerEmail } from "./_alert-mail.mjs";
import {
  QUEUE_STALL_MS,
  alertMessage,
  checkBackup,
  checkQueue,
  checkSite,
  decideAlert,
} from "../../shared/watchdog.mjs";

// Every hour: is the nightly backup fresh, is the notification queue moving, does the site answer?
// A problem is e-mailed to the owner once, again after a day if it is still there, and once more when it is fixed.
const probe = async (name, url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: "follow" });
    return { name, ok: response.ok, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : "brak odpowiedzi" };
  }
};

export const runWatchdog = async ({ accessToken, now = Date.now(), siteUrl, send = sendOwnerEmail, probeSite = probe }) => {
  const [index, jobs, remembered, root, barbers] = await Promise.all([
    readDatabase("businessBackupIndex", accessToken),
    readDatabaseQuery("notificationOutbox", { orderBy: "nextAttemptAt", startAt: 1, endAt: now - QUEUE_STALL_MS, limitToFirst: 50 }, accessToken),
    readDatabase("watchdogState", accessToken),
    probeSite("strona", `${siteUrl}/`),
    probeSite("rezerwacje", `${siteUrl}/.netlify/functions/public-barbers`),
  ]);
  const checks = [
    checkBackup({ index: index ?? {}, now }),
    checkQueue({ jobs: jobs ?? {}, now }),
    checkSite({ results: [root, barbers] }),
  ];

  const updates = {};
  const sent = [];
  for (const check of checks) {
    const { alert, state } = decideAlert({ previous: remembered?.[check.id], check, now });
    if (!alert) { updates[`watchdogState/${check.id}`] = state; continue; }
    const message = alertMessage({ kind: alert, check, state });
    const mail = await send(message);
    // Remember an alert only once it really went out; otherwise the next run tries again.
    if (mail.ok) updates[`watchdogState/${check.id}`] = state;
    updates[`healthAlerts/${now}-${check.id}-${alert}`] = { ...message, kind: alert, at: now, mailed: mail.ok, ...(mail.ok ? {} : { mailError: mail.reason }) };
    sent.push({ id: check.id, alert, mailed: mail.ok });
  }
  await patchDatabase("", updates, accessToken);
  return { ok: true, problems: checks.filter((check) => check.problem).map((check) => check.id), sent };
};

const handler = async () => {
  try {
    return jsonResponse(await runWatchdog({
      accessToken: await getAccessToken(),
      siteUrl: process.env.URL || "https://bnbbarbershop.pl",
    }));
  } catch (error) {
    console.error("Watchdog failed", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Watchdog failed." }, 500);
  }
};

export const config = {
  schedule: "17 * * * *",
};

export default handler;
