import { dateFromKey, timeToMinutes, minutesToTime, dayKey, normalizeAppointmentStatus, getAppointmentPriceValue, getPhoneDigits, getServicePriceValue } from "./booking-selectors";
import { type AppointmentColor, type AdminAppointment, type Availability } from "./booking-types";

export const monthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });

export const selectedDayFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const dayFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });

export const clientMonthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });

export const adminClientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});

export const getAppointmentDistanceLabel = (dateKeyValue: string, today: Date) => {
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const appointmentDay = dateFromKey(dateKeyValue);
  const daysAway = Math.round((appointmentDay.getTime() - currentDay.getTime()) / 86400000);

  if (daysAway === 0) return "Dzisiaj";
  if (daysAway === 1) return "Jutro";
  if (daysAway > 1 && daysAway < 7) return `Za ${daysAway} dni`;
  return selectedDayFormatter.format(appointmentDay);
};

export const appointmentColorPalette: AppointmentColor[] = [
  "blue",
  "mint",
  "pink",
  "violet",
  "amber",
  "coral",
  "sky",
  "lime",
];

export const normalizeAppointmentColor = (color?: string): AppointmentColor =>
  appointmentColorPalette.includes(color as AppointmentColor)
    ? (color as AppointmentColor)
    : "blue";

export const getNextAppointmentColor = (
  dateKeyValue: string,
  appointments: Pick<AdminAppointment, "dateKey" | "startTime" | "color">[],
) => {
  const dayColors = appointments
    .filter((appointment) => appointment.dateKey === dateKeyValue)
    .sort((first, second) => timeToMinutes(first.startTime) - timeToMinutes(second.startTime))
    .map((appointment) => normalizeAppointmentColor(appointment.color));
  const usedColors = new Set(dayColors);
  const freeColor = appointmentColorPalette.find((color) => !usedColors.has(color));

  return freeColor ?? appointmentColorPalette[dayColors.length % appointmentColorPalette.length];
};

export const addMinutesToTime = (time: string, minutes: number) =>
  minutesToTime(timeToMinutes(time) + minutes);

export const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return [hours > 0 ? `${hours}g` : "", remainingMinutes > 0 ? `${remainingMinutes}min` : ""]
    .filter(Boolean)
    .join(" ");
};

export const shiftDateKey = (key: string, days: number) => {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
};

export const formatAppointmentPrice = (amount: number) =>
  `${amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1").replace(".", ",")} zł`;

export const getAppointmentEditablePriceValue = (appointment: AdminAppointment) =>
  normalizeAppointmentStatus(appointment.status) === "completed" &&
  Number.isFinite(Number(appointment.settlement?.amount))
    ? Number(appointment.settlement?.amount)
    : getAppointmentPriceValue(appointment);

export const getAppointmentPriceInputValue = (appointment: AdminAppointment) => {
  const amount = getAppointmentEditablePriceValue(appointment);
  return Number.isFinite(amount) ? String(Math.round(amount * 100) / 100) : "";
};

export const getAppointmentDisplayPrice = (appointment: AdminAppointment) => {
  const amount = Number(appointment.settlement?.amount);
  return normalizeAppointmentStatus(appointment.status) === "completed" && Number.isFinite(amount)
    ? formatAppointmentPrice(amount)
    : appointment.price;
};

export const parseAppointmentPriceInput = (value: string) => Number(value.trim().replace(",", "."));

export const isValidAppointmentPriceInput = (value: string) => {
  if (!value.trim()) return false;
  const amount = parseAppointmentPriceInput(value);
  const roundedAmount = Math.round(amount * 100) / 100;
  return (
    Number.isFinite(amount) &&
    amount >= 0 &&
    amount <= 10_000 &&
    Math.abs(amount - roundedAmount) <= 0.000001
  );
};

export const formatPhoneNumber = (value: string) => {
  const digits = getPhoneDigits(value);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)]
    .filter(Boolean)
    .join(" ");
};

export const splitClientName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
};

export const isValidEmail = (email: string) =>
  !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export const isFirebaseKeySafe = (value: string) => !/[.#$\[\]\/]/.test(value);

export const createEntityId = (prefix: "client" | "appointment") =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}`;

export const getTimestamp = () => Date.now();

export const createServiceId = (name: string) => {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34);

  return `${slug || "usluga"}-${Date.now()}`;
};

export const formatServicePrice = (value: string) => {
  const normalizedValue = value.trim().replace(",", ".");
  const numericValue = getServicePriceValue(normalizedValue);
  if (!Number.isFinite(numericValue)) return value.trim();
  return `${numericValue % 1 === 0 ? numericValue.toFixed(0) : numericValue.toFixed(2)} zł`;
};

export const availabilityLabel: Record<Availability, string> = {
  high: "Dużo wolnych godzin",
  medium: "Średnia dostępność",
  low: "Bardzo mało godzin",
  none: "Brak terminów",
};
