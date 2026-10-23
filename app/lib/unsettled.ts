import {
  UNSETTLED_LOOKBACK_DAYS,
  getEndOfDayMinutes,
  shiftDateKey,
} from "../../shared/daily-summary.mjs";
import type { AdminAppointment } from "./booking-types";
import { dayKey, getAppointmentSortValue, isPotentialNoShow } from "./booking-selectors";

/** Finished visits of the last two weeks that are neither settled, marked as a no-show nor cancelled. */
export const getUnsettledVisits = (appointments: AdminAppointment[], now: Date) => {
  const oldest = shiftDateKey(dayKey(now), -UNSETTLED_LOOKBACK_DAYS);
  return appointments
    .filter((appointment) => appointment.dateKey >= oldest && isPotentialNoShow(appointment, now))
    .sort((first, second) => getAppointmentSortValue(first).localeCompare(getAppointmentSortValue(second)));
};

/** True from one hour after the working hours (or the last visit) end, the same moment the push is sent. */
export const isEndOfDay = (appointments: AdminAppointment[], workEnd: string | undefined, now: Date) =>
  now.getHours() * 60 + now.getMinutes() >=
  getEndOfDayMinutes(appointments, { dateKey: dayKey(now), workEnd: workEnd ?? "" });

const dismissKey = (barberId: string, dateKey: string) => `bnb-unsettled-${barberId}-${dateKey}`;

// Storage can be unavailable (private window, blocked data); the prompt then simply may appear again.
export const wasUnsettledPromptDismissed = (barberId: string, dateKey: string) => {
  try {
    return window.localStorage.getItem(dismissKey(barberId, dateKey)) === "1";
  } catch {
    return false;
  }
};

export const dismissUnsettledPrompt = (barberId: string, dateKey: string) => {
  try {
    window.localStorage.setItem(dismissKey(barberId, dateKey), "1");
  } catch {
    // Not critical: see above.
  }
};
