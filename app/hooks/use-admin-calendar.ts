"use client";
import { useMemo } from "react";
import { selectNearestAppointments } from "../../shared/appointment-label.mjs";
import { getAppointmentEndDateTime, isClosedAppointmentStatus, timeToMinutes, getAppointmentSortValue, getAvailabilityForDate, timeSlots, workdayStartMinutes, workdayEndMinutes, minutesToTime, dayKey, isVisibleInClientDatabase } from "../lib/booking-selectors";
import type { AdminAppointment, WorkSettings } from "../lib/booking-types";

export function useAdminCalendar({ adminAppointments, barberAllAppointments, adminSelectedKey, workSettings, currentDate, today }: {
  adminAppointments: AdminAppointment[]; barberAllAppointments: AdminAppointment[]; adminSelectedKey: string; workSettings: WorkSettings; currentDate: Date; today: Date;
}) {
  const adminAppointmentDays = useMemo(
    () =>
      Array.from(new Set(adminAppointments.map((appointment) => appointment.dateKey))).sort(
        (first, second) => first.localeCompare(second),
      ),
    [adminAppointments],
  );
  const adminDayAppointments = useMemo(
    () =>
      adminAppointments
        .filter((appointment) => appointment.dateKey === adminSelectedKey)
        .sort((first, second) => timeToMinutes(first.startTime) - timeToMinutes(second.startTime)),
    [adminAppointments, adminSelectedKey],
  );
  const upcomingAdminAppointments = useMemo(
    () =>
      adminAppointments
        .filter(
          (appointment) =>
            !isClosedAppointmentStatus(appointment.status) &&
            getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime(),
        )
        .sort((first, second) =>
          getAppointmentSortValue(first).localeCompare(getAppointmentSortValue(second)),
        ),
    [adminAppointments, currentDate],
  );
  const nearestAdminAppointments = selectNearestAppointments(upcomingAdminAppointments, 4) as AdminAppointment[];
  const adminDayAvailability = getAvailabilityForDate(adminSelectedKey, workSettings);
  const adminScheduleStartMinutes = adminDayAvailability
    ? Math.floor(timeToMinutes(adminDayAvailability.startTime) / 60) * 60
    : workdayStartMinutes;
  const adminScheduleEndMinutes = adminDayAvailability
    ? Math.ceil(timeToMinutes(adminDayAvailability.endTime) / 60) * 60
    : workdayEndMinutes;
  const adminScheduleSlots = timeSlots.filter((time) => {
    const minutes = timeToMinutes(time);
    return minutes >= adminScheduleStartMinutes && minutes < adminScheduleEndMinutes;
  });
  const adminScheduleHours = Array.from(
    { length: Math.max(1, (adminScheduleEndMinutes - adminScheduleStartMinutes) / 60) },
    (_, index) => minutesToTime(adminScheduleStartMinutes + index * 60),
  );
  const adminClientAppointments = useMemo(
    () =>
      barberAllAppointments
        .filter((appointment) => isVisibleInClientDatabase(appointment.status))
        .sort((first, second) => {
          if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
          return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        }),
    [barberAllAppointments],
  );
  const adminScheduleDays = useMemo(() => {
    const todayKey = dayKey(today);
    const keys = new Set<string>([adminSelectedKey]);

    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      keys.add(dayKey(date));
    }

    adminAppointmentDays.forEach((key) => {
      if (key >= todayKey) keys.add(key);
    });
    Object.keys(workSettings.availability).forEach((key) => {
      if (key >= todayKey) keys.add(key);
    });

    return Array.from(keys).sort((first, second) => first.localeCompare(second));
  }, [adminAppointmentDays, adminSelectedKey, today, workSettings.availability]);
  return { adminAppointmentDays, adminDayAppointments, upcomingAdminAppointments, nearestAdminAppointments, adminDayAvailability, adminScheduleStartMinutes, adminScheduleEndMinutes, adminScheduleSlots, adminScheduleHours, adminClientAppointments, adminScheduleDays };
}
