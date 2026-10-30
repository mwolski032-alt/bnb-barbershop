// Weekly housekeeping: removes data nobody needs any more, so the recipient list holds no ghosts and the database stays small.
// It only decides; the scheduled function carries the plan out (or, during the trial week, only reports it).

const DAY = 24 * 60 * 60_000;

/** A push device nobody opened the app on for this long is gone (new phone, app removed). */
export const DEVICE_MAX_IDLE_MS = 180 * DAY;
/** Rate-limit marks are about minutes long; anything older than this is dead weight. */
export const LIMIT_MAX_AGE_MS = 2 * DAY;
/** "Time for another visit" marks only matter within one visit cycle; this is far past it. */
export const NUDGE_MAX_AGE_MS = 400 * DAY;
/** The record of hand-written messages is kept for a year. */
export const BROADCAST_LOG_MAX_AGE_MS = 365 * DAY;
/** The first week only reports what would go; real deletion starts after it. */
export const TRIAL_MS = 7 * DAY;
export const MAX_REMOVALS_PER_RUN = 500;

const lastSeen = (device) => Math.max(Number(device?.lastSeenAt) || 0, Number(device?.updatedAt) || 0);

/**
 * @returns {{ removals: Array<{ path: string, reason: string }>, counts: Record<string, number> }}
 * Paths are database paths; removing a path removes its record. A device with no timestamp at all is kept.
 */
export const planHousekeeping = ({ tokens = {}, requestLimits = {}, rebookNudges = {}, broadcastLog = {}, now }) => {
  const removals = [];
  const add = (path, reason) => removals.push({ path, reason });

  for (const [uid, devices] of Object.entries(tokens ?? {})) {
    for (const [deviceKey, device] of Object.entries(devices ?? {})) {
      const seen = lastSeen(device);
      if (seen > 0 && now - seen > DEVICE_MAX_IDLE_MS) add(`notificationTokens/${uid}/${deviceKey}`, "device");
    }
  }
  for (const [uid, scopes] of Object.entries(requestLimits ?? {})) {
    for (const [scope, markedAt] of Object.entries(scopes ?? {})) {
      const at = Number(markedAt);
      if (at > 0 && now - at > LIMIT_MAX_AGE_MS) add(`requestLimits/${uid}/${scope}`, "limit");
    }
  }
  for (const [uid, nudge] of Object.entries(rebookNudges ?? {})) {
    const at = Number(nudge?.sentAt);
    if (at > 0 && now - at > NUDGE_MAX_AGE_MS) add(`rebookNudges/${uid}`, "nudge");
  }
  for (const [key, entry] of Object.entries(broadcastLog ?? {})) {
    const at = Number(entry?.sentAt);
    if (at > 0 && now - at > BROADCAST_LOG_MAX_AGE_MS) add(`broadcastLog/${key}`, "broadcast");
  }

  const counts = {};
  for (const { reason } of removals) counts[reason] = (counts[reason] ?? 0) + 1;
  return { removals: removals.slice(0, MAX_REMOVALS_PER_RUN), counts, total: removals.length };
};

/** The trial week starts the first time housekeeping runs. */
export const isTrial = ({ startedAt, now }) => !Number(startedAt) || now - Number(startedAt) < TRIAL_MS;

export const reportText = ({ counts, total, trial }) => {
  const names = { device: "nieużywanych urządzeń z powiadomieniami", limit: "starych wpisów limitów", nudge: "starych podpowiedzi „czas na wizytę”", broadcast: "starych wpisów dziennika wiadomości" };
  const lines = Object.entries(counts).map(([reason, count]) => `- ${count} ${names[reason] ?? reason}`);
  if (total === 0) return trial ? "Próbne sprzątanie: nic do usunięcia." : "Sprzątanie: nic do usunięcia.";
  return `${trial ? "Próbne sprzątanie (nic jeszcze nie usunięto). Zniknęłoby:" : "Sprzątanie usunęło:"}\n${lines.join("\n")}`;
};
