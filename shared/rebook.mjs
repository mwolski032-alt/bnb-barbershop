// "Time for your next visit": one gentle push per client per visit cycle, sent when the client's own
// rhythm says they are due and nothing is booked yet. Pure functions, covered by unit tests.

import { pluralPl } from "./daily-summary.mjs";

export const DEFAULT_INTERVAL_DAYS = 28;
export const MIN_INTERVAL_DAYS = 14;
export const MAX_INTERVAL_DAYS = 56;
/** A client who stayed away this long is not nudged any more. */
export const GIVE_UP_AFTER_DAYS = 120;
/** Pushes are sent only during these Warsaw hours. */
export const SEND_FROM_HOUR = 10;
export const SEND_UNTIL_HOUR = 18;
export const MAX_NUDGES_PER_RUN = 50;

const DAY_MS = 86_400_000;
const dayNumber = (dateKey) => Math.floor(Date.parse(`${dateKey}T12:00:00Z`) / DAY_MS);

/** Average gap between a client's visits, kept within a sensible range. First-timers get the default. */
export const getClientInterval = (dateKeys) => {
  const days = [...new Set(dateKeys)].map(dayNumber).sort((a, b) => a - b);
  if (days.length < 2) return DEFAULT_INTERVAL_DAYS;
  const average = (days[days.length - 1] - days[0]) / (days.length - 1);
  return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, Math.round(average)));
};

/**
 * `appointments`: every active barber's appointments. `nudges`: { [uid]: { sentAt } } from earlier runs.
 * Returns who should get a push now: { uid, barberId, daysSince }.
 */
export const findRebookCandidates = (appointments, nudges, { todayKey }) => {
  const byUser = new Map();
  for (const appointment of Object.values(appointments ?? {})) {
    if (!appointment?.userId) continue;
    const entry = byUser.get(appointment.userId) ?? { completed: [], upcoming: false };
    if (appointment.status === "completed") entry.completed.push(appointment);
    else if ((appointment.status === "confirmed" || appointment.status === "rescheduled") && appointment.dateKey >= todayKey) {
      entry.upcoming = true;
    }
    byUser.set(appointment.userId, entry);
  }

  const candidates = [];
  const today = dayNumber(todayKey);
  for (const [uid, entry] of byUser) {
    if (entry.upcoming || entry.completed.length === 0) continue;
    entry.completed.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const last = entry.completed[entry.completed.length - 1];
    const daysSince = today - dayNumber(last.dateKey);
    const interval = getClientInterval(entry.completed.map((appointment) => appointment.dateKey));
    if (daysSince < interval || daysSince > GIVE_UP_AFTER_DAYS) continue;
    // One nudge per visit cycle: a nudge sent after the last visit is not repeated.
    const sentAt = Number(nudges?.[uid]?.sentAt) || 0;
    if (sentAt > Date.parse(`${last.dateKey}T00:00:00Z`)) continue;
    candidates.push({ uid, barberId: last.barberId, daysSince });
  }
  return candidates.sort((a, b) => b.daysSince - a.daysSince);
};

export const formatRebookNudge = (daysSince, barberName = "") => {
  const weeks = Math.max(1, Math.round(daysSince / 7));
  const where = barberName ? ` u ${barberName}` : "";
  return {
    title: "Czas na kolejną wizytę ✂️",
    body: `Minęło już ${weeks} ${pluralPl(weeks, "tydzień", "tygodnie", "tygodni")} od ostatniej wizyty${where}. Umów się na wygodny termin.`,
  };
};
