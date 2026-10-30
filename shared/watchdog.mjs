// The watchdog: once an hour it checks that the quiet parts of the app still work and e-mails the owner when one stops.
// Pure functions only, so what counts as a problem and when to speak up is covered by unit tests.

/** The nightly backup runs at 02:30; a day and a half without a new one means it is failing. */
export const BACKUP_MAX_AGE_MS = 36 * 60 * 60_000;
/** A notification waiting longer than this past its time is stuck: the worker runs every minute. */
export const QUEUE_STALL_MS = 15 * 60_000;
/** The same problem is mentioned once, then again after this long if it is still there. */
export const REMINDER_AFTER_MS = 24 * 60 * 60_000;

export const checkBackup = ({ index = {}, now }) => {
  const newest = Math.max(0, ...Object.values(index ?? {}).map((entry) => Number(entry?.createdAt) || 0));
  if (newest === 0) return { id: "backup", problem: "Nie ma żadnej kopii zapasowej danych." };
  const age = now - newest;
  return age > BACKUP_MAX_AGE_MS
    ? { id: "backup", problem: `Ostatnia kopia zapasowa ma ${Math.round(age / 3_600_000)} godz. Powinna powstawać co noc.` }
    : { id: "backup", problem: "" };
};

/** `jobs` are the waiting notifications whose time has passed (status not delivered/exhausted). */
export const checkQueue = ({ jobs = {}, now }) => {
  const stuck = Object.values(jobs ?? {}).filter((job) =>
    !["delivered", "exhausted"].includes(job?.status) &&
    Number(job?.nextAttemptAt) > 0 &&
    now - Number(job.nextAttemptAt) > QUEUE_STALL_MS &&
    !(job?.status === "processing" && Number(job?.leaseUntil) > now));
  return { id: "queue", problem: stuck.length === 0 ? "" : `${stuck.length} powiadomień czeka dłużej niż 15 minut i nie jest wysyłanych.` };
};

export const checkSite = ({ results = [] }) => {
  const failed = results.filter((result) => !result.ok);
  return { id: "site", problem: failed.length === 0 ? "" : `Nie odpowiada: ${failed.map((result) => `${result.name} (${result.detail})`).join(", ")}.` };
};

/**
 * What to do about one check, given what we remembered about it last time.
 * Returns the message to send (or none) and the state to remember.
 */
export const decideAlert = ({ previous, check, now }) => {
  const known = previous?.active === true;
  if (check.problem) {
    if (!known) return { alert: "new", state: { active: true, since: now, lastAlertAt: now, problem: check.problem } };
    if (now - Number(previous.lastAlertAt || previous.since || 0) >= REMINDER_AFTER_MS) {
      return { alert: "reminder", state: { ...previous, lastAlertAt: now, problem: check.problem } };
    }
    return { alert: "", state: { ...previous, problem: check.problem } };
  }
  return known ? { alert: "recovered", state: { active: false, recoveredAt: now } } : { alert: "", state: previous ?? { active: false } };
};

const labels = { backup: "Kopia zapasowa", queue: "Kolejka powiadomień", site: "Strona i rezerwacje" };

export const alertMessage = ({ kind, check, state }) => {
  const label = labels[check.id] ?? check.id;
  if (kind === "recovered") return { subject: `BNB: ${label} działa znowu`, text: `${label} wróciła do normy.` };
  const since = state?.since ? ` Problem trwa od ${new Date(state.since).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}.` : "";
  return {
    subject: `${kind === "reminder" ? "BNB (przypomnienie)" : "BNB"}: ${label} nie działa`,
    text: `${check.problem}${since}`,
  };
};
