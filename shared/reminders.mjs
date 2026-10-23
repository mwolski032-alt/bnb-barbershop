// "See you tomorrow": one push per visit, about a day ahead, asking the client to confirm or cancel.
// Pure functions, covered by unit tests. The scheduled function only reads, calls these and sends.

import { getWarsawParts, shiftDateKey } from "./daily-summary.mjs";

/** The reminder goes out this long before the visit... */
export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
/** ...but never at night: outside these Warsaw hours it moves to the evening (20:00) before. */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 21;
export const EVENING_SEND_TIME = "20:00";
/** Too late to be useful: a cancellation this close to the visit can no longer be filled. */
export const MIN_NOTICE_MS = 3 * 60 * 60 * 1000;
export const MAX_REMINDERS_PER_RUN = 50;
/** Sent-reminder records older than this are removed. */
export const RECORD_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const wallClockAsUtc = (ms) => {
  const { dateKey, minutes } = getWarsawParts(new Date(ms));
  return Date.parse(`${dateKey}T00:00:00Z`) + minutes * 60_000;
};

/** The instant of a Warsaw wall-clock date and time, summer and winter time included. */
export const warsawTimeToEpoch = (dateKey, time) => {
  const wall = Date.parse(`${dateKey}T${time}:00Z`);
  let guess = wall - (wallClockAsUtc(wall) - wall);
  // A second pass settles the hour around a clock change.
  guess = wall - (wallClockAsUtc(guess) - guess);
  return guess;
};

/** When the reminder for a visit starting at `startMs` is due. */
export const getReminderSendAt = (startMs) => {
  const ideal = startMs - REMINDER_LEAD_MS;
  const parts = getWarsawParts(new Date(ideal));
  if (parts.hour < SEND_FROM_HOUR) {
    return warsawTimeToEpoch(shiftDateKey(parts.dateKey, -1), EVENING_SEND_TIME);
  }
  if (parts.hour >= SEND_UNTIL_HOUR) return warsawTimeToEpoch(parts.dateKey, EVENING_SEND_TIME);
  return ideal;
};

const reminderSlot = (appointment) => `${appointment.dateKey} ${appointment.startTime}`;

/**
 * `appointments`: the active barbers' appointments. `sent`: { [appointmentId]: { slot } } from earlier runs.
 * Returns the visits to remind now, soonest first.
 */
export const findDueReminders = (appointments, sent, { now }) => {
  const due = [];
  for (const [id, appointment] of Object.entries(appointments ?? {})) {
    if (!appointment?.userId || appointment.status !== "confirmed") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.dateKey) || !/^\d{2}:\d{2}$/.test(appointment.startTime)) continue;
    if (appointment.attendanceConfirmedAt) continue;
    if (sent?.[id]?.slot === reminderSlot(appointment)) continue;

    const startMs = warsawTimeToEpoch(appointment.dateKey, appointment.startTime);
    const sendAt = getReminderSendAt(startMs);
    if (now < sendAt || startMs - now < MIN_NOTICE_MS) continue;
    // Booked, moved or confirmed after the reminder time: the client just heard about this visit.
    const lastTouch = Math.max(
      Number(appointment.createdAt) || 0,
      Number(appointment.rescheduledAt) || 0,
      Number(appointment.confirmedAt) || 0,
    );
    if (lastTouch > sendAt) continue;
    due.push({ id, appointment, startMs });
  }
  return due.sort((a, b) => a.startMs - b.startMs);
};

export const reminderRecord = (appointment, now, delivered) => ({
  slot: reminderSlot(appointment),
  sentAt: now,
  delivered,
});

/** Records of visits long past are dropped so the node does not grow forever. */
export const findExpiredReminderIds = (sent, now) =>
  Object.entries(sent ?? {})
    .filter(([, record]) => (Number(record?.sentAt) || 0) < now - RECORD_RETENTION_MS)
    .map(([id]) => id);

const WEEKDAYS = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];

const dayLabel = (dateKey, todayKey) => {
  if (dateKey === todayKey) return "dziś";
  if (dateKey === shiftDateKey(todayKey, 1)) return "jutro";
  const weekday = WEEKDAYS[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
  return `${weekday} ${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}`;
};

export const formatReminder = (appointment, { barberName = "", now = new Date() } = {}) => {
  const when = dayLabel(appointment.dateKey, getWarsawParts(now).dateKey);
  const where = barberName ? ` u ${barberName}` : "";
  return {
    title: when === "jutro" ? "Jutro Twoja wizyta ✂️" : "Przypomnienie o wizycie ✂️",
    body: `${appointment.serviceName}${where}: ${when} o ${appointment.startTime}. Potwierdź, że będziesz, albo odwołaj, żeby ktoś inny mógł skorzystać z terminu.`,
  };
};
