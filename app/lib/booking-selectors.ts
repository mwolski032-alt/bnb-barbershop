import type { Service, AppointmentStatus, AdminAppointment, WorkSettings, AnalyticsPeriod, ClientRecord } from "./booking-types";

export const workdayStartMinutes = 8 * 60;

export const workdayEndMinutes = 16 * 60;

export const analyticsDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
});

export const analyticsMonthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });

export const analyticsWeekdayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });

export const normalizeAppointmentStatus = (status?: string): AppointmentStatus =>
  status === "rescheduled" || status === "cancelled" || status === "completed" || status === "no_show"
    ? status
    : "confirmed";

export const isClosedAppointmentStatus = (status?: string) =>
  ["cancelled", "completed", "no_show"].includes(normalizeAppointmentStatus(status));

export const isVisibleInClientDatabase = (status?: string) =>
  !["cancelled", "no_show"].includes(normalizeAppointmentStatus(status));

export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

export const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

export const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const getPhoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("48") && digits.length >= 11 ? digits.slice(2, 11) : digits.slice(0, 9);
};

export const getServicePriceValue = (value: string) => {
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!normalized) return Number.NaN;
  return Number(
    normalized.includes(",")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized,
  );
};

export const getAppointmentPriceValue = (appointment: Pick<AdminAppointment, "price" | "priceAmount">) =>
  Number.isFinite(Number(appointment.priceAmount))
    ? Number(appointment.priceAmount)
    : getServicePriceValue(appointment.price);

export const getAppointmentRevenue = (appointment: AdminAppointment) =>
  Number.isFinite(Number(appointment.settlement?.amount))
    ? Number(appointment.settlement?.amount)
    : getAppointmentPriceValue(appointment);

export const getAnalyticsRange = (period: AnalyticsPeriod, now: Date) => {
  let start: Date;
  let end: Date;
  let previousStart: Date;
  let previousEnd: Date;

  if (period === "week") {
    const mondayOffset = (now.getDay() + 6) % 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7);
    previousEnd = new Date(start.getTime() - 1);
  } else if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (period === "quarter") {
    start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    previousStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    previousEnd = new Date(now.getFullYear(), now.getMonth() - 2, 0, 23, 59, 59, 999);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    previousStart = new Date(now.getFullYear() - 1, 0, 1);
    previousEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  }

  return { start, end, previousStart, previousEnd };
};

export const getAppointmentDateTime = (appointment: Pick<AdminAppointment, "dateKey" | "startTime">) => {
  const date = dateFromKey(appointment.dateKey);
  const [hour, minute] = appointment.startTime.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
};

export const getAppointmentEndDateTime = (
  appointment: Pick<AdminAppointment, "dateKey" | "startTime" | "durationMinutes">,
) => {
  const date = getAppointmentDateTime(appointment);
  date.setMinutes(date.getMinutes() + appointment.durationMinutes);
  return date;
};

export const canSettleAppointment = (appointment: AdminAppointment, now: Date) => {
  if (isClosedAppointmentStatus(appointment.status)) {
    return false;
  }
  const settlementAvailableAt = getAppointmentDateTime(appointment);
  settlementAvailableAt.setMinutes(settlementAvailableAt.getMinutes() + 1);
  return now.getTime() >= settlementAvailableAt.getTime();
};

export const isPotentialNoShow = (appointment: AdminAppointment, now: Date) =>
  !isClosedAppointmentStatus(appointment.status) &&
  now.getTime() > getAppointmentEndDateTime(appointment).getTime();

export const getAdminClientId = (appointment: AdminAppointment) =>
  appointment.clientId?.trim() ||
  appointment.userId?.trim() ||
  appointment.clientEmail?.trim().toLowerCase() ||
  getPhoneDigits(appointment.phone ?? "") ||
  appointment.clientName.trim().toLowerCase();

export const getClientFullName = (client: Pick<ClientRecord, "firstName" | "lastName">) =>
  [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || "Klient";

export const getAppointmentSortValue = (appointment: AdminAppointment) =>
  `${appointment.dateKey}T${appointment.startTime}`;

export const buildTimeSlots = (startHour = 6, endHour = 22) => {
  const slots: string[] = [];

  for (let hour = startHour; hour <= endHour; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      if (hour === endHour && minute > 0) continue;
      slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }

  return slots;
};

export const timeSlots = buildTimeSlots();

export const defaultWorkSettings: WorkSettings = {
  availability: {},
};

export const normalizeWorkSettings = (
  value: Partial<WorkSettings> | null,
  barberId: string,
): WorkSettings => ({
  availability: Object.fromEntries(
    Object.entries(value?.availability ?? {}).map(([key, windowItem]) => [
      key,
      {
        ...windowItem,
        id: key,
        barberId,
        dateKey: key,
      },
    ]),
  ),
});

export const normalizeServices = (
  value: Record<string, Partial<Service>> | null,
  barberId: string,
): Service[] => {
  const loadedServices = Object.entries(value ?? {})
    .map(([id, service], index) => ({
      id,
      barberId,
      name: service.name?.trim() || "Usługa",
      price: service.price?.trim() || "0 zł",
      durationMinutes: Number(service.durationMinutes) || 30,
      order: Number(service.order ?? index),
    }))
    .sort((first, second) => (first.order ?? 0) - (second.order ?? 0));

  return loadedServices;
};

export const getAvailabilityForDate = (dateKeyValue: string, settings: WorkSettings) =>
  settings.availability[dateKeyValue] ?? null;
