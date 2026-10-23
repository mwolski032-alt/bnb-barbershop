import {
  getAccessToken,
  jsonResponse,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
} from "./_firebase-admin.mjs";
import { sendDirectPush } from "./_notification-service.mjs";
import { getWarsawParts } from "../../shared/daily-summary.mjs";
import {
  MAX_NUDGES_PER_RUN,
  SEND_FROM_HOUR,
  SEND_UNTIL_HOUR,
  findRebookCandidates,
  formatRebookNudge,
} from "../../shared/rebook.mjs";

// Once a day, in the late morning, clients who are due for a haircut (by their own rhythm) and have
// nothing booked get one friendly push. Each client is nudged once per visit cycle, never repeatedly.
export const sendRebookNudges = async ({ accessToken, now = new Date(), siteUrl }) => {
  const warsaw = getWarsawParts(now);
  if (warsaw.hour < SEND_FROM_HOUR || warsaw.hour >= SEND_UNTIL_HOUR) return { ok: true, skipped: "quiet_hours", sent: 0 };

  const members = (await readDatabase("team/barbers", accessToken)) ?? {};
  const activeBarbers = Object.entries(members).filter(([, member]) => member?.active === true);
  const perBarber = await Promise.all(activeBarbers.map(([barberId]) =>
    readDatabaseQuery("appointments", { orderBy: "barberId", equalTo: barberId }, accessToken)));
  const appointments = Object.assign({}, ...perBarber.map((records) => records ?? {}));

  const nudges = (await readDatabase("rebookNudges", accessToken)) ?? {};
  const candidates = findRebookCandidates(appointments, nudges, { todayKey: warsaw.dateKey })
    .slice(0, MAX_NUDGES_PER_RUN);

  let sent = 0;
  for (const candidate of candidates) {
    const copy = formatRebookNudge(candidate.daysSince, members[candidate.barberId]?.name);
    const result = await sendDirectPush({
      accessToken,
      uid: candidate.uid,
      title: copy.title,
      body: copy.body,
      tag: `rebook-${candidate.uid}`,
      siteUrl,
      event: "rebook",
      query: { barber: candidate.barberId },
    });
    // A client without a push device is remembered too, so the next run does not retry them forever.
    if (result.sent > 0 || result.targets === 0) {
      await patchDatabase(`rebookNudges/${encodeURIComponent(candidate.uid)}`, { sentAt: Date.now(), barberId: candidate.barberId, delivered: result.sent > 0 }, accessToken);
    }
    if (result.sent > 0) sent += 1;
  }
  return { ok: true, candidates: candidates.length, sent };
};

const handler = async () => {
  try {
    return jsonResponse(await sendRebookNudges({
      accessToken: await getAccessToken(),
      siteUrl: process.env.URL || process.env.DEPLOY_PRIME_URL || "https://bnbbarbershop.pl",
    }));
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : "Rebook nudges failed." },
      500,
    );
  }
};

// 09:00 UTC is 10:00 or 11:00 in Warsaw, inside the allowed hours in both summer and winter time.
export const config = {
  schedule: "0 9 * * *",
};

export default handler;
