import { dateFromKey, dayKey, getAvailabilityForDate, timeToMinutes, timeSlots } from "./booking-selectors";
import { type Appointment, type WorkSettings, type Availability, type Service, type DayCell } from "./booking-types";
import { isBookableStartTime } from "../../shared/booking-time.mjs";

export const rangesOverlap = (
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
) => startA < startB + durationB && startA + durationA > startB;

export const getDateKeysInRange = (startKey: string, endKey: string) => {
  const startDate = dateFromKey(startKey <= endKey ? startKey : endKey);
  const endDate = dateFromKey(startKey <= endKey ? endKey : startKey);
  const keys: string[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    keys.push(dayKey(current));
    current.setDate(current.getDate() + 1);
  }

  return keys;
};

export const isTimeAvailable = (
  dateKeyValue: string,
  time: string,
  durationMinutes: number,
  appointments: Appointment[],
  workSettings: WorkSettings,
) => {
  const availabilityWindow = getAvailabilityForDate(dateKeyValue, workSettings);
  const startMinutes = timeToMinutes(time);

  if (!availabilityWindow) return false;
  if (
    startMinutes < timeToMinutes(availabilityWindow.startTime) ||
    startMinutes + durationMinutes > timeToMinutes(availabilityWindow.endTime)
  ) {
    return false;
  }

  return !appointments.some(
    (appointment) =>
      appointment.dateKey === dateKeyValue &&
      rangesOverlap(
        startMinutes,
        durationMinutes,
        timeToMinutes(appointment.startTime),
        appointment.durationMinutes,
      ),
  );
};

export const getAvailableTimes = (
  dateKeyValue: string,
  durationMinutes: number,
  appointments: Appointment[],
  workSettings: WorkSettings,
  now: Date,
) =>
  timeSlots.filter(
    (time) =>
      isBookableStartTime(dateKeyValue, time, now) &&
      isTimeAvailable(dateKeyValue, time, durationMinutes, appointments, workSettings),
  );

export const availabilityFromSlots = (freeSlots: number, totalSlots: number): Availability => {
  if (freeSlots === 0 || totalSlots === 0) return "none";
  const ratio = freeSlots / totalSlots;
  if (ratio <= 0.25) return "low";
  if (ratio <= 0.6) return "medium";
  return "high";
};

export const buildCalendarDays = (
  visibleMonth: Date,
  service: Service,
  appointments: Appointment[],
  workSettings: WorkSettings,
  today: Date,
): DayCell[] => {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const calendarStart = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isPastDay = normalizedDate < normalizedToday;
    const totalSlots = isPastDay
      ? 0
      : getAvailableTimes(dayKey(date), service.durationMinutes, [], workSettings, today).length;
    const freeSlots = isPastDay
      ? 0
      : getAvailableTimes(
          dayKey(date),
          service.durationMinutes,
          appointments,
          workSettings,
          today,
        ).length;

    return {
      date,
      day: date.getDate(),
      monthOffset: date.getMonth() === month ? 0 : date < firstDay ? -1 : 1,
      availability: availabilityFromSlots(freeSlots, totalSlots),
      freeSlots,
      totalSlots,
    };
  });
};
