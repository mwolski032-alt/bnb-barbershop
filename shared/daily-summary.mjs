// The barber's end of day. One hour after work ends the barber gets at most two pushes a day:
//   1. "Nierozliczone wizyty" - only when at least one finished visit is neither settled nor cancelled;
//   2. "Podsumowanie dnia"    - only when something was settled and nothing is left open.
// Pure functions only, so the numbers, timing and wording are covered by unit tests.

/** The reminder comes this long after the working hours end (or after the last visit, if later). */
export const END_OF_DAY_DELAY_MINUTES = 60;
/** Used when the barber set no working hours and had no visits that day. */
export const DEFAULT_WORK_END_MINUTES = 20 * 60;
/** Never later than this, so a long day does not push the reminder past bedtime. */
export const LATEST_REMINDER_MINUTES = 23 * 60;
/** Unsettled visits older than this are left alone (they would only bury today's reminder). */
export const UNSETTLED_LOOKBACK_DAYS = 14;

const warsawFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const getWarsawParts = (now = new Date()) => {
  const parts = Object.fromEntries(
    warsawFormatter.formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

export const toMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};

export const shiftDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isOpen = (appointment) => appointment.status === "confirmed" || appointment.status === "rescheduled";

/**
 * Minute of the day (Warsaw) from which the barber is reminded: an hour after the working hours end,
 * or after the last visit of the day when it ran longer.
 */
export const getEndOfDayMinutes = (appointments, { dateKey, workEnd }) => {
  let end = workEnd ? toMinutes(workEnd) : 0;
  for (const appointment of Object.values(appointments ?? {})) {
    if (!appointment || appointment.dateKey !== dateKey || appointment.status === "cancelled") continue;
    end = Math.max(end, toMinutes(appointment.startTime) + (Number(appointment.durationMinutes) || 0));
  }
  if (end === 0) end = DEFAULT_WORK_END_MINUTES;
  return Math.min(end + END_OF_DAY_DELAY_MINUTES, LATEST_REMINDER_MINUTES);
};

/**
 * Counts one barber's day. `unsettled` are visits that already ended but were neither settled, marked
 * as a no-show nor cancelled, from the last two weeks, so the analytics add up.
 */
export const collectEndOfDay = (appointments, { dateKey, minutes }) => {
  const oldest = shiftDateKey(dateKey, -UNSETTLED_LOOKBACK_DAYS);
  let completed = 0;
  let revenue = 0;
  let unsettled = 0;
  for (const appointment of Object.values(appointments ?? {})) {
    if (!appointment) continue;
    if (appointment.dateKey === dateKey && appointment.status === "completed") {
      const amount = Number(appointment.settlement?.amount);
      completed += 1;
      revenue += Number.isFinite(amount) ? amount : 0;
    } else if (isOpen(appointment) && appointment.dateKey >= oldest) {
      const ended = appointment.dateKey < dateKey ||
        (appointment.dateKey === dateKey &&
          toMinutes(appointment.startTime) + (Number(appointment.durationMinutes) || 0) <= minutes);
      if (ended) unsettled += 1;
    }
  }
  return { completed, revenue: Math.round(revenue * 100) / 100, unsettled };
};

/** What to send now: the reminder, the summary, or nothing. */
export const decideEndOfDay = (counts, sent = {}) => {
  if (counts.unsettled > 0) return sent.reminder ? null : "reminder";
  if (counts.completed > 0) return sent.summary ? null : "summary";
  return null;
};

export const pluralPl = (count, one, few, many) => {
  if (count === 1) return one;
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
};

const formatMoney = (amount) =>
  `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, useGrouping: "always" }).format(amount).replace(/\s/g, " ")} zł`;

const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0];

export const formatDailySummary = (summary, barberName = "") => {
  const first = firstName(barberName);
  return {
    title: first ? `Podsumowanie dnia, ${first}` : "Podsumowanie dnia",
    body: `Dziś ${summary.completed} ${pluralPl(summary.completed, "wizyta", "wizyty", "wizyt")}, razem ${formatMoney(summary.revenue)}. Dobra robota! 💈`,
  };
};

export const formatUnsettledReminder = (count) => ({
  title: "Sprawdź, czy rozliczyłeś",
  body: `${count} ${pluralPl(count, "wizyta czeka", "wizyty czekają", "wizyt czeka")} na rozliczenie. Dotknij, żeby zamknąć dzień.`,
});
