"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { onValue, ref, remove, set, update } from "firebase/database";

import { firebaseApp, realtimeDb } from "./lib/firebase";
import {
  sendAppointmentNotification,
} from "./lib/notifications";

type Availability = "high" | "medium" | "low" | "none";
type Step = "booking" | "confirm" | "success" | "admin";
type AdminSection = "schedule" | "clients" | "analytics" | "work" | "services" | "profile";

type Service = {
  id: string;
  barberId: string;
  name: string;
  price: string;
  durationMinutes: number;
  order?: number;
};

type Appointment = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  durationMinutes: number;
};

type DayCell = {
  date: Date;
  day: number;
  monthOffset: -1 | 0 | 1;
  availability: Availability;
  freeSlots: number;
  totalSlots: number;
};

type FormState = {
  fullName: string;
  phone: string;
};

type ServiceDraft = {
  name: string;
  price: string;
  durationMinutes: string;
};

type AdminEditDraft = {
  dateKey: string;
  startTime: string;
};

type AppointmentStatus = "confirmed" | "rescheduled" | "cancelled" | "completed";
type AppointmentColor = "blue" | "mint" | "pink" | "violet" | "amber" | "coral" | "sky" | "lime";

type BookingSummary = {
  serviceName: string;
  servicePrice: string;
  durationMinutes: number;
  date: Date;
  time: string;
  fullName: string;
  phone: string;
};

type AdminAppointment = Appointment & {
  clientId?: string;
  clientName: string;
  clientEmail?: string;
  clientPhotoUrl?: string;
  phone?: string;
  userId?: string;
  serviceName: string;
  price: string;
  color: AppointmentColor;
  status?: AppointmentStatus;
  settledAt?: number;
  settledAmount?: number;
  settlement?: {
    barberId: string;
    settledAt: number;
    amount: number;
  };
};

type AvailabilityWindow = {
  id: string;
  barberId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
};

type WorkSettings = {
  availability: Record<string, AvailabilityWindow>;
};

type AuthUser = Pick<User, "uid" | "displayName" | "email" | "photoURL">;

type AppNotification = {
  id: string;
  appointmentId: string;
  createdAt: number;
  title: string;
  body: string;
};

type SmsTemplate = "confirmation" | "reschedule" | "reminder" | "custom";
type ClientFilter = "all" | "upcoming" | "rescheduled" | "missing-phone";
type AnalyticsPeriod = "week" | "month" | "quarter" | "year";

type AdminClientProfile = {
  id: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string;
  appointments: AdminAppointment[];
  nextAppointment: AdminAppointment | null;
  lastAppointment: AdminAppointment | null;
  rescheduledCount: number;
};

type ClientRecord = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl: string;
  userId?: string;
  barberIds?: Record<string, boolean>;
  createdAt?: number;
  updatedAt?: number;
};

type ClientDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type ManualBookingDraft = {
  serviceId: string;
  dateKey: string;
  startTime: string;
};

type ClientDialogState =
  | { mode: "create" }
  | { mode: "book"; clientId: string };

type SmsComposerState = {
  clientId: string;
  appointmentId: string;
  template: SmsTemplate;
  message: string;
};

type WorkFeedback = {
  kind: "success" | "error";
  message: string;
};

type ClientSaveMode = "record" | "booking";

type BarberProfile = {
  id: string;
  name: string;
  label: string;
  accent: "blue" | "mint";
};

type BarberDetails = {
  displayName: string;
  phone: string;
  email: string;
  instagram: string;
  bio: string;
  photoUrl: string;
  updatedAt?: number;
};

const ownerUserIds = new Set(["xkyDu2Lb1Ma8McF7yfyv8PIAj1M2"]);
const barberUserIds = new Map([["XxBe4dwVYWZPtl004J4tWq6AMZ73", "mateusz"]]);
const defaultBarberId = "mateusz";
const defaultBarbers: BarberProfile[] = [
  { id: "mateusz", name: "Mateusz", label: "Barber 1", accent: "blue" },
  { id: "kacper", name: "Kacper", label: "Barber 2", accent: "mint" },
];
const shouldRunDataMigration = import.meta.env.PROD;
const maxStoredNotifications = 40;
const emptyBarberDetails: BarberDetails = {
  displayName: "",
  phone: "",
  email: "",
  instagram: "",
  bio: "",
  photoUrl: "",
};

const defaultServices: Service[] = [
  {
    id: "mens-haircut",
    barberId: defaultBarberId,
    name: "Strzyżenie męskie",
    price: "30 zł",
    durationMinutes: 90,
    order: 0,
  },
  {
    id: "beard-trim",
    barberId: defaultBarberId,
    name: "Trymowanie brody",
    price: "20 zł",
    durationMinutes: 60,
    order: 1,
  },
];

const workdayStartMinutes = 8 * 60;
const workdayEndMinutes = 16 * 60;
const monthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" });
const selectedDayFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dayFormatter = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" });
const clientMonthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });
const adminClientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});
const analyticsDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
});
const analyticsMonthFormatter = new Intl.DateTimeFormat("pl-PL", { month: "short" });
const analyticsWeekdayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "short" });
const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  confirmed: "Potwierdzona",
  rescheduled: "Przesunięta",
  cancelled: "Odwołana",
  completed: "Rozliczona",
};

const adminSectionLabels: Record<AdminSection, string> = {
  schedule: "Terminarz",
  clients: "Baza klientów",
  analytics: "Analiza",
  work: "Praca",
  services: "Usługi",
  profile: "Profil",
};

const analyticsPeriodLabels: Record<AnalyticsPeriod, string> = {
  week: "Tydzień",
  month: "Miesiąc",
  quarter: "3 mies.",
  year: "Rok",
};

const getAppointmentDistanceLabel = (dateKeyValue: string, today: Date) => {
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const appointmentDay = dateFromKey(dateKeyValue);
  const daysAway = Math.round((appointmentDay.getTime() - currentDay.getTime()) / 86400000);

  if (daysAway === 0) return "Dzisiaj";
  if (daysAway === 1) return "Jutro";
  if (daysAway > 1 && daysAway < 7) return `Za ${daysAway} dni`;
  return selectedDayFormatter.format(appointmentDay);
};

const getNotificationStorageKey = (uid: string) => `bnb-notifications-${uid}`;

const readStoredNotifications = (uid: string): AppNotification[] => {
  if (typeof window === "undefined") return [];

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getNotificationStorageKey(uid)) ?? "[]");
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is AppNotification =>
          typeof item?.id === "string" &&
          typeof item?.appointmentId === "string" &&
          typeof item?.createdAt === "number" &&
          typeof item?.title === "string" &&
          typeof item?.body === "string",
      )
      .slice(0, maxStoredNotifications);
  } catch {
    return [];
  }
};

const writeStoredNotifications = (uid: string, notifications: AppNotification[]) => {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    getNotificationStorageKey(uid),
    JSON.stringify(notifications.slice(0, maxStoredNotifications)),
  );
};
const appointmentColorPalette: AppointmentColor[] = [
  "blue",
  "mint",
  "pink",
  "violet",
  "amber",
  "coral",
  "sky",
  "lime",
];

const normalizeAppointmentStatus = (status?: string): AppointmentStatus =>
  status === "rescheduled" || status === "cancelled" || status === "completed"
    ? status
    : "confirmed";

const normalizeAppointmentColor = (color?: string): AppointmentColor =>
  appointmentColorPalette.includes(color as AppointmentColor)
    ? (color as AppointmentColor)
    : "blue";

const getNextAppointmentColor = (
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

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const addMinutesToTime = (time: string, minutes: number) =>
  minutesToTime(timeToMinutes(time) + minutes);

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return [hours > 0 ? `${hours}g` : "", remainingMinutes > 0 ? `${remainingMinutes}min` : ""]
    .filter(Boolean)
    .join(" ");
};

const getPhoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("48") && digits.length >= 11 ? digits.slice(2, 11) : digits.slice(0, 9);
};

const getServicePriceValue = (value: string) =>
  Number(value.trim().replace(",", ".").replace(/[^\d.]/g, ""));

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const formatCurrency = (value: number) => currencyFormatter.format(Math.round(value));

const getAppointmentRevenue = (appointment: AdminAppointment) =>
  Number.isFinite(appointment.settledAmount)
    ? Number(appointment.settledAmount)
    : getServicePriceValue(appointment.price);

const getAnalyticsRange = (period: AnalyticsPeriod, now: Date) => {
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

const formatPhoneNumber = (value: string) => {
  const digits = getPhoneDigits(value);
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)]
    .filter(Boolean)
    .join(" ");
};

const padDatePart = (value: number) => String(value).padStart(2, "0");

const formatCalendarDate = (date: Date) =>
  `${date.getFullYear()}${padDatePart(date.getMonth() + 1)}${padDatePart(date.getDate())}T${padDatePart(
    date.getHours(),
  )}${padDatePart(date.getMinutes())}00`;

const formatCalendarUtcDate = (date: Date) =>
  `${date.getUTCFullYear()}${padDatePart(date.getUTCMonth() + 1)}${padDatePart(
    date.getUTCDate(),
  )}T${padDatePart(date.getUTCHours())}${padDatePart(date.getUTCMinutes())}${padDatePart(
    date.getUTCSeconds(),
  )}Z`;

const escapeCalendarText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const getCalendarFileName = (summary: BookingSummary) =>
  `bnb-wizyta-${dayKey(summary.date)}-${summary.time.replace(":", "")}.ics`;

const buildCalendarEvent = (summary: BookingSummary) => {
  const [hour, minute] = summary.time.split(":").map(Number);
  const start = new Date(summary.date);
  start.setHours(hour, minute, 0, 0);

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + summary.durationMinutes);

  const title = `BNB Barbershop - ${summary.serviceName}`;
  const description = [
    `Usługa: ${summary.serviceName}`,
    `Cena: ${summary.servicePrice}`,
    `Czas trwania: ${formatDuration(summary.durationMinutes)}`,
    `Klient: ${summary.fullName}`,
    `Telefon: ${summary.phone}`,
  ].join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BNB Barbershop//Rezerwacje//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:bnb-${dayKey(summary.date)}-${summary.time.replace(":", "")}@bnb-barbershop`,
    `DTSTAMP:${formatCalendarUtcDate(new Date())}`,
    `DTSTART:${formatCalendarDate(start)}`,
    `DTEND:${formatCalendarDate(end)}`,
    `SUMMARY:${escapeCalendarText(title)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

const appointmentToBookingSummary = (appointment: AdminAppointment): BookingSummary => ({
  serviceName: appointment.serviceName,
  servicePrice: appointment.price,
  durationMinutes: appointment.durationMinutes,
  date: dateFromKey(appointment.dateKey),
  time: appointment.startTime,
  fullName: appointment.clientName,
  phone: appointment.phone ?? "",
});

const smsTemplateLabels: Record<SmsTemplate, string> = {
  confirmation: "Potwierdzenie",
  reschedule: "Zmiana terminu",
  reminder: "Przypomnienie",
  custom: "Własna",
};

const getAppointmentDateTime = (appointment: Pick<AdminAppointment, "dateKey" | "startTime">) => {
  const date = dateFromKey(appointment.dateKey);
  const [hour, minute] = appointment.startTime.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const getAppointmentEndDateTime = (
  appointment: Pick<AdminAppointment, "dateKey" | "startTime" | "durationMinutes">,
) => {
  const date = getAppointmentDateTime(appointment);
  date.setMinutes(date.getMinutes() + appointment.durationMinutes);
  return date;
};

const canSettleAppointment = (appointment: AdminAppointment, now: Date) => {
  if (normalizeAppointmentStatus(appointment.status) === "completed") return false;
  const settlementAvailableAt = getAppointmentDateTime(appointment);
  settlementAvailableAt.setMinutes(settlementAvailableAt.getMinutes() + 1);
  return now.getTime() >= settlementAvailableAt.getTime();
};

const isPotentialNoShow = (appointment: AdminAppointment, now: Date) =>
  normalizeAppointmentStatus(appointment.status) !== "completed" &&
  now.getTime() > getAppointmentEndDateTime(appointment).getTime();

const smsTemplates: SmsTemplate[] = ["confirmation", "reschedule", "reminder", "custom"];

const buildClientSmsMessage = (template: SmsTemplate, appointment: AdminAppointment) => {
  const firstName = appointment.clientName.trim().split(/\s+/)[0] || "";
  const greeting = firstName ? `Siema, ${firstName}!` : "Siema!";
  const date = adminClientDateFormatter.format(dateFromKey(appointment.dateKey));
  const visit = `${date} o ${appointment.startTime}`;

  if (template === "confirmation") {
    return `${greeting} Potwierdzam Twoją wizytę w B'n'B: ${visit}. ${appointment.serviceName}. Do zobaczenia!`;
  }

  if (template === "reschedule") {
    return `${greeting} Zmieniłem termin Twojej wizyty. Nowy termin: ${visit}. ${appointment.serviceName}. Daj znać, jeśli termin Ci nie pasuje.`;
  }

  if (template === "reminder") {
    return `${greeting} Przypominam o wizycie w B'n'B: ${visit}. ${appointment.serviceName}. Do zobaczenia!`;
  }

  return "";
};

const getAdminClientId = (appointment: AdminAppointment) =>
  appointment.clientId?.trim() ||
  appointment.userId?.trim() ||
  appointment.clientEmail?.trim().toLowerCase() ||
  getPhoneDigits(appointment.phone ?? "") ||
  appointment.clientName.trim().toLowerCase();

const splitClientName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
};

const getClientFullName = (client: Pick<ClientRecord, "firstName" | "lastName">) =>
  [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || "Klient";

const isValidEmail = (email: string) =>
  !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

const isFirebaseKeySafe = (value: string) => !/[.#$\[\]\/]/.test(value);

const createEntityId = (prefix: "client" | "appointment") =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}`;

const getTimestamp = () => Date.now();

const getAppointmentSortValue = (appointment: AdminAppointment) =>
  `${appointment.dateKey}T${appointment.startTime}`;

const buildSmsHref = (phoneDigits: string, message: string) => {
  const cleanMessage = message.trim();
  const bodySeparator =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";

  return cleanMessage ? `sms:${phoneDigits}${bodySeparator}body=${encodeURIComponent(cleanMessage)}` : `sms:${phoneDigits}`;
};

const buildTimeSlots = (startHour = 6, endHour = 22) => {
  const slots: string[] = [];

  for (let hour = startHour; hour <= endHour; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      if (hour === endHour && minute > 0) continue;
      slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    }
  }

  return slots;
};

const timeSlots = buildTimeSlots();
const workTimeOptions = timeSlots;
const defaultWorkSettings: WorkSettings = {
  availability: {},
};

const rangesOverlap = (
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
) => startA < startB + durationB && startA + durationA > startB;

const normalizeWorkSettings = (
  value: Partial<WorkSettings> | null,
  barberId = defaultBarberId,
): WorkSettings => ({
  availability: Object.fromEntries(
    Object.entries(value?.availability ?? {}).map(([key, windowItem]) => [
      key,
      {
        ...windowItem,
        id: windowItem.id || key,
        barberId: windowItem.barberId || barberId,
        dateKey: windowItem.dateKey || key,
      },
    ]),
  ),
});

const normalizeServices = (
  value: Record<string, Partial<Service>> | null,
  barberId = defaultBarberId,
): Service[] => {
  const loadedServices = Object.entries(value ?? {})
    .map(([id, service], index) => ({
      id: service.id ?? id,
      barberId: service.barberId || barberId,
      name: service.name?.trim() || "Usługa",
      price: service.price?.trim() || "0 zł",
      durationMinutes: Number(service.durationMinutes) || 30,
      order: Number(service.order ?? index),
    }))
    .sort((first, second) => (first.order ?? 0) - (second.order ?? 0));

  return loadedServices.length > 0 ? loadedServices : defaultServices;
};

const servicesToRecord = (items: Service[], barberId = defaultBarberId) =>
  Object.fromEntries(
    items.map((service, index) => [
      service.id,
      { ...service, barberId, order: index },
    ]),
  );

const normalizeBarberDetails = (value: Partial<BarberDetails> | null): BarberDetails => ({
  displayName: value?.displayName?.trim() ?? "",
  phone: value?.phone?.trim() ?? "",
  email: value?.email?.trim() ?? "",
  instagram: value?.instagram?.trim() ?? "",
  bio: value?.bio?.trim() ?? "",
  photoUrl: value?.photoUrl?.trim() ?? "",
  updatedAt: Number(value?.updatedAt) || undefined,
});

const resizeProfilePhoto = async (file: File) => {
  if (!file.type.startsWith("image/")) {
    throw new Error("Wybierz plik graficzny.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Zdjęcie może mieć maksymalnie 10 MB.");
  }

  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Nie udało się odczytać zdjęcia."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const preview = new Image();
    preview.onload = () => resolve(preview);
    preview.onerror = () => reject(new Error("Nie udało się przygotować zdjęcia."));
    preview.src = source;
  });
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nie udało się przygotować zdjęcia.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.82);
};

const createServiceId = (name: string) => {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34);

  return `${slug || "usluga"}-${Date.now()}`;
};

const formatServicePrice = (value: string) => {
  const normalizedValue = value.trim().replace(",", ".");
  const numericValue = getServicePriceValue(normalizedValue);
  if (!Number.isFinite(numericValue)) return value.trim();
  return `${numericValue % 1 === 0 ? numericValue.toFixed(0) : numericValue.toFixed(2)} zł`;
};

const getAvailabilityForDate = (dateKeyValue: string, settings: WorkSettings) =>
  settings.availability[dateKeyValue] ?? null;

const getDateKeysInRange = (startKey: string, endKey: string) => {
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

const formatWorkRange = (settings: AvailabilityWindow | null) =>
  settings ? `${settings.startTime} - ${settings.endTime}` : "Niedostępny";

const isTimeAvailable = (
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

const getAvailableTimes = (
  dateKeyValue: string,
  durationMinutes: number,
  appointments: Appointment[],
  workSettings: WorkSettings,
) =>
  timeSlots.filter((time) =>
    isTimeAvailable(dateKeyValue, time, durationMinutes, appointments, workSettings),
  );

const availabilityFromSlots = (freeSlots: number, totalSlots: number): Availability => {
  if (freeSlots === 0 || totalSlots === 0) return "none";
  const ratio = freeSlots / totalSlots;
  if (ratio <= 0.25) return "low";
  if (ratio <= 0.6) return "medium";
  return "high";
};

const buildCalendarDays = (
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
      : getAvailableTimes(dayKey(date), service.durationMinutes, [], workSettings).length;
    const freeSlots = isPastDay
      ? 0
      : getAvailableTimes(
          dayKey(date),
          service.durationMinutes,
          appointments,
          workSettings,
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

const availabilityLabel: Record<Availability, string> = {
  high: "Dużo wolnych godzin",
  medium: "Średnia dostępność",
  low: "Bardzo mało godzin",
  none: "Brak terminów",
};

export function BookingHome() {
  const today = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [step, setStep] = useState<Step>("booking");
  const [adminSection, setAdminSection] = useState<AdminSection>("schedule");
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedKey, setSelectedKey] = useState(() => dayKey(today));
  const [adminSelectedKey, setAdminSelectedKey] = useState(() => dayKey(today));
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);
  const [legacyServices, setLegacyServices] = useState<Service[]>(defaultServices);
  const [barberServices, setBarberServices] = useState<Service[] | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState(defaultServices[0].id);
  const [selectedTime, setSelectedTime] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [allAdminAppointments, setAllAdminAppointments] = useState<AdminAppointment[]>([]);
  const [clientRecords, setClientRecords] = useState<ClientRecord[]>([]);
  const [legacyWorkSettings, setLegacyWorkSettings] = useState<WorkSettings>(defaultWorkSettings);
  const [barberWorkSettings, setBarberWorkSettings] = useState<WorkSettings | null>(null);
  const [form, setForm] = useState<FormState>({ fullName: "", phone: "" });
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft>({
    name: "",
    price: "",
    durationMinutes: "60",
  });
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [bookingSummary, setBookingSummary] = useState<BookingSummary | null>(null);
  const [clientAppointmentId, setClientAppointmentId] = useState<string | null>(null);
  const [clientAppointmentsListOpen, setClientAppointmentsListOpen] = useState(false);
  const [pendingClientCancellationId, setPendingClientCancellationId] = useState<string | null>(
    null,
  );
  const [adminEditAppointmentId, setAdminEditAppointmentId] = useState<string | null>(null);
  const [reschedulingAppointmentId, setReschedulingAppointmentId] = useState<string | null>(null);
  const [successReady, setSuccessReady] = useState(false);
  const [draggedAppointmentId, setDraggedAppointmentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");
  const [clientDialog, setClientDialog] = useState<ClientDialogState | null>(null);
  const [clientSaveMode, setClientSaveMode] = useState<ClientSaveMode>("record");
  const [clientDraft, setClientDraft] = useState<ClientDraft>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [manualBookingDraft, setManualBookingDraft] = useState<ManualBookingDraft>({
    serviceId: defaultServices[0].id,
    dateKey: dayKey(today),
    startTime: "18:00",
  });
  const [clientFeedback, setClientFeedback] = useState<WorkFeedback | null>(null);
  const [isClientSaving, setIsClientSaving] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("month");
  const [selectedAdminClientId, setSelectedAdminClientId] = useState<string | null>(null);
  const [settlingAppointmentId, setSettlingAppointmentId] = useState<string | null>(null);
  const [smsComposer, setSmsComposer] = useState<SmsComposerState | null>(null);
  const [editingAvailabilityKey, setEditingAvailabilityKey] = useState<string | null>(null);
  const [pendingAvailabilityRemovalKey, setPendingAvailabilityRemovalKey] = useState<string | null>(
    null,
  );
  const [isWorkSaving, setIsWorkSaving] = useState(false);
  const [workFeedback, setWorkFeedback] = useState<WorkFeedback | null>(null);
  const [barberProfiles, setBarberProfiles] = useState<Record<string, BarberDetails>>({});
  const [profileDraft, setProfileDraft] = useState<BarberDetails>(emptyBarberDetails);
  const [profileFeedback, setProfileFeedback] = useState<WorkFeedback | null>(null);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isProfilePhotoProcessing, setIsProfilePhotoProcessing] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const previousAppointmentsRef = useRef<Map<string, AdminAppointment> | null>(null);
  const bookingServiceRef = useRef<HTMLDivElement | null>(null);
  const bookingCalendarRef = useRef<HTMLDivElement | null>(null);
  const bookingTimeRef = useRef<HTMLDivElement | null>(null);
  const calendarGestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const calendarSwipeConsumedRef = useRef(false);
  const sheetGestureRef = useRef<{ pointerId: number; y: number } | null>(null);
  const [heroScrollProgress, setHeroScrollProgress] = useState(0);
  const [availabilityDraft, setAvailabilityDraft] = useState(() => ({
    start: dayKey(today),
    end: dayKey(today),
    startTime: "10:00",
    endTime: "13:00",
  }));
  const [adminEditDraft, setAdminEditDraft] = useState<AdminEditDraft>({
    dateKey: dayKey(today),
    startTime: "10:00",
  });
  const [expandedAvailabilityMonth, setExpandedAvailabilityMonth] = useState<
    string | null | undefined
  >(undefined);

  const activeUser = currentUser;
  const isOwner = Boolean(activeUser && ownerUserIds.has(activeUser.uid));
  const signedInBarberId = activeUser ? (barberUserIds.get(activeUser.uid) ?? null) : null;
  const isBarber = Boolean(signedInBarberId);
  const isAdmin = isOwner || isBarber;
  const activeBarberId = signedInBarberId ?? selectedBarberId ?? defaultBarberId;
  const visibleBarberId = isOwner ? selectedBarberId : signedInBarberId;
  const selectedBarber =
    defaultBarbers.find((barber) => barber.id === visibleBarberId) ?? null;
  const activeBarberProfile = barberProfiles[activeBarberId] ?? emptyBarberDetails;
  const activeBarberName = activeBarberProfile.displayName || selectedBarber?.name || "Barber";
  const services = useMemo(
    () => barberServices ?? (activeBarberId === defaultBarberId ? legacyServices : []),
    [activeBarberId, barberServices, legacyServices],
  );
  const workSettings =
    barberWorkSettings ??
    (activeBarberId === defaultBarberId ? legacyWorkSettings : defaultWorkSettings);
  const adminAppointments = useMemo(
    () =>
      isAdmin
        ? allAdminAppointments.filter(
            (appointment) => (appointment.barberId || defaultBarberId) === activeBarberId,
          )
        : allAdminAppointments,
    [activeBarberId, allAdminAppointments, isAdmin],
  );
  const notificationAppointments = isBarber ? adminAppointments : allAdminAppointments;
  const ownerBarberSummaries = useMemo(
    () =>
      defaultBarbers.map((barber) => {
        const profile = barberProfiles[barber.id] ?? emptyBarberDetails;
        const barberAppointments = allAdminAppointments.filter(
          (appointment) => (appointment.barberId || defaultBarberId) === barber.id,
        );
        const upcomingAppointments = barberAppointments
          .filter(
            (appointment) =>
              normalizeAppointmentStatus(appointment.status) !== "completed" &&
              getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime(),
          )
          .sort((first, second) =>
            getAppointmentSortValue(first).localeCompare(getAppointmentSortValue(second)),
          );

        return {
          ...barber,
          name: profile.displayName || barber.name,
          photoUrl: profile.photoUrl,
          appointments: barberAppointments.length,
          today: barberAppointments.filter((appointment) => appointment.dateKey === dayKey(today))
            .length,
          clients: new Set(barberAppointments.map(getAdminClientId)).size,
          nextAppointment: upcomingAppointments[0] ?? null,
        };
      }),
    [allAdminAppointments, barberProfiles, currentDate, today],
  );
  const reschedulingAppointment =
    adminAppointments.find((appointment) => appointment.id === reschedulingAppointmentId) ?? null;
  const schedulingAppointments = reschedulingAppointment
    ? appointments.filter((appointment) => appointment.id !== reschedulingAppointment.id)
    : appointments;
  const fallbackActiveService = useMemo(
    () => ({ ...defaultServices[0], barberId: activeBarberId }),
    [activeBarberId],
  );
  const selectedService =
    services.find((item) => item.id === selectedServiceId) ?? services[0] ?? fallbackActiveService;
  const days = useMemo(
    () => buildCalendarDays(visibleMonth, selectedService, schedulingAppointments, workSettings, today),
    [schedulingAppointments, selectedService, visibleMonth, workSettings, today],
  );
  const selectedDay =
    days.find((day) => dayKey(day.date) === selectedKey) ??
    days.find((day) => day.monthOffset === 0) ??
    days[0];
  const selectedDayKey = dayKey(selectedDay.date);
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
      [...adminAppointments].sort((first, second) => {
        if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
        return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
      }),
    [adminAppointments],
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
  const adminClientProfiles = useMemo<AdminClientProfile[]>(() => {
    const appointmentGroups = new Map<string, AdminAppointment[]>();

    adminClientAppointments.forEach((appointment) => {
      const clientId = getAdminClientId(appointment);
      appointmentGroups.set(clientId, [...(appointmentGroups.get(clientId) ?? []), appointment]);
    });

    const recordsById = new Map(
      clientRecords
        .filter(
          (client) =>
            client.barberIds?.[activeBarberId] ||
            (!client.barberIds && activeBarberId === defaultBarberId) ||
            appointmentGroups.has(client.id),
        )
        .map((client) => [client.id, client]),
    );
    const clientIds = new Set([...recordsById.keys(), ...appointmentGroups.keys()]);

    return Array.from(clientIds)
      .map((id) => {
        const clientRecord = recordsById.get(id);
        const clientAppointments = appointmentGroups.get(id) ?? [];
        const sortedAppointments = [...clientAppointments].sort((first, second) =>
          getAppointmentSortValue(first).localeCompare(getAppointmentSortValue(second)),
        );
        const newestContact = [...sortedAppointments]
          .reverse()
          .find((appointment) => appointment.phone || appointment.clientEmail) ?? sortedAppointments[0];
        const nextAppointment =
          sortedAppointments.find(
            (appointment) =>
              normalizeAppointmentStatus(appointment.status) !== "completed" &&
              getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime(),
          ) ?? null;
        const lastAppointment =
          [...sortedAppointments]
            .reverse()
            .find(
              (appointment) =>
                normalizeAppointmentStatus(appointment.status) === "completed" ||
                getAppointmentEndDateTime(appointment).getTime() <= currentDate.getTime(),
            ) ?? null;

        return {
          id,
          name: clientRecord ? getClientFullName(clientRecord) : newestContact?.clientName ?? "Klient",
          email: clientRecord?.email || newestContact?.clientEmail || "",
          phone: clientRecord?.phone || newestContact?.phone || "",
          photoUrl: clientRecord?.photoUrl || newestContact?.clientPhotoUrl || "",
          appointments: sortedAppointments,
          nextAppointment,
          lastAppointment,
          rescheduledCount: sortedAppointments.filter(
            (appointment) => normalizeAppointmentStatus(appointment.status) === "rescheduled",
          ).length,
        };
      })
      .sort((first, second) => {
        if (first.nextAppointment && second.nextAppointment) {
          return getAppointmentSortValue(first.nextAppointment).localeCompare(
            getAppointmentSortValue(second.nextAppointment),
          );
        }
        if (first.nextAppointment) return -1;
        if (second.nextAppointment) return 1;
        return first.name.localeCompare(second.name, "pl");
      });
  }, [activeBarberId, adminClientAppointments, clientRecords, currentDate]);
  const filteredAdminClients = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase("pl");

    return adminClientProfiles.filter((client) => {
      const phoneDigits = getPhoneDigits(client.phone);
      const matchesQuery =
        !query ||
        [client.name, client.email, client.phone, phoneDigits]
          .join(" ")
          .toLocaleLowerCase("pl")
          .includes(query) ||
        client.appointments.some((appointment) =>
          appointment.serviceName.toLocaleLowerCase("pl").includes(query),
        );

      if (!matchesQuery) return false;
      if (clientFilter === "upcoming") return Boolean(client.nextAppointment);
      if (clientFilter === "rescheduled") return client.rescheduledCount > 0;
      if (clientFilter === "missing-phone") return phoneDigits.length !== 9;
      return true;
    });
  }, [adminClientProfiles, clientFilter, clientSearch]);
  const analytics = useMemo(() => {
    const range = getAnalyticsRange(analyticsPeriod, currentDate);
    const isWithin = (appointment: AdminAppointment, start: Date, end: Date) => {
      const appointmentTime = getAppointmentDateTime(appointment).getTime();
      return appointmentTime >= start.getTime() && appointmentTime <= end.getTime();
    };
    const completedAppointments = adminAppointments.filter(
      (appointment) =>
        normalizeAppointmentStatus(appointment.status) === "completed" &&
        isWithin(appointment, range.start, range.end),
    );
    const previousCompletedAppointments = adminAppointments.filter(
      (appointment) =>
        normalizeAppointmentStatus(appointment.status) === "completed" &&
        isWithin(appointment, range.previousStart, range.previousEnd),
    );
    const potentialNoShows = adminAppointments.filter(
      (appointment) =>
        isPotentialNoShow(appointment, currentDate) &&
        isWithin(appointment, range.start, range.end),
    );
    const upcomingAppointments = adminAppointments.filter(
      (appointment) =>
        normalizeAppointmentStatus(appointment.status) !== "completed" &&
        getAppointmentDateTime(appointment).getTime() > currentDate.getTime() &&
        isWithin(appointment, range.start, range.end),
    );
    const revenue = completedAppointments.reduce(
      (sum, appointment) => sum + getAppointmentRevenue(appointment),
      0,
    );
    const previousRevenue = previousCompletedAppointments.reduce(
      (sum, appointment) => sum + getAppointmentRevenue(appointment),
      0,
    );
    const clientIds = new Set(completedAppointments.map(getAdminClientId));
    const previousClientIds = new Set(
      adminAppointments
        .filter(
          (appointment) =>
            normalizeAppointmentStatus(appointment.status) === "completed" &&
            getAppointmentDateTime(appointment).getTime() < range.start.getTime(),
        )
        .map(getAdminClientId),
    );
    const returningClients = Array.from(clientIds).filter((id) => previousClientIds.has(id)).length;
    const newClients = Math.max(0, clientIds.size - returningClients);
    const availableMinutes = Object.values(workSettings.availability).reduce((sum, windowItem) => {
      const date = dateFromKey(windowItem.dateKey).getTime();
      if (date < range.start.getTime() || date > range.end.getTime()) return sum;
      return sum + Math.max(0, timeToMinutes(windowItem.endTime) - timeToMinutes(windowItem.startTime));
    }, 0);
    const occupiedAppointments = adminAppointments.filter(
      (appointment) =>
        isWithin(appointment, range.start, range.end) &&
        (normalizeAppointmentStatus(appointment.status) === "completed" ||
          getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime()),
    );
    const occupiedMinutes = occupiedAppointments.reduce(
      (sum, appointment) => sum + appointment.durationMinutes,
      0,
    );
    const serviceMap = new Map<string, { name: string; visits: number; revenue: number }>();

    completedAppointments.forEach((appointment) => {
      const current = serviceMap.get(appointment.serviceName) ?? {
        name: appointment.serviceName,
        visits: 0,
        revenue: 0,
      };
      current.visits += 1;
      current.revenue += getAppointmentRevenue(appointment);
      serviceMap.set(appointment.serviceName, current);
    });

    const servicesSummary = Array.from(serviceMap.values()).sort(
      (first, second) => second.revenue - first.revenue || second.visits - first.visits,
    );
    const bucketDefinitions: Array<{ label: string; start: Date; end: Date }> = [];

    if (analyticsPeriod === "week") {
      for (let offset = 0; offset < 7; offset += 1) {
        const start = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + offset);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
        bucketDefinitions.push({
          label: analyticsWeekdayFormatter.format(start).replace(".", ""),
          start,
          end,
        });
      }
    } else if (analyticsPeriod === "month") {
      const lastDay = range.end.getDate();
      for (let day = 1; day <= lastDay; day += 7) {
        const bucketEndDay = Math.min(day + 6, lastDay);
        bucketDefinitions.push({
          label: `${day}-${bucketEndDay}`,
          start: new Date(range.start.getFullYear(), range.start.getMonth(), day),
          end: new Date(range.start.getFullYear(), range.start.getMonth(), bucketEndDay, 23, 59, 59, 999),
        });
      }
    } else {
      const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      while (cursor.getTime() <= range.end.getTime()) {
        const start = new Date(cursor);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
        bucketDefinitions.push({
          label: analyticsMonthFormatter.format(start).replace(".", ""),
          start,
          end,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    const trend = bucketDefinitions.map((bucket) => ({
      label: bucket.label,
      revenue: completedAppointments
        .filter((appointment) => isWithin(appointment, bucket.start, bucket.end))
        .reduce((sum, appointment) => sum + getAppointmentRevenue(appointment), 0),
    }));

    return {
      periodLabel: `${analyticsDateFormatter.format(range.start)} - ${analyticsDateFormatter.format(range.end)}`,
      revenue,
      revenueChange:
        previousRevenue > 0
          ? Math.round(((revenue - previousRevenue) / previousRevenue) * 100)
          : revenue > 0
            ? 100
            : 0,
      visits: completedAppointments.length,
      visitsChange: completedAppointments.length - previousCompletedAppointments.length,
      clients: clientIds.size,
      occupancy: availableMinutes > 0 ? Math.min(100, Math.round((occupiedMinutes / availableMinutes) * 100)) : 0,
      averageTicket: completedAppointments.length > 0 ? revenue / completedAppointments.length : 0,
      returningClients,
      newClients,
      potentialNoShows: potentialNoShows.length,
      potentialNoShowValue: potentialNoShows.reduce(
        (sum, appointment) => sum + getServicePriceValue(appointment.price),
        0,
      ),
      plannedRevenue: upcomingAppointments.reduce(
        (sum, appointment) => sum + getServicePriceValue(appointment.price),
        0,
      ),
      servicesSummary,
      maxServiceRevenue: Math.max(1, ...servicesSummary.map((service) => service.revenue)),
      trend,
      maxTrendRevenue: Math.max(1, ...trend.map((bucket) => bucket.revenue)),
    };
  }, [adminAppointments, analyticsPeriod, currentDate, workSettings.availability]);
  const availableTimes = useMemo(
    () =>
      getAvailableTimes(
        selectedDayKey,
        selectedService.durationMinutes,
        schedulingAppointments,
        workSettings,
      ),
    [schedulingAppointments, selectedDayKey, selectedService, workSettings],
  );
  const nearestFreeSlot = useMemo(() => {
    const searchDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    for (let offset = 0; offset < 180; offset += 1) {
      const date = new Date(searchDate);
      date.setDate(searchDate.getDate() + offset);
      const dateKeyValue = dayKey(date);
      const times = getAvailableTimes(
        dateKeyValue,
        selectedService.durationMinutes,
        schedulingAppointments,
        workSettings,
      );

      if (times.length > 0) {
        return {
          date,
          dateKey: dateKeyValue,
          time: times[0],
        };
      }
    }

    return null;
  }, [schedulingAppointments, selectedService, today, workSettings]);
  const clientAppointments = useMemo(
    () =>
      activeUser
        ? adminAppointments
            .filter(
              (appointment) =>
                appointment.userId === activeUser.uid &&
                normalizeAppointmentStatus(appointment.status) !== "completed" &&
                getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime(),
            )
            .sort((first, second) => {
              if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
              return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
            })
        : [],
    [activeUser, adminAppointments, currentDate],
  );
  const nearestClientAppointment = clientAppointments[0] ?? null;
  const clientFirstName = (activeUser?.displayName ?? "Kliencie").trim().split(/\s+/)[0] || "Kliencie";
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const canShiftToPreviousMonth = visibleMonth.getTime() > currentMonthStart.getTime();
  const selectedClientAppointment =
    clientAppointments.find((appointment) => appointment.id === clientAppointmentId) ?? null;
  const pendingClientCancellation =
    clientAppointments.find((appointment) => appointment.id === pendingClientCancellationId) ?? null;
  const selectedAdminEditAppointment =
    adminAppointments.find((appointment) => appointment.id === adminEditAppointmentId) ?? null;
  const selectedAdminClient =
    adminClientProfiles.find((client) => client.id === selectedAdminClientId) ?? null;
  const manualBookingClient =
    clientDialog?.mode === "book"
      ? adminClientProfiles.find((client) => client.id === clientDialog.clientId) ?? null
      : null;
  const manualBookingService =
    services.find((service) => service.id === manualBookingDraft.serviceId) ?? services[0];
  const manualBookingHasConflict = Boolean(
    manualBookingService &&
      adminAppointments.some(
        (appointment) =>
          appointment.dateKey === manualBookingDraft.dateKey &&
          rangesOverlap(
            timeToMinutes(manualBookingDraft.startTime),
            manualBookingService.durationMinutes,
            timeToMinutes(appointment.startTime),
            appointment.durationMinutes,
          ),
      ),
  );
  const clientDraftIsValid = Boolean(
    clientDraft.firstName.trim() &&
      clientDraft.lastName.trim() &&
      getPhoneDigits(clientDraft.phone).length === 9 &&
      isValidEmail(clientDraft.email),
  );
  const smsClient =
    adminClientProfiles.find((client) => client.id === smsComposer?.clientId) ?? null;
  const smsAppointment =
    smsClient?.appointments.find((appointment) => appointment.id === smsComposer?.appointmentId) ??
    null;
  const editingService = services.find((service) => service.id === editingServiceId) ?? null;
  const hasSelectedDay = selectedKey === selectedDayKey && availableTimes.length > 0;
  const canContinue = Boolean(selectedServiceId && hasSelectedDay && selectedTime);
  const canConfirm =
    Boolean(activeUser) && form.fullName.trim().length >= 3 && getPhoneDigits(form.phone).length === 9;
  const canSaveService =
    serviceDraft.name.trim().length >= 2 &&
    Number.isFinite(getServicePriceValue(serviceDraft.price)) &&
    getServicePriceValue(serviceDraft.price) > 0 &&
    Number(serviceDraft.durationMinutes) >= 15;
  const availabilityWindows = useMemo(
    () =>
      Object.values(workSettings.availability)
        .filter((windowItem) => windowItem.dateKey >= dayKey(today))
        .sort((first, second) => {
          if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
          return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        }),
    [today, workSettings.availability],
  );
  const availabilityDraftKeys = useMemo(
    () => getDateKeysInRange(availabilityDraft.start, availabilityDraft.end),
    [availabilityDraft.end, availabilityDraft.start],
  );
  const availabilityDraftDuration =
    timeToMinutes(availabilityDraft.endTime) - timeToMinutes(availabilityDraft.startTime);
  const availabilityOverwriteCount = availabilityDraftKeys.filter(
    (key) => Boolean(workSettings.availability[key]) && key !== editingAvailabilityKey,
  ).length;
  const canSaveAvailability =
    availabilityDraft.start >= dayKey(today) &&
    availabilityDraft.end >= availabilityDraft.start &&
    availabilityDraftDuration >= 15;
  const availabilityMonthGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; items: AvailabilityWindow[]; totalMinutes: number }
    >();

    availabilityWindows.forEach((windowItem) => {
      const monthKey = windowItem.dateKey.slice(0, 7);
      const monthDate = dateFromKey(`${monthKey}-01`);
      const existingGroup =
        groups.get(monthKey) ??
        ({
          key: monthKey,
          label: monthFormatter.format(monthDate),
          items: [],
          totalMinutes: 0,
        } satisfies {
          key: string;
          label: string;
          items: AvailabilityWindow[];
          totalMinutes: number;
        });

      existingGroup.items.push(windowItem);
      existingGroup.totalMinutes +=
        timeToMinutes(windowItem.endTime) - timeToMinutes(windowItem.startTime);
      groups.set(monthKey, existingGroup);
    });

    return Array.from(groups.values());
  }, [availabilityWindows]);
  const nearestAvailability = availabilityWindows[0] ?? null;
  const nextSaturdayOffset = (6 - today.getDay() + 7) % 7 || 7;
  const quickAvailabilityOptions = [
    { label: "Jutro", offset: 1, startTime: "17:00", endTime: "20:00" },
    { label: "Za 2 dni", offset: 2, startTime: "10:00", endTime: "13:00" },
    {
      label: "Weekend",
      offset: nextSaturdayOffset,
      startTime: "09:00",
      endTime: "14:00",
    },
  ].map((option) => {
    const date = new Date(today);
    date.setDate(today.getDate() + option.offset);
    return { ...option, date, dateKey: dayKey(date) };
  });
  const visibleStep = step === "admin" && !isAdmin ? "booking" : step;
  const currentTimeLineMinutes =
    adminSelectedKey === dayKey(currentDate)
      ? currentDate.getHours() * 60 + currentDate.getMinutes()
      : null;
  const currentTimeLineVisible =
    currentTimeLineMinutes !== null &&
    currentTimeLineMinutes >= adminScheduleStartMinutes &&
    currentTimeLineMinutes <= adminScheduleEndMinutes;
  const currentTimeLineTop =
    currentTimeLineMinutes !== null
      ? ((currentTimeLineMinutes - adminScheduleStartMinutes) / 15) * 2.8
      : 0;

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentDate(new Date()), 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const touchQuery = window.matchMedia("(pointer: coarse)");
    const updateTouchMode = () => setIsTouchDevice(touchQuery.matches);

    updateTouchMode();
    touchQuery.addEventListener("change", updateTouchMode);

    return () => touchQuery.removeEventListener("change", updateTouchMode);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (availabilityMonthGroups.length === 0) {
      if (expandedAvailabilityMonth !== undefined) {
        setExpandedAvailabilityMonth(undefined);
      }
      return;
    }

    if (expandedAvailabilityMonth === undefined) {
      setExpandedAvailabilityMonth(availabilityMonthGroups[0].key);
      return;
    }

    if (
      expandedAvailabilityMonth &&
      !availabilityMonthGroups.some((group) => group.key === expandedAvailabilityMonth)
    ) {
      setExpandedAvailabilityMonth(availabilityMonthGroups[0].key);
    }
  }, [availabilityMonthGroups, expandedAvailabilityMonth]);

  useEffect(() => {
    const firebaseAuth = getAuth(firebaseApp);

    return onAuthStateChanged(firebaseAuth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);

      if (user?.displayName) {
        setForm((current) => ({
          ...current,
          fullName: current.fullName || user.displayName || "",
        }));
      }
    });
  }, []);

  useEffect(() => {
    previousAppointmentsRef.current = null;
    setSelectedBarberId(null);
    setNotificationPanelOpen(false);
    setActiveNotification(null);
    setNotifications(activeUser ? readStoredNotifications(activeUser.uid) : []);
  }, [activeUser, today]);

  useEffect(() => {
    if (!activeUser) {
      setAppointments([]);
      setAllAdminAppointments([]);
      return undefined;
    }

    const appointmentsRef = ref(realtimeDb, "appointments");

    return onValue(appointmentsRef, (snapshot) => {
      const value = snapshot.val() as Record<string, Partial<AdminAppointment>> | null;
      const migrationUpdates: Record<string, unknown> = {};
      const loadedAppointments = Object.entries(value ?? {})
        .map(([id, appointment]) => {
          const barberId = appointment.barberId || defaultBarberId;
          const settledAt =
            Number(appointment.settlement?.settledAt ?? appointment.settledAt) || undefined;
          const rawSettledAmount = appointment.settlement?.amount ?? appointment.settledAmount;
          const settledAmount = Number.isFinite(Number(rawSettledAmount))
            ? Number(rawSettledAmount)
            : undefined;

          if (!appointment.barberId) {
            migrationUpdates[`appointments/${id}/barberId`] = barberId;
          }
          if (
            settledAt !== undefined &&
            settledAmount !== undefined &&
            !appointment.settlement?.barberId
          ) {
            migrationUpdates[`appointments/${id}/settlement`] = {
              barberId,
              settledAt,
              amount: settledAmount,
            };
          }

          return {
            id: appointment.id ?? id,
            barberId,
            dateKey: appointment.dateKey ?? dayKey(today),
            startTime: appointment.startTime ?? "00:00",
            durationMinutes: Number(appointment.durationMinutes) || 30,
            clientId: appointment.clientId ?? "",
            clientName: appointment.clientName ?? "Klient",
            clientEmail: appointment.clientEmail ?? "",
            clientPhotoUrl: appointment.clientPhotoUrl ?? "",
            phone: appointment.phone ?? "",
            userId: appointment.userId ?? "",
            serviceName: appointment.serviceName ?? "Usługa",
            price: appointment.price ?? "0 zł",
            color: normalizeAppointmentColor(appointment.color),
            status: normalizeAppointmentStatus(appointment.status),
            settledAt,
            settledAmount,
            settlement:
              settledAt !== undefined && settledAmount !== undefined
                ? {
                    barberId: appointment.settlement?.barberId || barberId,
                    settledAt,
                    amount: settledAmount,
                  }
                : undefined,
          };
        })
        .filter((appointment) => appointment.status !== "cancelled")
        .sort((first, second) => {
          if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
          return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        });

      setAllAdminAppointments(loadedAppointments);
      setAppointments(
        loadedAppointments
          .filter((appointment) => appointment.barberId === defaultBarberId)
          .map(({ id, barberId, dateKey, startTime, durationMinutes }) => ({
            id,
            barberId,
            dateKey,
            startTime,
            durationMinutes,
          })),
      );
      if (shouldRunDataMigration && isAdmin && Object.keys(migrationUpdates).length > 0) {
        void update(ref(realtimeDb), migrationUpdates);
      }
    });
  }, [activeUser, isAdmin, today]);

  useEffect(() => {
    if (!isAdmin) {
      setClientRecords([]);
      return undefined;
    }

    const clientsRef = ref(realtimeDb, "clients");

    return onValue(clientsRef, (snapshot) => {
      const value = snapshot.val() as Record<string, Partial<ClientRecord>> | null;
      const loadedClients = Object.entries(value ?? {}).map(([id, client]) => ({
        id,
        firstName: client.firstName?.trim() ?? "",
        lastName: client.lastName?.trim() ?? "",
        email: client.email?.trim() ?? "",
        phone: client.phone?.trim() ?? "",
        photoUrl: client.photoUrl?.trim() ?? "",
        userId: client.userId?.trim() || undefined,
        barberIds:
          client.barberIds && typeof client.barberIds === "object"
            ? client.barberIds
            : undefined,
        createdAt: Number(client.createdAt) || undefined,
        updatedAt: Number(client.updatedAt) || undefined,
      }));

      setClientRecords(loadedClients);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setBarberProfiles({});
      return undefined;
    }

    setBarberProfiles({});
    const visibleProfiles = isOwner
      ? defaultBarbers
      : defaultBarbers.filter((barber) => barber.id === signedInBarberId);
    const unsubscribeProfiles = visibleProfiles.map((barber) =>
      onValue(ref(realtimeDb, `barbers/${barber.id}/profile`), (snapshot) => {
        setBarberProfiles((current) => ({
          ...current,
          [barber.id]: normalizeBarberDetails(
            snapshot.val() as Partial<BarberDetails> | null,
          ),
        }));
      }),
    );

    return () => unsubscribeProfiles.forEach((unsubscribe) => unsubscribe());
  }, [isAdmin, isOwner, signedInBarberId]);

  useEffect(() => {
    const defaultProfile = defaultBarbers.find((barber) => barber.id === activeBarberId);
    setProfileDraft({
      ...activeBarberProfile,
      displayName: activeBarberProfile.displayName || defaultProfile?.name || "",
      photoUrl: activeBarberProfile.photoUrl,
    });
    setProfileFeedback(null);
  }, [activeBarberId, activeBarberProfile]);

  useEffect(() => {
    if (!activeUser) return;

    const previousAppointments = previousAppointmentsRef.current;
    const currentAppointments = new Map(
      notificationAppointments.map((appointment) => [appointment.id, appointment]),
    );

    if (!previousAppointments) {
      previousAppointmentsRef.current = currentAppointments;
      return;
    }

    const nextNotifications: AppNotification[] = [];
    const createNotification = (
      appointment: AdminAppointment,
      event: "new" | "rescheduled" | "cancelled",
    ): AppNotification | null => {
      const isClientAppointment = appointment.userId === activeUser.uid;

      if (!isAdmin && !isClientAppointment) return null;

      const audience = isAdmin ? "admin" : "client";
      const eventId = `${audience}-${event}-${appointment.id}-${appointment.dateKey}-${appointment.startTime}`;
      const serviceLine = `${appointment.serviceName}, ${appointment.dateKey}, ${appointment.startTime}`;

      if (event === "new") {
        return {
          id: eventId,
          appointmentId: appointment.id,
          createdAt: Date.now(),
          title: isAdmin ? "Nowa wizyta" : "Wizyta potwierdzona",
          body: isAdmin ? `${appointment.clientName}: ${serviceLine}` : serviceLine,
        };
      }

      if (event === "rescheduled") {
        return {
          id: eventId,
          appointmentId: appointment.id,
          createdAt: Date.now(),
          title: "Wizyta przesunieta",
          body: isAdmin ? `${appointment.clientName}: ${serviceLine}` : `Nowy termin: ${serviceLine}`,
        };
      }

      return {
        id: eventId,
        appointmentId: appointment.id,
        createdAt: Date.now(),
        title: "Wizyta odwolana",
        body: isAdmin ? `${appointment.clientName}: ${serviceLine}` : serviceLine,
      };
    };

    for (const appointment of currentAppointments.values()) {
      const previousAppointment = previousAppointments.get(appointment.id);
      const currentStatus = normalizeAppointmentStatus(appointment.status);
      const previousStatus = previousAppointment
        ? normalizeAppointmentStatus(previousAppointment.status)
        : null;

      if (!previousAppointment) {
        const notification = createNotification(appointment, "new");
        if (notification) nextNotifications.push(notification);
        continue;
      }

      if (
        currentStatus === "rescheduled" &&
        (previousStatus !== "rescheduled" ||
          previousAppointment.dateKey !== appointment.dateKey ||
          previousAppointment.startTime !== appointment.startTime)
      ) {
        const notification = createNotification(appointment, "rescheduled");
        if (notification) nextNotifications.push(notification);
      }
    }

    for (const previousAppointment of previousAppointments.values()) {
      if (!currentAppointments.has(previousAppointment.id)) {
        const notification = createNotification(previousAppointment, "cancelled");
        if (notification) nextNotifications.push(notification);
      }
    }

    if (nextNotifications.length > 0) {
      const existingIds = new Set(notifications.map((notification) => notification.id));
      const uniqueNotifications = nextNotifications.filter(
        (notification) => !existingIds.has(notification.id),
      );

      if (uniqueNotifications.length > 0) {
        const updatedNotifications = [...uniqueNotifications, ...notifications].slice(
          0,
          maxStoredNotifications,
        );

        writeStoredNotifications(activeUser.uid, updatedNotifications);
        setNotifications(updatedNotifications);
        setActiveNotification(uniqueNotifications[0]);
      }
    }

    previousAppointmentsRef.current = currentAppointments;
  }, [activeUser, isAdmin, notificationAppointments, notifications]);

  useEffect(() => {
    if (!activeNotification) return undefined;

    const timer = window.setTimeout(() => setActiveNotification(null), 5200);
    return () => window.clearTimeout(timer);
  }, [activeNotification]);

  useEffect(() => {
    if (!activeUser) {
      setLegacyWorkSettings(defaultWorkSettings);
      return undefined;
    }

    const workSettingsRef = ref(realtimeDb, "workSettings");

    return onValue(workSettingsRef, (snapshot) => {
      const value = snapshot.val() as Partial<WorkSettings> | null;
      setLegacyWorkSettings(normalizeWorkSettings(value, defaultBarberId));
      if (shouldRunDataMigration && isAdmin && value?.availability) {
        const missingBarberIds = Object.fromEntries(
          Object.entries(value.availability)
            .filter(([, windowItem]) => !windowItem.barberId)
            .map(([key]) => [`availability/${key}/barberId`, defaultBarberId]),
        );
        if (Object.keys(missingBarberIds).length > 0) {
          void update(workSettingsRef, missingBarberIds);
        }
      }
    });
  }, [activeUser, isAdmin]);

  useEffect(() => {
    if (!activeUser) {
      setBarberWorkSettings(null);
      return undefined;
    }

    const barberWorkSettingsRef = ref(realtimeDb, `barbers/${activeBarberId}/workSettings`);
    return onValue(barberWorkSettingsRef, (snapshot) => {
      const value = snapshot.val() as Partial<WorkSettings> | null;
      setBarberWorkSettings(
        snapshot.exists()
          ? normalizeWorkSettings(value, activeBarberId)
          : null,
      );
      if (shouldRunDataMigration && isAdmin && value?.availability) {
        const missingBarberIds = Object.fromEntries(
          Object.entries(value.availability)
            .filter(([, windowItem]) => !windowItem.barberId)
            .map(([key]) => [`availability/${key}/barberId`, activeBarberId]),
        );
        if (Object.keys(missingBarberIds).length > 0) {
          void update(barberWorkSettingsRef, missingBarberIds);
        }
      }
    });
  }, [activeBarberId, activeUser, isAdmin]);

  useEffect(() => {
    if (!activeUser) {
      setLegacyServices(defaultServices);
      return undefined;
    }

    const servicesRef = ref(realtimeDb, "services");

    return onValue(servicesRef, (snapshot) => {
      const value = snapshot.val() as Record<string, Partial<Service>> | null;
      setLegacyServices(normalizeServices(value, defaultBarberId));

      if (!value && isAdmin) {
        void set(servicesRef, servicesToRecord(defaultServices, defaultBarberId));
      } else if (value && shouldRunDataMigration && isAdmin) {
        const missingBarberIds = Object.fromEntries(
          Object.entries(value)
            .filter(([, service]) => !service.barberId)
            .map(([id]) => [`${id}/barberId`, defaultBarberId]),
        );
        if (Object.keys(missingBarberIds).length > 0) {
          void update(servicesRef, missingBarberIds);
        }
      }
    });
  }, [activeUser, isAdmin]);

  useEffect(() => {
    if (!activeUser) {
      setBarberServices(null);
      return undefined;
    }

    const barberServicesRef = ref(realtimeDb, `barbers/${activeBarberId}/services`);
    return onValue(barberServicesRef, (snapshot) => {
      const value = snapshot.val() as Record<string, Partial<Service>> | null;
      setBarberServices(snapshot.exists() ? normalizeServices(value, activeBarberId) : null);
      if (value && shouldRunDataMigration && isAdmin) {
        const missingBarberIds = Object.fromEntries(
          Object.entries(value)
            .filter(([, service]) => !service.barberId)
            .map(([id]) => [`${id}/barberId`, activeBarberId]),
        );
        if (Object.keys(missingBarberIds).length > 0) {
          void update(barberServicesRef, missingBarberIds);
        }
      }
    });
  }, [activeBarberId, activeUser, isAdmin]);

  useEffect(() => {
    if (selectedTime && !availableTimes.includes(selectedTime)) {
      setSelectedTime("");
    }
  }, [availableTimes, selectedTime]);

  useEffect(() => {
    const currentSelection = days.find((day) => dayKey(day.date) === selectedKey);
    if (currentSelection?.freeSlots) return;

    const firstAvailableDay =
      days.find((day) => day.monthOffset === 0 && day.freeSlots > 0) ??
      days.find((day) => day.freeSlots > 0);
    if (firstAvailableDay) setSelectedKey(dayKey(firstAvailableDay.date));
  }, [days, selectedKey]);

  useEffect(() => {
    if (!services.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(services[0]?.id ?? defaultServices[0].id);
      setSelectedTime("");
    }

    if (!services.some((service) => service.id === manualBookingDraft.serviceId)) {
      setManualBookingDraft((current) => ({
        ...current,
        serviceId: services[0]?.id ?? defaultServices[0].id,
      }));
    }
  }, [manualBookingDraft.serviceId, selectedServiceId, services]);

  useEffect(() => {
    if (step === "admin" && !isAdmin) {
      setStep("booking");
    }
  }, [isAdmin, step]);

  useEffect(() => {
    if (visibleStep !== "success") return undefined;
    setSuccessReady(false);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setSuccessReady(true), prefersReducedMotion ? 80 : 900);
    return () => window.clearTimeout(timer);
  }, [visibleStep]);

  useEffect(() => {
    if (visibleStep === "admin" || visibleStep === "booking") return;
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, [visibleStep]);

  useEffect(() => {
    const clientModalOpen = Boolean(
      clientAppointmentsListOpen ||
        (selectedClientAppointment && visibleStep !== "admin") ||
        pendingClientCancellation ||
        selectedAdminEditAppointment ||
        selectedAdminClient ||
        clientDialog ||
        smsComposer ||
        notificationPanelOpen,
    );
    if (!clientModalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeTopOverlay = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (notificationPanelOpen) {
        setNotificationPanelOpen(false);
      } else if (pendingClientCancellation) {
        setPendingClientCancellationId(null);
      } else if (smsComposer) {
        setSmsComposer(null);
      } else if (selectedAdminEditAppointment) {
        setAdminEditAppointmentId(null);
      } else if (clientDialog) {
        setClientDialog(null);
      } else if (selectedAdminClient) {
        setSelectedAdminClientId(null);
      } else if (selectedClientAppointment) {
        setClientAppointmentId(null);
      } else {
        setClientAppointmentsListOpen(false);
      }
    };

    window.addEventListener("keydown", closeTopOverlay);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeTopOverlay);
    };
  }, [
    clientAppointmentsListOpen,
    clientDialog,
    notificationPanelOpen,
    pendingClientCancellation,
    selectedAdminClient,
    selectedAdminEditAppointment,
    selectedClientAppointment,
    smsComposer,
    visibleStep,
  ]);

  useEffect(() => {
    if (visibleStep !== "booking") {
      setHeroScrollProgress(0);
      return undefined;
    }

    let frame = 0;
    const updateHeroProgress = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const heroHeight = Math.max(1, window.innerWidth * 0.5625);
        const progress = Math.min(1, Math.max(0, window.scrollY / (heroHeight * 0.62)));
        setHeroScrollProgress(Number(progress.toFixed(3)));
      });
    };

    updateHeroProgress();
    window.addEventListener("scroll", updateHeroProgress, { passive: true });
    window.addEventListener("resize", updateHeroProgress);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateHeroProgress);
      window.removeEventListener("resize", updateHeroProgress);
    };
  }, [visibleStep]);

  useEffect(() => {
    if (visibleStep !== "admin") return;
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }, [adminSection, visibleStep]);

  const shiftMonth = (direction: -1 | 1) => {
    if (direction === -1 && !canShiftToPreviousMonth) return;
    setSelectedTime("");
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  };

  const scrollToBookingSection = (target: HTMLElement | null) => {
    if (!target) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  };

  const beginCalendarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    calendarGestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events do not always expose an active pointer to capture.
    }
  };

  const endCalendarGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = calendarGestureRef.current;
    calendarGestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (Math.abs(deltaX) < 52 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

    calendarSwipeConsumedRef.current = true;
    shiftMonth(deltaX < 0 ? 1 : -1);
    window.setTimeout(() => {
      calendarSwipeConsumedRef.current = false;
    }, 0);
  };

  const beginSheetGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    sheetGestureRef.current = { pointerId: event.pointerId, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The gesture still works when pointer capture is unavailable.
    }
  };

  const endSheetGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    dismiss: () => void,
  ) => {
    const gesture = sheetGestureRef.current;
    sheetGestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.clientY - gesture.y >= 72) dismiss();
  };

  const selectNearestFreeSlot = () => {
    if (!nearestFreeSlot) return;

    setVisibleMonth(
      new Date(nearestFreeSlot.date.getFullYear(), nearestFreeSlot.date.getMonth(), 1),
    );
    setSelectedKey(nearestFreeSlot.dateKey);
    setSelectedTime(nearestFreeSlot.time);
    window.requestAnimationFrame(() => scrollToBookingSection(bookingTimeRef.current));
  };

  const updateForm = (field: keyof FormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: field === "phone" ? formatPhoneNumber(value) : value,
    }));
  };

  const updateAvailabilityDraft = (
    field: keyof typeof availabilityDraft,
    value: string,
  ) => {
    setWorkFeedback(null);
    setPendingAvailabilityRemovalKey(null);
    setAvailabilityDraft((current) => {
      const nextDraft = { ...current, [field]: value };

      if (field === "start" && nextDraft.end < value) {
        nextDraft.end = value;
      }

      if (timeToMinutes(nextDraft.startTime) >= timeToMinutes(nextDraft.endTime)) {
        nextDraft.endTime = minutesToTime(
          Math.min(timeToMinutes(nextDraft.startTime) + 15, timeToMinutes("22:00")),
        );
      }

      return nextDraft;
    });
  };

  const resetAvailabilityEditor = () => {
    setEditingAvailabilityKey(null);
    setPendingAvailabilityRemovalKey(null);
    setAvailabilityDraft({
      start: dayKey(today),
      end: dayKey(today),
      startTime: "10:00",
      endTime: "13:00",
    });
  };

  const addAvailabilityRange = async () => {
    if (!canSaveAvailability || isWorkSaving) return;

    const availabilityUpdates = Object.fromEntries(
      availabilityDraftKeys.map((key) => [
        key,
        {
          id: key,
          barberId: activeBarberId,
          dateKey: key,
          startTime: availabilityDraft.startTime,
          endTime: availabilityDraft.endTime,
        },
      ]),
    );

    try {
      setIsWorkSaving(true);
      setWorkFeedback(null);
      const nextAvailability = {
        ...workSettings.availability,
        ...availabilityUpdates,
      };
      if (editingAvailabilityKey && !availabilityDraftKeys.includes(editingAvailabilityKey)) {
        delete nextAvailability[editingAvailabilityKey];
      }
      await set(
        ref(realtimeDb, `barbers/${activeBarberId}/workSettings/availability`),
        nextAvailability,
      );
      setWorkFeedback({
        kind: "success",
        message:
          availabilityDraftKeys.length === 1
            ? "Dostępność została zapisana."
            : `Zapisano ${availabilityDraftKeys.length} dni dostępności.`,
      });
      setEditingAvailabilityKey(null);
    } catch {
      setWorkFeedback({ kind: "error", message: "Nie udało się zapisać dostępności." });
    } finally {
      setIsWorkSaving(false);
    }
  };

  const beginAvailabilityEdit = (windowItem: AvailabilityWindow) => {
    setEditingAvailabilityKey(windowItem.dateKey);
    setPendingAvailabilityRemovalKey(null);
    setWorkFeedback(null);
    setAvailabilityDraft({
      start: windowItem.dateKey,
      end: windowItem.dateKey,
      startTime: windowItem.startTime,
      endTime: windowItem.endTime,
    });
    window.requestAnimationFrame(() => {
      document
        .getElementById("availability-maker")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const removeAvailabilityDate = async (dateKeyValue: string) => {
    if (pendingAvailabilityRemovalKey !== dateKeyValue) {
      setPendingAvailabilityRemovalKey(dateKeyValue);
      setWorkFeedback(null);
      return;
    }

    try {
      setIsWorkSaving(true);
      const nextAvailability = { ...workSettings.availability };
      delete nextAvailability[dateKeyValue];
      await set(
        ref(realtimeDb, `barbers/${activeBarberId}/workSettings/availability`),
        nextAvailability,
      );
      if (editingAvailabilityKey === dateKeyValue) resetAvailabilityEditor();
      setPendingAvailabilityRemovalKey(null);
      setWorkFeedback({ kind: "success", message: "Dzień został usunięty z dostępności." });
    } catch {
      setWorkFeedback({ kind: "error", message: "Nie udało się usunąć tego dnia." });
    } finally {
      setIsWorkSaving(false);
    }
  };

  const quickAddAvailability = async (offset: number, startTime: string, endTime: string) => {
    if (isWorkSaving) return;
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const key = dayKey(date);

    try {
      setIsWorkSaving(true);
      setWorkFeedback(null);
      await set(ref(realtimeDb, `barbers/${activeBarberId}/workSettings/availability`), {
        ...workSettings.availability,
        [key]: {
          id: key,
          barberId: activeBarberId,
          dateKey: key,
          startTime,
          endTime,
        },
      });
      setExpandedAvailabilityMonth(key.slice(0, 7));
      setWorkFeedback({
        kind: "success",
        message: `Dodano ${adminClientDateFormatter.format(date)}, ${startTime}-${endTime}.`,
      });
    } catch {
      setWorkFeedback({ kind: "error", message: "Nie udało się dodać szybkiego terminu." });
    } finally {
      setIsWorkSaving(false);
    }
  };

  const shiftAdminSelectedDay = (offset: -1 | 1) => {
    const nextDate = dateFromKey(adminSelectedKey);
    nextDate.setDate(nextDate.getDate() + offset);
    setAdminSelectedKey(dayKey(nextDate));
  };

  const openSelectedDayInWorkEditor = () => {
    setAvailabilityDraft((current) => ({
      ...current,
      start: adminSelectedKey,
      end: adminSelectedKey,
    }));
    setEditingAvailabilityKey(null);
    setWorkFeedback(null);
    setAdminSection("work");
  };

  const updateServiceDraft = (field: keyof ServiceDraft, value: string) => {
    setServiceDraft((current) => ({
      ...current,
      [field]: field === "durationMinutes" ? value.replace(/\D/g, "").slice(0, 3) : value,
    }));
  };

  const resetServiceDraft = () => {
    setEditingServiceId(null);
    setServiceDraft({
      name: "",
      price: "",
      durationMinutes: "60",
    });
  };

  const editService = (service: Service) => {
    setEditingServiceId(service.id);
    setServiceDraft({
      name: service.name,
      price: String(getServicePriceValue(service.price) || ""),
      durationMinutes: String(service.durationMinutes),
    });
    setAdminSection("services");
  };

  const saveService = async () => {
    if (!canSaveService || isSaving) return;

    const durationMinutes = Math.max(15, Math.round(Number(serviceDraft.durationMinutes) / 15) * 15);
    const serviceId = editingServiceId ?? createServiceId(serviceDraft.name);
    const nextService: Service = {
      id: serviceId,
      barberId: activeBarberId,
      name: serviceDraft.name.trim(),
      price: formatServicePrice(serviceDraft.price),
      durationMinutes,
      order: editingService?.order ?? services.length,
    };
    const nextServices = editingServiceId
      ? services.map((service) => (service.id === editingServiceId ? nextService : service))
      : [...services, nextService];

    try {
      setIsSaving(true);
      await set(
        ref(realtimeDb, `barbers/${activeBarberId}/services`),
        servicesToRecord(nextServices, activeBarberId),
      );
      if (!editingServiceId) {
        setSelectedServiceId(serviceId);
      }
      resetServiceDraft();
    } finally {
      setIsSaving(false);
    }
  };

  const deleteService = async (serviceId: string) => {
    if (services.length <= 1 || isSaving) return;

    const service = services.find((item) => item.id === serviceId);
    if (!window.confirm(`Usunąć usługę ${service?.name ?? ""}?`)) return;

    const nextServices = services.filter((service) => service.id !== serviceId);

    try {
      setIsSaving(true);
      await set(
        ref(realtimeDb, `barbers/${activeBarberId}/services`),
        servicesToRecord(nextServices, activeBarberId),
      );
      if (selectedServiceId === serviceId) {
        setSelectedServiceId(nextServices[0]?.id ?? defaultServices[0].id);
        setSelectedTime("");
      }
      if (editingServiceId === serviceId) {
        resetServiceDraft();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleProfilePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setIsProfilePhotoProcessing(true);
      setProfileFeedback(null);
      const photoUrl = await resizeProfilePhoto(file);
      setProfileDraft((current) => ({ ...current, photoUrl }));
    } catch (error) {
      setProfileFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Nie udało się przygotować zdjęcia.",
      });
    } finally {
      setIsProfilePhotoProcessing(false);
    }
  };

  const saveBarberProfile = async () => {
    const profile = normalizeBarberDetails({
      ...profileDraft,
      displayName:
        profileDraft.displayName ||
        defaultBarbers.find((barber) => barber.id === activeBarberId)?.name ||
        "Barber",
      phone: formatPhoneNumber(getPhoneDigits(profileDraft.phone)),
      email: profileDraft.email.toLocaleLowerCase("pl"),
      instagram: profileDraft.instagram.replace(/^@+/, ""),
      updatedAt: Date.now(),
    });

    try {
      setIsProfileSaving(true);
      setProfileFeedback(null);
      await set(ref(realtimeDb, `barbers/${activeBarberId}/profile`), profile);
      setProfileFeedback({ kind: "success", message: "Profil został zapisany." });
    } catch {
      setProfileFeedback({ kind: "error", message: "Nie udało się zapisać profilu." });
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setIsSigningIn(true);

    try {
      const firebaseAuth = getAuth(firebaseApp);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      if (errorCode !== "auth/popup-closed-by-user") {
        setAuthError("Nie udało się zalogować. Spróbuj ponownie.");
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setAuthError("");
    if (currentUser) {
      await signOut(getAuth(firebaseApp));
    }
    setStep("booking");
    setSelectedTime("");
    setBookingSummary(null);
    setClientAppointmentId(null);
    setClientAppointmentsListOpen(false);
    setPendingClientCancellationId(null);
    setReschedulingAppointmentId(null);
  };

  const getServiceForAppointment = (appointment: AdminAppointment) =>
    services.find((service) => service.name === appointment.serviceName) ??
    services.find((service) => service.durationMinutes === appointment.durationMinutes) ??
    services[0];

  const beginClientReschedule = (appointment: AdminAppointment) => {
    const service = getServiceForAppointment(appointment);
    const appointmentDate = dateFromKey(appointment.dateKey);

    setSelectedServiceId(service.id);
    setVisibleMonth(new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), 1));
    setSelectedKey(appointment.dateKey);
    setSelectedTime(appointment.startTime);
    setClientAppointmentId(null);
    setClientAppointmentsListOpen(false);
    setReschedulingAppointmentId(appointment.id);
    setStep("booking");
    window.requestAnimationFrame(() => scrollToBookingSection(bookingCalendarRef.current));
  };

  const cancelClientAppointment = (appointmentId: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);

    setPendingClientCancellationId(null);
    setClientAppointmentId(null);
    setClientAppointmentsListOpen(false);
    if (reschedulingAppointmentId === appointmentId) {
      setReschedulingAppointmentId(null);
      setSelectedTime("");
    }

    void remove(ref(realtimeDb, `appointments/${appointmentId}`)).then(() => {
      if (appointment) {
        void sendAppointmentNotification("client_cancelled", appointment);
      }
    });
  };

  const confirmClientRescheduledAppointment = async (appointmentId: string) => {
    if (isSaving) return;
    const appointment = allAdminAppointments.find((item) => item.id === appointmentId);

    try {
      setIsSaving(true);
      await update(ref(realtimeDb, `appointments/${appointmentId}`), {
        barberId: appointment?.barberId ?? defaultBarberId,
        status: "confirmed",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveClientReschedule = async () => {
    if (!reschedulingAppointment || !selectedTime || isSaving) return;

    try {
      setIsSaving(true);
      await update(ref(realtimeDb, `appointments/${reschedulingAppointment.id}`), {
        barberId: reschedulingAppointment.barberId,
        dateKey: selectedDayKey,
        startTime: selectedTime,
        status: "rescheduled",
      });
      await sendAppointmentNotification("client_rescheduled", {
        ...reschedulingAppointment,
        dateKey: selectedDayKey,
        startTime: selectedTime,
      });
      setReschedulingAppointmentId(null);
      setSelectedTime("");
    } finally {
      setIsSaving(false);
    }
  };

  const canMoveAdminAppointment = (
    appointment: AdminAppointment,
    startTime: string,
    targetDateKey = adminSelectedKey,
  ) => {
    const targetAvailability = getAvailabilityForDate(targetDateKey, workSettings);
    const startMinutes = timeToMinutes(startTime);
    if (
      !targetAvailability ||
      startMinutes < timeToMinutes(targetAvailability.startTime) ||
      startMinutes + appointment.durationMinutes > timeToMinutes(targetAvailability.endTime)
    ) {
      return false;
    }

    return !adminAppointments.some(
      (otherAppointment) =>
        otherAppointment.id !== appointment.id &&
        otherAppointment.dateKey === targetDateKey &&
        rangesOverlap(
          startMinutes,
          appointment.durationMinutes,
          timeToMinutes(otherAppointment.startTime),
          otherAppointment.durationMinutes,
        ),
    );
  };

  const confirmBooking = async () => {
    if (!canConfirm || !selectedTime || isSaving || !activeUser) return;

    const appointmentId = window.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const clientId = activeUser.uid;
    const appointmentColor = getNextAppointmentColor(selectedDayKey, adminAppointments);
    const adminAppointment: AdminAppointment = {
      id: appointmentId,
      barberId: defaultBarberId,
      clientId,
      userId: activeUser.uid,
      dateKey: selectedDayKey,
      startTime: selectedTime,
      durationMinutes: selectedService.durationMinutes,
      clientName: form.fullName.trim(),
      clientEmail: activeUser.email ?? "",
      clientPhotoUrl: activeUser.photoURL ?? "",
      phone: form.phone,
      serviceName: selectedService.name,
      price: selectedService.price,
      color: appointmentColor,
      status: "confirmed",
    };

    setBookingSummary({
      serviceName: selectedService.name,
      servicePrice: selectedService.price,
      durationMinutes: selectedService.durationMinutes,
      date: selectedDay.date,
      time: selectedTime,
      fullName: form.fullName.trim(),
      phone: form.phone,
    });
    try {
      setIsSaving(true);
      const name = splitClientName(form.fullName);
      const now = Date.now();
      await update(ref(realtimeDb), {
        [`appointments/${appointmentId}`]: adminAppointment,
        [`clients/${clientId}/id`]: clientId,
        [`clients/${clientId}/firstName`]: name.firstName,
        [`clients/${clientId}/lastName`]: name.lastName,
        [`clients/${clientId}/email`]: activeUser.email ?? "",
        [`clients/${clientId}/phone`]: form.phone,
        [`clients/${clientId}/photoUrl`]: activeUser.photoURL ?? "",
        [`clients/${clientId}/userId`]: activeUser.uid,
        [`clients/${clientId}/barberIds/${defaultBarberId}`]: true,
        [`clients/${clientId}/updatedAt`]: now,
      });
      await sendAppointmentNotification("new_booking", adminAppointment);
      setForm({ fullName: "", phone: "" });
      setStep("success");
    } finally {
      setIsSaving(false);
    }
  };

  const downloadCalendarFile = (calendarBlob: Blob, fileName: string) => {
    const calendarUrl = window.URL.createObjectURL(calendarBlob);
    const downloadLink = document.createElement("a");
    downloadLink.href = calendarUrl;
    downloadLink.download = fileName;
    downloadLink.rel = "noopener";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(calendarUrl), 1200);
  };

  const saveSummaryToCalendar = async (summary: BookingSummary) => {
    const calendarBlob = new Blob([buildCalendarEvent(summary)], {
      type: "text/calendar;charset=utf-8",
    });
    const fileName = getCalendarFileName(summary);
    const calendarFile = new File([calendarBlob], fileName, { type: "text/calendar" });
    const shareData = {
      title: "Wizyta BNB Barbershop",
      text: `${summary.serviceName}, ${dayFormatter.format(summary.date)}, ${summary.time}`,
      files: [calendarFile],
    };

    try {
      if (navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }

    downloadCalendarFile(calendarBlob, fileName);
  };

  const addBookingToCalendar = async () => {
    if (!bookingSummary) return;
    await saveSummaryToCalendar(bookingSummary);
  };

  const addAppointmentToCalendar = async (appointment: AdminAppointment) => {
    await saveSummaryToCalendar(appointmentToBookingSummary(appointment));
  };

  const openAdminAppointmentEdit = (appointment: AdminAppointment) => {
    setAdminEditAppointmentId(appointment.id);
    setAdminEditDraft({
      dateKey: appointment.dateKey,
      startTime: appointment.startTime,
    });
  };

  const saveAdminAppointmentEdit = async () => {
    if (!selectedAdminEditAppointment || isSaving) return;

    try {
      setIsSaving(true);
      await update(ref(realtimeDb, `appointments/${selectedAdminEditAppointment.id}`), {
        barberId: selectedAdminEditAppointment.barberId,
        dateKey: adminEditDraft.dateKey,
        startTime: adminEditDraft.startTime,
        status: "rescheduled",
      });
      await sendAppointmentNotification("admin_rescheduled", {
        ...selectedAdminEditAppointment,
        dateKey: adminEditDraft.dateKey,
        startTime: adminEditDraft.startTime,
      });
      setAdminSelectedKey(adminEditDraft.dateKey);
      setAdminEditAppointmentId(null);
    } finally {
      setIsSaving(false);
    }
  };

  const moveAdminAppointment = (appointmentId: string, startTime: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!appointment || !canMoveAdminAppointment(appointment, startTime)) {
      setDraggedAppointmentId(null);
      return;
    }

    void update(ref(realtimeDb, `appointments/${appointmentId}`), {
      barberId: appointment.barberId,
      dateKey: adminSelectedKey,
      startTime,
      status: "rescheduled",
    }).then(() => {
      void sendAppointmentNotification("admin_rescheduled", {
        ...appointment,
        dateKey: adminSelectedKey,
        startTime,
      });
    });
    setDraggedAppointmentId(null);
  };

  const shiftAdminAppointment = (appointmentId: string, minutes: -15 | 15) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!appointment) return;

    moveAdminAppointment(
      appointmentId,
      minutesToTime(timeToMinutes(appointment.startTime) + minutes),
    );
  };

  const declineAdminAppointment = (appointmentId: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!window.confirm(`Odmówić wizytę ${appointment?.clientName ?? "klienta"}?`)) return;

    void remove(ref(realtimeDb, `appointments/${appointmentId}`)).then(() => {
      if (appointment) {
        void sendAppointmentNotification("admin_cancelled", appointment);
      }
    });
  };

  const footerLabel =
    visibleStep === "booking"
      ? reschedulingAppointment
        ? isSaving
          ? "Zapisywanie..."
          : "Zapisz nowy termin"
        : selectedTime
          ? "Dalej: potwierdzenie"
          : "Wybierz godzinę"
      : visibleStep === "confirm"
        ? isSaving
          ? "Zapisywanie..."
          : "Potwierdź wizytę"
        : "Wróć do panelu";
  const footerDisabled =
    visibleStep === "booking"
      ? !canContinue || isSaving
      : visibleStep === "confirm"
        ? !canConfirm || isSaving
        : !successReady;
  const footerClassName = `bottom-action ${
    (visibleStep === "confirm" && canConfirm) ||
    (visibleStep === "booking" && reschedulingAppointment && canContinue)
      ? "ready"
      : ""
  }`;
  const heroStyle = {
    opacity: 1 - heroScrollProgress,
    transform: `translateY(${-18 * heroScrollProgress}px) scale(${1 - 0.035 * heroScrollProgress})`,
    filter: `saturate(${1 - 0.28 * heroScrollProgress}) brightness(${
      1 - 0.38 * heroScrollProgress
    })`,
  } as CSSProperties;
  const deleteNotification = (notificationId: string) => {
    if (!activeUser) return;

    setNotifications((current) => {
      const updatedNotifications = current.filter((notification) => notification.id !== notificationId);
      writeStoredNotifications(activeUser.uid, updatedNotifications);
      return updatedNotifications;
    });
    setActiveNotification((current) => (current?.id === notificationId ? null : current));
  };
  const openSmsComposer = (client: AdminClientProfile, appointment: AdminAppointment) => {
    if (getPhoneDigits(client.phone).length !== 9) return;

    setSmsComposer({
      clientId: client.id,
      appointmentId: appointment.id,
      template: "confirmation",
      message: buildClientSmsMessage("confirmation", appointment),
    });
  };

  const resetManualBookingDraft = () => {
    const todayKey = dayKey(today);
    setManualBookingDraft({
      serviceId: services[0]?.id ?? defaultServices[0].id,
      dateKey: adminSelectedKey >= todayKey ? adminSelectedKey : todayKey,
      startTime: "18:00",
    });
  };

  const openClientCreator = () => {
    setClientDraft({ firstName: "", lastName: "", email: "", phone: "" });
    setClientSaveMode("record");
    setClientFeedback(null);
    resetManualBookingDraft();
    setClientDialog({ mode: "create" });
  };

  const openManualClientBooking = (client: AdminClientProfile) => {
    setSelectedAdminClientId(null);
    setClientFeedback(null);
    resetManualBookingDraft();
    setClientDialog({ mode: "book", clientId: client.id });
  };

  const handleSaveClientFromDialog = async () => {
    if (!clientDialog || !isAdmin || isClientSaving) return;

    const isCreating = clientDialog.mode === "create";
    const shouldBook = clientDialog.mode === "book" || clientSaveMode === "booking";
    const phoneDigits = getPhoneDigits(isCreating ? clientDraft.phone : manualBookingClient?.phone ?? "");
    const email = (isCreating ? clientDraft.email : manualBookingClient?.email ?? "").trim().toLowerCase();
    const fullName = isCreating
      ? `${clientDraft.firstName.trim()} ${clientDraft.lastName.trim()}`.trim()
      : manualBookingClient?.name ?? "";

    if (isCreating && (!clientDraft.firstName.trim() || !clientDraft.lastName.trim())) {
      setClientFeedback({ kind: "error", message: "Uzupełnij imię i nazwisko klienta." });
      return;
    }
    if (isCreating && phoneDigits.length !== 9) {
      setClientFeedback({ kind: "error", message: "Podaj poprawny, 9-cyfrowy numer telefonu." });
      return;
    }
    if (!isValidEmail(email)) {
      setClientFeedback({ kind: "error", message: "Sprawdź poprawność adresu e-mail." });
      return;
    }
    if (shouldBook && (!manualBookingService || !manualBookingDraft.dateKey || !manualBookingDraft.startTime)) {
      setClientFeedback({ kind: "error", message: "Wybierz usługę, datę i godzinę wizyty." });
      return;
    }

    const hasConflict = shouldBook && manualBookingService
      ? adminAppointments.some(
          (appointment) =>
            appointment.dateKey === manualBookingDraft.dateKey &&
            rangesOverlap(
              timeToMinutes(manualBookingDraft.startTime),
              manualBookingService.durationMinutes,
              timeToMinutes(appointment.startTime),
              appointment.durationMinutes,
            ),
        )
      : false;

    if (hasConflict) {
      setClientFeedback({
        kind: "error",
        message: "Ten termin nakłada się na inną wizytę. Wybierz inną godzinę.",
      });
      return;
    }

    const matchingClient = isCreating
      ? adminClientProfiles.find((client) => {
          const samePhone = phoneDigits.length === 9 && getPhoneDigits(client.phone) === phoneDigits;
          const sameEmail = email && client.email.trim().toLowerCase() === email;
          return samePhone || sameEmail;
        }) ?? null
      : manualBookingClient;
    const hasStoredRecord = matchingClient
      ? clientRecords.some((record) => record.id === matchingClient.id)
      : false;
    const generatedClientId = createEntityId("client");
    const clientId = matchingClient
      ? hasStoredRecord || isFirebaseKeySafe(matchingClient.id)
        ? matchingClient.id
        : generatedClientId
      : generatedClientId;
    const linkedUserId =
      clientRecords.find((record) => record.id === matchingClient?.id)?.userId ||
      matchingClient?.appointments.find((appointment) => appointment.userId)?.userId ||
      undefined;
    const name = splitClientName(fullName);
    const now = getTimestamp();
    const updates: Record<string, unknown> = {};
    const existingRecord = clientRecords.find((record) => record.id === clientId);

    updates[`clients/${clientId}`] = {
      id: clientId,
      firstName: isCreating ? clientDraft.firstName.trim() : name.firstName,
      lastName: isCreating ? clientDraft.lastName.trim() : name.lastName,
      email,
      phone: phoneDigits,
      photoUrl: matchingClient?.photoUrl ?? "",
      ...(linkedUserId ? { userId: linkedUserId } : {}),
      barberIds: {
        ...(existingRecord?.barberIds ?? {}),
        [activeBarberId]: true,
      },
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now,
    } satisfies ClientRecord;

    if (matchingClient && matchingClient.id !== clientId) {
      matchingClient.appointments.forEach((appointment) => {
        updates[`appointments/${appointment.id}/clientId`] = clientId;
      });
    }

    let manualAppointment: AdminAppointment | null = null;
    if (shouldBook && manualBookingService) {
      const appointmentId = createEntityId("appointment");
      manualAppointment = {
        id: appointmentId,
        barberId: activeBarberId,
        clientId,
        ...(linkedUserId ? { userId: linkedUserId } : {}),
        dateKey: manualBookingDraft.dateKey,
        startTime: manualBookingDraft.startTime,
        durationMinutes: manualBookingService.durationMinutes,
        clientName: fullName,
        clientEmail: email,
        clientPhotoUrl: matchingClient?.photoUrl ?? "",
        phone: phoneDigits,
        serviceName: manualBookingService.name,
        price: manualBookingService.price,
        color: getNextAppointmentColor(manualBookingDraft.dateKey, adminAppointments),
        status: "confirmed",
      };
      updates[`appointments/${appointmentId}`] = manualAppointment;
    }

    try {
      setIsClientSaving(true);
      await update(ref(realtimeDb), updates);
      if (manualAppointment) {
        await sendAppointmentNotification("new_booking", manualAppointment);
        setAdminSelectedKey(manualAppointment.dateKey);
      }
      setClientDialog(null);
      setClientFeedback({
        kind: "success",
        message: manualAppointment
          ? `Klient zapisany. Wizyta: ${adminClientDateFormatter.format(
              dateFromKey(manualAppointment.dateKey),
            )}, ${manualAppointment.startTime}.`
          : matchingClient
            ? "Dane klienta zostały połączone z istniejącą kartą."
            : "Klient został dodany do bazy.",
      });
    } catch {
      setClientFeedback({ kind: "error", message: "Nie udało się zapisać klienta. Spróbuj ponownie." });
    } finally {
      setIsClientSaving(false);
    }
  };

  const settleAdminAppointment = async (appointment: AdminAppointment) => {
    if (
      !isAdmin ||
      settlingAppointmentId ||
      !canSettleAppointment(appointment, currentDate)
    ) {
      return;
    }

    try {
      setSettlingAppointmentId(appointment.id);
      const settledAt = Date.now();
      const settledAmount = getServicePriceValue(appointment.price);
      await update(ref(realtimeDb, `appointments/${appointment.id}`), {
        barberId: appointment.barberId,
        status: "completed",
        settledAt,
        settledAmount,
        settlement: {
          barberId: appointment.barberId,
          settledAt,
          amount: settledAmount,
        },
      });
    } finally {
      setSettlingAppointmentId(null);
    }
  };
  const selectSmsTemplate = (template: SmsTemplate) => {
    if (!smsAppointment) return;

    setSmsComposer((current) =>
      current
        ? {
            ...current,
            template,
            message: buildClientSmsMessage(template, smsAppointment),
          }
        : current,
    );
  };
  const selectSmsAppointment = (appointmentId: string) => {
    const appointment = smsClient?.appointments.find((item) => item.id === appointmentId);
    if (!appointment) return;

    setSmsComposer((current) =>
      current
        ? {
            ...current,
            appointmentId,
            message:
              current.template === "custom"
                ? current.message
                : buildClientSmsMessage(current.template, appointment),
          }
        : current,
    );
  };
  const notificationButton = (
    <button
      className={`notification-bell ${notifications.length > 0 ? "has-items" : ""}`}
      type="button"
      onClick={() => {
        setActiveNotification(null);
        setNotificationPanelOpen((isOpen) => !isOpen);
      }}
      aria-label="Otwórz listę powiadomień"
      aria-expanded={notificationPanelOpen}
    >
      <span className="notification-bell-icon" aria-hidden="true" />
      {notifications.length > 0 ? <b>{Math.min(notifications.length, 9)}</b> : null}
    </button>
  );

  if (!authReady) {
    return (
      <main className="auth-shell" aria-label="Ładowanie logowania">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-logo" aria-hidden="true">
              <img src="/brand/bnb-logo.png" alt="" />
            </span>
            <p>BNB Barbershop</p>
          </div>
          <div className="auth-loader" aria-hidden="true" />
          <h1>Sprawdzamy sesję</h1>
          <p className="auth-copy">Za chwilę pokażemy rezerwacje albo ekran logowania.</p>
        </section>
      </main>
    );
  }

  if (!activeUser) {
    return (
      <main className="auth-shell" aria-label="Logowanie do aplikacji">
        <section className="auth-card">
          <div className="auth-brand">
            <span className="auth-logo" aria-hidden="true">
              <img src="/brand/bnb-logo.png" alt="" />
            </span>
            <p>BNB Barbershop</p>
          </div>

          <div className="auth-hero">
            <p className="eyebrow">Witaj w B&apos;n&apos;B</p>
            <h1>Twój następny termin</h1>
            <p className="auth-copy">
              Zaloguj się, wybierz usługę i godzinę, która pasuje do Twojego dnia.
            </p>
          </div>

          <div className="auth-benefits" aria-label="Korzyści dla klienta">
            <span>Rezerwacja w mniej niż minutę</span>
            <span>Przypomnienie przed wizytą</span>
          </div>

          <button
            className="google-login-button"
            type="button"
            onClick={() => {
              void handleGoogleSignIn();
            }}
            disabled={isSigningIn}
          >
            <span aria-hidden="true">G</span>
            {isSigningIn ? "Łączenie..." : "Kontynuuj z Google"}
          </button>

          {authError ? <p className="auth-error">{authError}</p> : null}
        </section>
      </main>
    );
  }

  return (
      <main
        className={`app-shell ${
          visibleStep === "confirm" || visibleStep === "success" ? "confirm-page" : ""
        } ${
          visibleStep === "admin" ? "admin-page" : ""
        } ${
          visibleStep === "booking" && heroScrollProgress > 0.48 ? "hero-collapsed" : ""
        }`}
      >
      {visibleStep === "admin" ? (
        <section className="admin-view" aria-label="Panel admina">
          <div className="admin-topbar">
            <button
              className="back-button"
              type="button"
              onClick={() => {
                if (isOwner && selectedBarber) {
                  setSelectedBarberId(null);
                  setAdminSection("schedule");
                } else {
                  setStep("booking");
                }
              }}
            >
              ‹ {isOwner && selectedBarber ? "Barberzy" : "Wróć"}
            </button>
            <div>
              <p className="eyebrow">{isOwner ? "Właściciel" : "Barber"}</p>
              <h1>{selectedBarber ? adminSectionLabels[adminSection] : "Wybierz barbera"}</h1>
            </div>
            {selectedBarber ? notificationButton : <span className="owner-topbar-spacer" />}
          </div>

          {isOwner && !selectedBarber ? (
            <div className="owner-barber-select" aria-label="Wybór barbera">
              <header className="owner-barber-heading">
                <p className="eyebrow">Panel zespołu</p>
                <h2>Czyj panel chcesz otworzyć?</h2>
                <span>Każdy barber ma osobny terminarz, klientów, analizę, pracę, usługi i profil.</span>
              </header>

              <div className="owner-barber-grid">
                {ownerBarberSummaries.map((barber) => (
                  <button
                    className={`owner-barber-card ${barber.accent}`}
                    type="button"
                    key={barber.id}
                    onClick={() => {
                      setBarberServices(null);
                      setBarberWorkSettings(null);
                      setSelectedBarberId(barber.id);
                      setAdminSection("schedule");
                      setAdminSelectedKey(dayKey(today));
                      setClientSearch("");
                      setClientFilter("all");
                      setClientFeedback(null);
                      setWorkFeedback(null);
                    }}
                    aria-label={`Otwórz pełny panel barbera ${barber.name}`}
                  >
                    <span className="owner-barber-avatar">
                      {barber.photoUrl ? <img src={barber.photoUrl} alt="" /> : barber.name.slice(0, 1)}
                    </span>
                    <span className="owner-barber-main">
                      <small>{barber.label}</small>
                      <strong>{barber.name}</strong>
                      <em>
                        {barber.nextAppointment
                          ? `Następna: ${adminClientDateFormatter.format(
                              dateFromKey(barber.nextAppointment.dateKey),
                            )}, ${barber.nextAppointment.startTime}`
                          : "Brak nadchodzących wizyt"}
                      </em>
                    </span>
                    <span className="owner-barber-metrics">
                      <span>
                        <strong>{barber.today}</strong>
                        dzisiaj
                      </span>
                      <span>
                        <strong>{barber.clients}</strong>
                        klientów
                      </span>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="selected-barber-context" aria-label="Wybrany barber">
                <span className={`selected-barber-avatar ${selectedBarber.accent}`}>
                  {activeBarberProfile.photoUrl ? (
                    <img src={activeBarberProfile.photoUrl} alt="" />
                  ) : (
                    activeBarberName.slice(0, 1)
                  )}
                </span>
                <span>
                  <small>{isOwner ? "Przeglądasz panel" : "Twój panel"}</small>
                  <strong>{activeBarberName}</strong>
                </span>
                {isOwner ? (
                  <button type="button" onClick={() => setSelectedBarberId(null)}>
                    Zmień
                  </button>
                ) : null}
              </div>

              <div className="admin-content-frame">
            <div className={`admin-tab-panel ${adminSection === "schedule" ? "active" : ""}`}>
              <div className="admin-section-header schedule-section-header">
                <div>
                  <p className="eyebrow">Wybrany dzień</p>
                  <h2>{adminClientDateFormatter.format(dateFromKey(adminSelectedKey))}</h2>
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie dnia">
                  <span>
                    <strong>{adminDayAppointments.length}</strong>
                    wizyty
                  </span>
                  <span>
                    <strong>
                      {adminDayAvailability
                        ? `${adminDayAvailability.startTime}-${adminDayAvailability.endTime}`
                        : "brak"}
                    </strong>
                    dostępność
                  </span>
                </div>
                <div className="schedule-date-controls" aria-label="Zmień dzień terminarza">
                  <button
                    type="button"
                    onClick={() => shiftAdminSelectedDay(-1)}
                    aria-label="Poprzedni dzień"
                  >
                    ‹
                  </button>
                  <label>
                    <span>Data</span>
                    <input
                      type="date"
                      value={adminSelectedKey}
                      onChange={(event) => setAdminSelectedKey(event.target.value)}
                    />
                  </label>
                  <button
                    className={adminSelectedKey === dayKey(today) ? "today active" : "today"}
                    type="button"
                    onClick={() => setAdminSelectedKey(dayKey(today))}
                  >
                    Dzisiaj
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftAdminSelectedDay(1)}
                    aria-label="Następny dzień"
                  >
                    ›
                  </button>
                </div>
              </div>

              <div className="schedule-desktop-grid">
                <aside className="schedule-side-panel">
                  <div className="admin-days" aria-label="Dni z wizytami">
                    {adminScheduleDays.length > 0 ? (
                      adminScheduleDays.map((key) => {
                        const date = dateFromKey(key);
                        const appointmentsCount = adminAppointments.filter(
                          (appointment) => appointment.dateKey === key,
                        ).length;
                        const dayAvailability = getAvailabilityForDate(key, workSettings);

                        return (
                          <button
                            className={`${key === adminSelectedKey ? "active" : ""} ${
                              appointmentsCount > 0 ? "has-appointments" : ""
                            }`}
                            key={key}
                            type="button"
                            onClick={() => setAdminSelectedKey(key)}
                            aria-label={`${adminClientDateFormatter.format(date)}, ${appointmentsCount} wizyt, ${
                              dayAvailability
                                ? `dostępność ${dayAvailability.startTime}-${dayAvailability.endTime}`
                                : "brak dostępności"
                            }`}
                          >
                            <span>
                              {new Intl.DateTimeFormat("pl-PL", { weekday: "short" })
                                .format(date)
                                .replace(".", "")}
                            </span>
                            <strong>{String(date.getDate()).padStart(2, "0")}</strong>
                            <small>
                              {new Intl.DateTimeFormat("pl-PL", { month: "short" })
                                .format(date)
                                .replace(".", "")}
                              {appointmentsCount > 0 ? ` · ${appointmentsCount}` : ""}
                            </small>
                          </button>
                        );
                      })
                    ) : (
                      <p className="admin-days-empty">Brak zaplanowanych wizyt.</p>
                    )}
                  </div>

                  <div className="client-strip" aria-label="Klienci z wybranego dnia">
                    {adminDayAppointments.length > 0 ? (
                      adminDayAppointments.map((appointment) => (
                        <button
                          className="client-chip"
                          key={appointment.id}
                          type="button"
                          onClick={() => openAdminAppointmentEdit(appointment)}
                          aria-label={`Edytuj wizytę ${appointment.clientName} o ${appointment.startTime}`}
                        >
                          <span>{appointment.clientName.slice(0, 1)}</span>
                          <strong>{appointment.clientName}</strong>
                          <small>{appointment.startTime}</small>
                        </button>
                      ))
                    ) : (
                      <p>Brak klientów w tym dniu.</p>
                    )}
                  </div>
                </aside>

                <section className="schedule-mobile-agenda" aria-label="Plan wybranego dnia">
                  <div
                    className={`mobile-availability-banner ${adminDayAvailability ? "open" : "closed"}`}
                  >
                    <span aria-hidden="true" />
                    <div>
                      <strong>{adminDayAvailability ? "Dzień otwarty" : "Brak dostępności"}</strong>
                      <small>
                        {adminDayAvailability
                          ? `${adminDayAvailability.startTime}-${adminDayAvailability.endTime} dla klientów`
                          : "Klienci nie mogą rezerwować tego dnia"}
                      </small>
                    </div>
                    <button type="button" onClick={openSelectedDayInWorkEditor}>
                      {adminDayAvailability ? "Zmień" : "Ustaw"}
                    </button>
                  </div>

                  <div className="mobile-agenda-heading">
                    <div>
                      <p className="section-label">Plan dnia</p>
                      <strong>
                        {adminDayAppointments.length === 0
                          ? "Spokojny dzień"
                          : `${adminDayAppointments.length} ${
                              adminDayAppointments.length === 1 ? "wizyta" : "wizyty"
                            }`}
                      </strong>
                    </div>
                    <span>{getAppointmentDistanceLabel(adminSelectedKey, today)}</span>
                  </div>

                  <div className="mobile-agenda-list">
                    {adminDayAppointments.length > 0 ? (
                      adminDayAppointments.map((appointment) => (
                        <article
                          className={`mobile-agenda-appointment ${appointment.color}`}
                          key={appointment.id}
                        >
                          <div className="mobile-agenda-time">
                            <strong>{appointment.startTime}</strong>
                            <span>
                              {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}
                            </span>
                          </div>
                          <div className="mobile-agenda-client">
                            <strong>{appointment.clientName}</strong>
                            <span>{appointment.serviceName}</span>
                            <small>{appointment.price}</small>
                          </div>
                          <em
                            className={`appointment-status ${normalizeAppointmentStatus(
                              appointment.status,
                            )}`}
                          >
                            {appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                          </em>
                          {normalizeAppointmentStatus(appointment.status) !== "completed" ? (
                            <div className="mobile-agenda-actions">
                            <button
                              type="button"
                              onClick={() => shiftAdminAppointment(appointment.id, -15)}
                              disabled={
                                !canMoveAdminAppointment(
                                  appointment,
                                  minutesToTime(timeToMinutes(appointment.startTime) - 15),
                                )
                              }
                              aria-label={`Cofnij wizytę ${appointment.clientName} o 15 minut`}
                            >
                              -15
                            </button>
                            <button
                              type="button"
                              onClick={() => shiftAdminAppointment(appointment.id, 15)}
                              disabled={
                                !canMoveAdminAppointment(
                                  appointment,
                                  minutesToTime(timeToMinutes(appointment.startTime) + 15),
                                )
                              }
                              aria-label={`Przesuń wizytę ${appointment.clientName} o 15 minut`}
                            >
                              +15
                            </button>
                            <button type="button" onClick={() => openAdminAppointmentEdit(appointment)}>
                              Edytuj
                            </button>
                            <button
                              className="decline"
                              type="button"
                              onClick={() => declineAdminAppointment(appointment.id)}
                            >
                              Odmów
                            </button>
                            </div>
                          ) : null}
                        </article>
                      ))
                    ) : (
                      <div className="mobile-agenda-empty">
                        <strong>Nie ma tu jeszcze żadnej wizyty</strong>
                        <span>
                          {adminDayAvailability
                            ? "Wolne okno jest widoczne dla klientów."
                            : "Ustaw dostępność, jeśli chcesz przyjmować rezerwacje."}
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                <div
                  className="admin-schedule"
                  style={{ height: `${Math.max(8, adminScheduleSlots.length) * 2.8 + 1.5}rem` }}
                >
                  {adminDayAppointments.length === 0 ? (
                    <p className="admin-empty-state">Brak wizyt w tym dniu.</p>
                  ) : null}
                  <div
                    className="time-axis"
                    aria-hidden="true"
                    style={{ gridTemplateRows: `repeat(${adminScheduleHours.length}, 11.2rem)` }}
                  >
                    {adminScheduleHours.map((time) => (
                      <span key={time}>{time}</span>
                    ))}
                  </div>

                  <div className="schedule-column">
                    {adminScheduleSlots.map((time) => (
                      <div
                        className="schedule-drop-zone"
                        key={time}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedAppointmentId) moveAdminAppointment(draggedAppointmentId, time);
                        }}
                      />
                    ))}

                    {currentTimeLineVisible ? (
                      <div
                        className="current-time-line"
                        style={{ top: `${currentTimeLineTop}rem` }}
                        aria-label={`Aktualna godzina ${minutesToTime(currentTimeLineMinutes ?? 0)}`}
                      >
                        <span>{minutesToTime(currentTimeLineMinutes ?? 0)}</span>
                      </div>
                    ) : null}

                    {adminDayAppointments.map((appointment) => {
                      const top =
                        ((timeToMinutes(appointment.startTime) - adminScheduleStartMinutes) / 15) *
                        2.8;
                      const height = Math.max(4.8, (appointment.durationMinutes / 15) * 2.8 - 0.35);

                      return (
                        <article
                          className={`admin-appointment ${appointment.color}`}
                          draggable={
                            !isTouchDevice &&
                            normalizeAppointmentStatus(appointment.status) !== "completed"
                          }
                          key={appointment.id}
                          onDragStart={() => {
                            if (normalizeAppointmentStatus(appointment.status) !== "completed") {
                              setDraggedAppointmentId(appointment.id);
                            }
                          }}
                          style={{ top: `${top}rem`, height: `${height}rem` }}
                        >
                          <div>
                            <strong>
                              {appointment.startTime} -{" "}
                              {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}
                            </strong>
                            <span>
                              {appointment.clientName} · {appointment.serviceName}
                            </span>
                            <small className={`appointment-status ${normalizeAppointmentStatus(appointment.status)}`}>
                              {appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                            </small>
                          </div>
                          {normalizeAppointmentStatus(appointment.status) !== "completed" ? (
                            <div className="appointment-actions">
                            <button
                              type="button"
                              onClick={() => shiftAdminAppointment(appointment.id, -15)}
                              disabled={
                                !canMoveAdminAppointment(
                                  appointment,
                                  minutesToTime(timeToMinutes(appointment.startTime) - 15),
                                )
                              }
                              aria-label={`Cofnij wizytę ${appointment.clientName} o 15 minut`}
                            >
                              -15
                            </button>
                            <button
                              type="button"
                              onClick={() => shiftAdminAppointment(appointment.id, 15)}
                              disabled={
                                !canMoveAdminAppointment(
                                  appointment,
                                  minutesToTime(timeToMinutes(appointment.startTime) + 15),
                                )
                              }
                              aria-label={`Przesuń wizytę ${appointment.clientName} o 15 minut`}
                            >
                              +15
                            </button>
                            <button
                              type="button"
                              onClick={() => openAdminAppointmentEdit(appointment)}
                            >
                              Edytuj
                            </button>
                            <button
                              className="decline-button"
                              type="button"
                              onClick={() => declineAdminAppointment(appointment.id)}
                              aria-label={`Odmów wizytę ${appointment.clientName}`}
                            >
                              Odmów
                            </button>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "clients" ? "active" : ""}`}>
              <div className="admin-section-header">
                <div className="client-section-title">
                  <div>
                    <p className="eyebrow">Kartoteka kontaktów</p>
                    <h2>Baza klientów</h2>
                  </div>
                  <button className="add-client-button" type="button" onClick={openClientCreator}>
                    <span aria-hidden="true">+</span>
                    Dodaj klienta
                  </button>
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie klientów">
                  <span>
                    <strong>{adminClientProfiles.length}</strong>
                    klientów
                  </span>
                  <span>
                    <strong>
                      {adminClientProfiles.filter((client) => client.nextAppointment).length}
                    </strong>
                    aktywnych
                  </span>
                </div>
              </div>

              <div className="clients-view" aria-label="Lista klientów">
                {clientFeedback ? (
                  <div className={`client-feedback ${clientFeedback.kind}`} role="status">
                    {clientFeedback.message}
                  </div>
                ) : null}
                <div className="client-directory-tools">
                  <label className="client-search">
                    <span className="client-search-icon" aria-hidden="true" />
                    <input
                      type="search"
                      value={clientSearch}
                      onChange={(event) => setClientSearch(event.target.value)}
                      placeholder="Szukaj po nazwisku, telefonie lub usłudze"
                      aria-label="Szukaj klientów"
                    />
                    {clientSearch ? (
                      <button
                        type="button"
                        onClick={() => setClientSearch("")}
                        aria-label="Wyczyść wyszukiwanie"
                      >
                        ×
                      </button>
                    ) : null}
                  </label>
                  <div className="client-filters" aria-label="Filtry klientów">
                    {(
                      [
                        ["all", "Wszyscy"],
                        ["upcoming", "Nadchodzące"],
                        ["rescheduled", "Do potwierdzenia"],
                        ["missing-phone", "Brak telefonu"],
                      ] as [ClientFilter, string][]
                    ).map(([filter, label]) => (
                      <button
                        className={clientFilter === filter ? "active" : ""}
                        key={filter}
                        type="button"
                        onClick={() => setClientFilter(filter)}
                        aria-pressed={clientFilter === filter}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="client-directory-summary" aria-live="polite">
                  <strong>{filteredAdminClients.length}</strong>
                  <span>
                    {filteredAdminClients.length === 1 ? "wynik" : "wyników"}
                    {clientSearch ? ` dla „${clientSearch}”` : ""}
                  </span>
                </div>

                <div className="client-directory-list">
                  {filteredAdminClients.length > 0 ? (
                    filteredAdminClients.map((client) => {
                    const phoneDigits = getPhoneDigits(client.phone);
                    const hasPhone = phoneDigits.length === 9;
                    const contactAppointment =
                      client.nextAppointment ?? client.appointments.at(-1) ?? null;
                    const settlementAppointment = [...client.appointments]
                      .reverse()
                      .find((appointment) => canSettleAppointment(appointment, currentDate));

                    return (
                      <article className="client-row" key={client.id}>
                        <button
                          className="client-profile-trigger"
                          type="button"
                          onClick={() => setSelectedAdminClientId(client.id)}
                          aria-label={`Otwórz kartę klienta ${client.name}`}
                        >
                          <span className="client-row-avatar">
                            {client.photoUrl ? <img src={client.photoUrl} alt="" /> : client.name.slice(0, 1)}
                          </span>
                          <span className="client-row-main">
                            <span className="client-row-name">
                              <strong>{client.name}</strong>
                              <small>{client.appointments.length} wizyt</small>
                            </span>
                            {client.nextAppointment ? (
                              <span>
                                {adminClientDateFormatter.format(
                                  dateFromKey(client.nextAppointment.dateKey),
                                )},{" "}
                                {client.nextAppointment.startTime} · {client.nextAppointment.serviceName}
                              </span>
                            ) : (
                              <span>Brak kolejnej wizyty</span>
                            )}
                            <small>
                              {hasPhone ? formatPhoneNumber(phoneDigits) : "Brak numeru telefonu"}
                              {client.email ? ` · ${client.email}` : ""}
                            </small>
                          </span>
                          <span className="client-row-statuses">
                            {settlementAppointment ? (
                              <em
                                className={`appointment-status ${
                                  isPotentialNoShow(settlementAppointment, currentDate)
                                    ? "missed"
                                    : "settlement-due"
                                }`}
                              >
                                {isPotentialNoShow(settlementAppointment, currentDate)
                                  ? "Nierozliczona"
                                  : "Do rozliczenia"}
                              </em>
                            ) : client.rescheduledCount > 0 ? (
                              <em className="appointment-status rescheduled">
                                Do potwierdzenia
                              </em>
                            ) : client.nextAppointment ? (
                              <em className="appointment-status">Aktywny</em>
                            ) : client.appointments.length === 0 ? (
                              <em className="client-history-status">Nowy klient</em>
                            ) : (
                              <em className="client-history-status">Historia</em>
                            )}
                            <i aria-hidden="true">›</i>
                          </span>
                        </button>

                        <div className="client-quick-actions" aria-label={`Szybkie akcje dla ${client.name}`}>
                          {settlementAppointment ? (
                            <button
                              className="settle-appointment-button"
                              type="button"
                              disabled={Boolean(settlingAppointmentId)}
                              onClick={() => void settleAdminAppointment(settlementAppointment)}
                            >
                              {settlingAppointmentId === settlementAppointment.id
                                ? "Zapisywanie..."
                                : "Rozlicz"}
                            </button>
                          ) : null}
                          <button
                            className="book-client-button"
                            type="button"
                            onClick={() => openManualClientBooking(client)}
                            aria-label={`Umów wizytę dla ${client.name}`}
                            title="Umów wizytę"
                          >
                            <span className="small-calendar-icon" aria-hidden="true" />
                          </button>
                          <button
                            className="sms-button"
                            type="button"
                            disabled={!hasPhone || !contactAppointment}
                            onClick={() => {
                              if (contactAppointment) openSmsComposer(client, contactAppointment);
                            }}
                            aria-label={hasPhone ? `Napisz SMS do ${client.name}` : "Brak numeru telefonu"}
                          >
                            <span className="sms-icon" aria-hidden="true" />
                          </button>
                          {client.email ? (
                            <a
                              className="client-email-button"
                              href={`mailto:${client.email}?subject=${encodeURIComponent("BNB Barbershop - Twoja wizyta")}`}
                              aria-label={`Napisz e-mail do ${client.name}`}
                            >
                              <span className="email-icon" aria-hidden="true" />
                            </a>
                          ) : (
                            <span className="client-email-button disabled" aria-label="Brak adresu e-mail">
                              <span className="email-icon" aria-hidden="true" />
                            </span>
                          )}
                          <button
                            className="client-card-button"
                            type="button"
                            onClick={() => setSelectedAdminClientId(client.id)}
                            aria-label={`Otwórz kartę klienta ${client.name}`}
                          >
                            Karta
                          </button>
                        </div>
                      </article>
                    );
                    })
                  ) : (
                    <div className="clients-empty-state">
                      <strong>Brak pasujących klientów</strong>
                      <span>Zmień filtr albo wyczyść wyszukiwanie.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "analytics" ? "active" : ""}`}>
              <div className="admin-section-header analytics-section-header">
                <div>
                  <p className="eyebrow">Wyniki biznesu</p>
                  <h2>{analytics.periodLabel}</h2>
                </div>
                <div className="analytics-period-control" aria-label="Zakres analizy">
                  {(Object.keys(analyticsPeriodLabels) as AnalyticsPeriod[]).map((period) => (
                    <button
                      className={analyticsPeriod === period ? "active" : ""}
                      key={period}
                      type="button"
                      onClick={() => setAnalyticsPeriod(period)}
                      aria-pressed={analyticsPeriod === period}
                    >
                      {analyticsPeriodLabels[period]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="analytics-view" aria-label="Analiza działalności">
                <div className="analytics-kpi-grid">
                  <article className="analytics-kpi revenue">
                    <span>Przychód</span>
                    <strong>{formatCurrency(analytics.revenue)}</strong>
                    <small className={analytics.revenueChange < 0 ? "negative" : "positive"}>
                      {analytics.revenueChange > 0 ? "+" : ""}
                      {analytics.revenueChange}% do poprzedniego okresu
                    </small>
                  </article>
                  <article className="analytics-kpi visits">
                    <span>Rozliczone wizyty</span>
                    <strong>{analytics.visits}</strong>
                    <small className={analytics.visitsChange < 0 ? "negative" : "positive"}>
                      {analytics.visitsChange > 0 ? "+" : ""}
                      {analytics.visitsChange} do poprzedniego okresu
                    </small>
                  </article>
                  <article className="analytics-kpi clients">
                    <span>Klienci</span>
                    <strong>{analytics.clients}</strong>
                    <small>
                      {analytics.newClients} nowych · {analytics.returningClients} powracających
                    </small>
                  </article>
                  <article className="analytics-kpi occupancy">
                    <span>Obłożenie</span>
                    <strong>{analytics.occupancy}%</strong>
                    <small>zajęty czas w dostępnych godzinach</small>
                  </article>
                </div>

                <div className="analytics-main-grid">
                  <section className="analytics-panel analytics-trend-panel">
                    <div className="analytics-panel-heading">
                      <div>
                        <p className="section-label">Przychód w czasie</p>
                        <strong>{formatCurrency(analytics.revenue)}</strong>
                      </div>
                      <span>{analyticsPeriodLabels[analyticsPeriod]}</span>
                    </div>

                    <div className="analytics-chart" aria-label="Wykres przychodu">
                      {analytics.trend.map((bucket) => (
                        <div className="analytics-bar-column" key={`${bucket.label}-${analyticsPeriod}`}>
                          <strong>{bucket.revenue > 0 ? formatCurrency(bucket.revenue) : "—"}</strong>
                          <div className="analytics-bar-track" aria-hidden="true">
                            <span
                              style={
                                {
                                  "--bar-height": `${Math.max(
                                    bucket.revenue > 0 ? 8 : 0,
                                    Math.round((bucket.revenue / analytics.maxTrendRevenue) * 100),
                                  )}%`,
                                } as CSSProperties
                              }
                            />
                          </div>
                          <small>{bucket.label}</small>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="analytics-panel analytics-services-panel">
                    <div className="analytics-panel-heading">
                      <div>
                        <p className="section-label">Usługi</p>
                        <strong>Największy udział</strong>
                      </div>
                      <span>{analytics.servicesSummary.length}</span>
                    </div>

                    {analytics.servicesSummary.length > 0 ? (
                      <div className="analytics-service-list">
                        {analytics.servicesSummary.slice(0, 5).map((service) => (
                          <div className="analytics-service-row" key={service.name}>
                            <div>
                              <strong>{service.name}</strong>
                              <span>
                                {service.visits} {service.visits === 1 ? "wizyta" : "wizyt"}
                              </span>
                            </div>
                            <b>{formatCurrency(service.revenue)}</b>
                            <div className="analytics-service-meter" aria-hidden="true">
                              <span
                                style={{
                                  width: `${Math.max(
                                    4,
                                    Math.round(
                                      (service.revenue / analytics.maxServiceRevenue) * 100,
                                    ),
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="analytics-empty-state">
                        <strong>Brak rozliczonych usług</strong>
                        <span>Pierwsze wyniki pojawią się po rozliczeniu wizyty.</span>
                      </div>
                    )}
                  </section>
                </div>

                <div className="analytics-insight-grid">
                  <article>
                    <span>Średnia wizyta</span>
                    <strong>{formatCurrency(analytics.averageTicket)}</strong>
                    <small>średni przychód z rozliczenia</small>
                  </article>
                  <article>
                    <span>Przyszłe rezerwacje</span>
                    <strong>{formatCurrency(analytics.plannedRevenue)}</strong>
                    <small>w wybranym okresie</small>
                  </article>
                  <article className={analytics.potentialNoShows > 0 ? "attention" : ""}>
                    <span>Potencjalne nieobecności</span>
                    <strong>{analytics.potentialNoShows}</strong>
                    <small>{formatCurrency(analytics.potentialNoShowValue)} bez rozliczenia</small>
                  </article>
                </div>
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "work" ? "active" : ""}`}>
              <div className="admin-section-header">
                <div>
                  <p className="eyebrow">Dorywczo</p>
                  <h2>Dni dostępne dla klientów</h2>
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie dostępności">
                  <span>
                    <strong>{availabilityWindows.length}</strong>
                    dni
                  </span>
                  <span>
                    <strong>{nearestAvailability?.startTime ?? "—"}</strong>
                    najbliżej
                  </span>
                </div>
              </div>

              <div className="work-view casual" aria-label="Moja dostępność">
                <section
                  className="work-editor-card availability-maker"
                  id="availability-maker"
                >
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">
                        {editingAvailabilityKey ? "Edycja dostępności" : "Nowa dostępność"}
                      </p>
                      <h2>
                        {editingAvailabilityKey ? "Zmień dzień pracy" : "Okienko w kalendarzu"}
                      </h2>
                    </div>
                    {editingAvailabilityKey ? (
                      <button
                        className="work-editor-cancel"
                        type="button"
                        onClick={resetAvailabilityEditor}
                      >
                        Anuluj
                      </button>
                    ) : null}
                  </div>

                  <div className="work-preset-grid">
                    {[
                      { label: "Po pracy", startTime: "17:00", endTime: "20:00" },
                      { label: "Wolne rano", startTime: "10:00", endTime: "13:00" },
                      { label: "Krótko", startTime: "18:00", endTime: "19:30" },
                    ].map((preset) => (
                      <button
                        className={
                          availabilityDraft.startTime === preset.startTime &&
                          availabilityDraft.endTime === preset.endTime
                            ? "active"
                            : ""
                        }
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setWorkFeedback(null);
                          setAvailabilityDraft((current) => ({
                            ...current,
                            startTime: preset.startTime,
                            endTime: preset.endTime,
                          }));
                        }}
                        aria-pressed={
                          availabilityDraft.startTime === preset.startTime &&
                          availabilityDraft.endTime === preset.endTime
                        }
                      >
                        <strong>{preset.label}</strong>
                        <span>
                          {preset.startTime} - {preset.endTime}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="work-time-controls pro">
                    <label>
                      Od daty
                      <input
                        type="date"
                        min={dayKey(today)}
                        value={availabilityDraft.start}
                        onChange={(event) =>
                          updateAvailabilityDraft("start", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Do daty
                      <input
                        type="date"
                        min={availabilityDraft.start}
                        value={availabilityDraft.end}
                        onChange={(event) => updateAvailabilityDraft("end", event.target.value)}
                      />
                    </label>
                    <label>
                      Od godziny
                      <select
                        value={availabilityDraft.startTime}
                        onChange={(event) =>
                          updateAvailabilityDraft("startTime", event.target.value)
                        }
                      >
                        {workTimeOptions.slice(0, -1).map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Do godziny
                      <select
                        value={availabilityDraft.endTime}
                        onChange={(event) =>
                          updateAvailabilityDraft("endTime", event.target.value)
                        }
                      >
                        {workTimeOptions.slice(1).map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="availability-summary-panel">
                    <div>
                      <strong>
                        {editingAvailabilityKey ? "Zapiszesz zmianę" : "Dodasz dostępność"}
                      </strong>
                      <span>
                        {availabilityDraftKeys.length}{" "}
                        {availabilityDraftKeys.length === 1 ? "dzień" : "dni"} ·{" "}
                        {formatDuration(Math.max(0, availabilityDraftDuration))} dziennie
                      </span>
                      {availabilityOverwriteCount > 0 ? (
                        <small>
                          {availabilityOverwriteCount === 1
                            ? "1 istniejący dzień zostanie zaktualizowany"
                            : `${availabilityOverwriteCount} istniejące dni zostaną zaktualizowane`}
                        </small>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void addAvailabilityRange()}
                      disabled={!canSaveAvailability || isWorkSaving}
                    >
                      {isWorkSaving
                        ? "Zapisywanie..."
                        : editingAvailabilityKey
                          ? "Zapisz zmiany"
                          : "Dodaj dostępność"}
                    </button>
                  </div>
                  {workFeedback ? (
                    <p className={`work-feedback ${workFeedback.kind}`} role="status">
                      {workFeedback.message}
                    </p>
                  ) : null}
                </section>

                <section className="work-editor-card">
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">Szybkie dodawanie</p>
                      <h2>Gotowe okienka</h2>
                    </div>
                  </div>

                  <div className="quick-availability-list">
                    {quickAvailabilityOptions.map((option) => (
                      <button
                        className={workSettings.availability[option.dateKey] ? "existing" : ""}
                        key={`${option.dateKey}-${option.startTime}`}
                        type="button"
                        disabled={isWorkSaving}
                        onClick={() =>
                          void quickAddAvailability(
                            option.offset,
                            option.startTime,
                            option.endTime,
                          )
                        }
                      >
                        <span className="quick-availability-date">
                          <strong>{option.label}</strong>
                          <small>{adminClientDateFormatter.format(option.date)}</small>
                        </span>
                        <span className="quick-availability-time">
                          <strong>
                            {option.startTime}-{option.endTime}
                          </strong>
                          <small>
                            {workSettings.availability[option.dateKey] ? "Zaktualizuj" : "Dodaj"}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="availability-list-card">
                  <div className="work-card-heading">
                    <div>
                      <p className="eyebrow">Widoczne dla klientów</p>
                      <h2>Aktywne dni</h2>
                    </div>
                  </div>

                  <div className="availability-month-list">
                    {availabilityMonthGroups.length > 0 ? (
                      availabilityMonthGroups.map((monthGroup) => {
                        const isExpanded = expandedAvailabilityMonth === monthGroup.key;

                        return (
                          <section
                            className={`availability-month ${isExpanded ? "expanded" : ""}`}
                            key={monthGroup.key}
                          >
                            <button
                              className="availability-month-toggle"
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() =>
                                setExpandedAvailabilityMonth(isExpanded ? null : monthGroup.key)
                              }
                            >
                              <span>
                                <strong>{monthGroup.label}</strong>
                                <small>
                                  {monthGroup.items.length}{" "}
                                  {monthGroup.items.length === 1 ? "dzień" : "dni"} ·{" "}
                                  {formatDuration(monthGroup.totalMinutes)}
                                </small>
                              </span>
                              <b aria-hidden="true">⌄</b>
                            </button>

                            <div className="availability-window-list">
                              {monthGroup.items.map((windowItem) => (
                                <article className="availability-window-row" key={windowItem.id}>
                                  <div>
                                    <strong>
                                      {adminClientDateFormatter.format(dateFromKey(windowItem.dateKey))}
                                    </strong>
                                    <span>{formatWorkRange(windowItem)}</span>
                                  </div>
                                  <div className="availability-window-actions">
                                    <button
                                      type="button"
                                      onClick={() => beginAvailabilityEdit(windowItem)}
                                    >
                                      Edytuj
                                    </button>
                                    <button
                                      className={
                                        pendingAvailabilityRemovalKey === windowItem.dateKey
                                          ? "confirm-remove"
                                          : "remove"
                                      }
                                      type="button"
                                      disabled={isWorkSaving}
                                      onClick={() => void removeAvailabilityDate(windowItem.dateKey)}
                                    >
                                      {pendingAvailabilityRemovalKey === windowItem.dateKey
                                        ? "Potwierdź"
                                        : "Usuń"}
                                    </button>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </section>
                        );
                      })
                    ) : (
                      <p>Nie masz jeszcze żadnego dostępnego dnia.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "services" ? "active" : ""}`}>
              <div className="admin-section-header">
                <div>
                  <p className="eyebrow">Oferta</p>
                  <h2>Usługi w aplikacji</h2>
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie usług">
                  <span>
                    <strong>{services.length}</strong>
                    usług
                  </span>
                  <span>
                    <strong>
                      {formatDuration(
                        Math.round(
                          services.reduce((sum, service) => sum + service.durationMinutes, 0) /
                            Math.max(services.length, 1),
                        ),
                      )}
                    </strong>
                    średnio
                  </span>
                </div>
              </div>

              <div className="services-admin-view" aria-label="Zarządzanie usługami">
                <section className="service-editor-panel">
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">{editingService ? "Edycja" : "Nowa usługa"}</p>
                      <h2>{editingService ? editingService.name : "Dodaj usługę"}</h2>
                    </div>
                    {editingService ? (
                      <button className="service-cancel-button" type="button" onClick={resetServiceDraft}>
                        Anuluj
                      </button>
                    ) : null}
                  </div>

                  <div className="service-form-grid">
                    <label>
                      Nazwa usługi
                      <input
                        type="text"
                        value={serviceDraft.name}
                        onChange={(event) => updateServiceDraft("name", event.target.value)}
                      />
                    </label>
                    <label>
                      Cena
                      <input
                        inputMode="decimal"
                        type="text"
                        value={serviceDraft.price}
                        onChange={(event) => updateServiceDraft("price", event.target.value)}
                      />
                    </label>
                    <label>
                      Czas trwania
                      <input
                        inputMode="numeric"
                        min="15"
                        step="15"
                        type="number"
                        value={serviceDraft.durationMinutes}
                        onChange={(event) =>
                          updateServiceDraft("durationMinutes", event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="service-editor-summary">
                    <span>
                      {serviceDraft.name.trim() || "Nazwa usługi"} ·{" "}
                      {serviceDraft.price.trim() ? formatServicePrice(serviceDraft.price) : "0 zł"} ·{" "}
                      {formatDuration(Number(serviceDraft.durationMinutes) || 0) || "0min"}
                    </span>
                    <button
                      type="button"
                      disabled={!canSaveService || isSaving}
                      onClick={() => {
                        void saveService();
                      }}
                    >
                      {editingService ? "Zapisz zmiany" : "Dodaj usługę"}
                    </button>
                  </div>
                </section>

                <section className="service-management-list">
                  {services.map((service) => (
                    <article className="service-management-card" key={service.id}>
                      <div>
                        <strong>{service.name}</strong>
                        <span>
                          {service.price} · {formatDuration(service.durationMinutes)}
                        </span>
                      </div>
                      <div className="service-management-actions">
                        <button type="button" onClick={() => editService(service)}>
                          Edytuj
                        </button>
                        <button
                          className="danger"
                          type="button"
                          disabled={services.length <= 1}
                          onClick={() => {
                            void deleteService(service.id);
                          }}
                        >
                          Usuń
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "profile" ? "active" : ""}`}>
              <div className="admin-section-header">
                <div>
                  <p className="eyebrow">Wizytówka barbera</p>
                  <h2>Profil {activeBarberName}</h2>
                </div>
                <div className="admin-section-stats" aria-label="Stan profilu">
                  <span>
                    <strong>{profileDraft.photoUrl ? "jest" : "brak"}</strong>
                    zdjęcie
                  </span>
                  <span>
                    <strong>{profileDraft.bio ? "gotowy" : "pusty"}</strong>
                    opis
                  </span>
                </div>
              </div>

              <div className="barber-profile-view">
                <section className="barber-profile-preview">
                  <div className={`barber-profile-photo ${selectedBarber.accent}`}>
                    {profileDraft.photoUrl ? (
                      <img src={profileDraft.photoUrl} alt={`Profil ${activeBarberName}`} />
                    ) : (
                      <span aria-hidden="true">{activeBarberName.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="barber-profile-preview-copy">
                    <p className="eyebrow">{selectedBarber.label}</p>
                    <h3>{profileDraft.displayName || selectedBarber.name}</h3>
                    {profileDraft.instagram ? <span>@{profileDraft.instagram}</span> : null}
                  </div>
                  <div className="barber-photo-actions">
                    <label className="profile-photo-button">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => void handleProfilePhotoChange(event)}
                      />
                      {isProfilePhotoProcessing ? "Przetwarzanie..." : "Wybierz zdjęcie"}
                    </label>
                    {profileDraft.photoUrl ? (
                      <button
                        type="button"
                        onClick={() =>
                          setProfileDraft((current) => ({ ...current, photoUrl: "" }))
                        }
                      >
                        Usuń
                      </button>
                    ) : null}
                  </div>
                </section>

                <form
                  className="barber-profile-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveBarberProfile();
                  }}
                >
                  <div className="barber-profile-form-heading">
                    <div>
                      <p className="eyebrow">Informacje</p>
                      <h3>Dane profilu</h3>
                    </div>
                    <span>Opcjonalne</span>
                  </div>

                  <div className="barber-profile-fields">
                    <label>
                      Imię wyświetlane
                      <input
                        type="text"
                        maxLength={50}
                        value={profileDraft.displayName}
                        onChange={(event) =>
                          setProfileDraft((current) => ({
                            ...current,
                            displayName: event.target.value,
                          }))
                        }
                        placeholder={selectedBarber.name}
                      />
                    </label>
                    <label>
                      Numer telefonu
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        value={profileDraft.phone}
                        onChange={(event) =>
                          setProfileDraft((current) => ({
                            ...current,
                            phone: formatPhoneNumber(getPhoneDigits(event.target.value)),
                          }))
                        }
                        placeholder="500 000 000"
                      />
                    </label>
                    <label>
                      E-mail
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        maxLength={100}
                        value={profileDraft.email}
                        onChange={(event) =>
                          setProfileDraft((current) => ({ ...current, email: event.target.value }))
                        }
                        placeholder="barber@example.com"
                      />
                    </label>
                    <label>
                      Instagram
                      <span className="profile-instagram-input">
                        <b aria-hidden="true">@</b>
                        <input
                          type="text"
                          inputMode="text"
                          maxLength={40}
                          value={profileDraft.instagram}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              instagram: event.target.value.replace(/^@+/, ""),
                            }))
                          }
                          placeholder="nazwa_profilu"
                        />
                      </span>
                    </label>
                    <label className="barber-profile-bio">
                      Krótki opis
                      <textarea
                        maxLength={280}
                        value={profileDraft.bio}
                        onChange={(event) =>
                          setProfileDraft((current) => ({ ...current, bio: event.target.value }))
                        }
                        placeholder="Kilka słów o specjalizacji i stylu pracy"
                      />
                      <small>{profileDraft.bio.length}/280</small>
                    </label>
                  </div>

                  <div className="barber-profile-submit">
                    {profileFeedback ? (
                      <p className={`work-feedback ${profileFeedback.kind}`}>
                        {profileFeedback.message}
                      </p>
                    ) : (
                      <span />
                    )}
                    <button
                      type="submit"
                      disabled={isProfileSaving || isProfilePhotoProcessing}
                    >
                      {isProfileSaving ? "Zapisywanie..." : "Zapisz profil"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>

          <nav className="admin-bottom-nav" aria-label="Sekcje admina">
            <span className={`admin-nav-pill ${adminSection}`} aria-hidden="true" />
            <button
              className={adminSection === "schedule" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("schedule")}
            >
              <span className="admin-nav-icon schedule-icon" aria-hidden="true" />
              <span>Terminarz</span>
            </button>
            <button
              className={adminSection === "clients" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("clients")}
            >
              <span className="admin-nav-icon clients-icon" aria-hidden="true" />
              <span>Baza</span>
            </button>
            <button
              className={adminSection === "analytics" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("analytics")}
            >
              <span className="admin-nav-icon analytics-icon" aria-hidden="true" />
              <span>Analiza</span>
            </button>
            <button
              className={adminSection === "work" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("work")}
            >
              <span className="admin-nav-icon work-icon" aria-hidden="true" />
              <span>Praca</span>
            </button>
            <button
              className={adminSection === "services" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("services")}
            >
              <span className="admin-nav-icon services-icon" aria-hidden="true" />
              <span>Usługi</span>
            </button>
            <button
              className={adminSection === "profile" ? "active" : ""}
              type="button"
              onClick={() => setAdminSection("profile")}
            >
              <span className="admin-nav-icon profile-icon" aria-hidden="true" />
              <span>Profil</span>
            </button>
          </nav>
            </>
          )}
        </section>
      ) : visibleStep === "booking" ? (
        <>
          <div className="home-hero" style={heroStyle} aria-hidden="true">
            <img
              src="/brand/bnb-hero.png"
              alt=""
              width="1672"
              height="941"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <section className="booking-panel" aria-label="Kalendarz rezerwacji">
            <div className="topbar">
              <div className="topbar-title">
                <img className="topbar-logo-mark" src="/brand/bnb-mark.png" alt="" aria-hidden="true" />
                <div>
                  <p className="eyebrow">BNB Barbershop</p>
                  <h1>Twój panel</h1>
                </div>
              </div>
              <div className="session-pill">
                {activeUser.photoURL ? (
                  <img src={activeUser.photoURL} alt="" />
                ) : (
                  <span aria-hidden="true">{(activeUser.displayName ?? "K").slice(0, 1)}</span>
                )}
                <strong>{activeUser.displayName ?? activeUser.email ?? "Klient"}</strong>
                {notificationButton}
                <button
                  type="button"
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  Wyloguj
                </button>
              </div>
              {isAdmin ? (
                <button
                  className="avatar-button"
                  type="button"
                  onClick={() => setStep("admin")}
                  aria-label="Otwórz profil admina"
                >
                  <span className="avatar-icon" aria-hidden="true">
                    <span />
                  </span>
                </button>
              ) : null}
            </div>

            <section className="client-dashboard" aria-labelledby="client-dashboard-title">
              <div className="client-dashboard-heading">
                <div>
                  <p className="eyebrow">Dzień dobry, {clientFirstName}</p>
                  <h2 id="client-dashboard-title">Twoja najbliższa wizyta</h2>
                </div>
                {clientAppointments.length > 1 ? (
                  <button type="button" onClick={() => setClientAppointmentsListOpen(true)}>
                    Wszystkie wizyty <span>{clientAppointments.length}</span>
                  </button>
                ) : null}
              </div>

              {reschedulingAppointment ? (
                <div className="client-visit-card editing">
                  <div className="client-visit-date" aria-hidden="true">
                    <strong>{dateFromKey(reschedulingAppointment.dateKey).getDate()}</strong>
                    <span>{clientMonthFormatter.format(dateFromKey(reschedulingAppointment.dateKey))}</span>
                  </div>
                  <div className="client-visit-content">
                    <em>Zmiana terminu</em>
                    <strong>{reschedulingAppointment.serviceName}</strong>
                    <small>Wybierz poniżej nowy dzień i godzinę.</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReschedulingAppointmentId(null);
                      setSelectedTime("");
                    }}
                  >
                    Anuluj
                  </button>
                </div>
              ) : nearestClientAppointment ? (
                <button
                  className="client-visit-card"
                  type="button"
                  onClick={() => setClientAppointmentId(nearestClientAppointment.id)}
                  aria-label={`Otwórz szczegóły wizyty: ${nearestClientAppointment.serviceName}`}
                >
                  <span className="client-visit-date" aria-hidden="true">
                    <strong>{dateFromKey(nearestClientAppointment.dateKey).getDate()}</strong>
                    <span>{clientMonthFormatter.format(dateFromKey(nearestClientAppointment.dateKey))}</span>
                  </span>
                  <span className="client-visit-content">
                    <em>{getAppointmentDistanceLabel(nearestClientAppointment.dateKey, today)}</em>
                    <strong>{nearestClientAppointment.serviceName}</strong>
                    <small>
                      {nearestClientAppointment.startTime} -{" "}
                      {addMinutesToTime(
                        nearestClientAppointment.startTime,
                        nearestClientAppointment.durationMinutes,
                      )} · {nearestClientAppointment.price}
                    </small>
                  </span>
                  <span className="client-visit-meta">
                    <em className={`appointment-status ${normalizeAppointmentStatus(nearestClientAppointment.status)}`}>
                      {appointmentStatusLabels[normalizeAppointmentStatus(nearestClientAppointment.status)]}
                    </em>
                    <i aria-hidden="true">›</i>
                  </span>
                </button>
              ) : (
                <div className="client-visit-empty">
                  <span className="client-empty-icon" aria-hidden="true" />
                  <span>
                    <strong>Masz wolny kalendarz</strong>
                    <span>Nową wizytę umówisz poniżej w trzech krótkich krokach.</span>
                  </span>
                </div>
              )}
            </section>

            <div className="booking-section-heading">
              <div>
                <p className="section-label">Nowa rezerwacja</p>
                <h2>Umów wizytę</h2>
              </div>
              <ol className="booking-progress" aria-label="Postęp rezerwacji">
                <li className="complete">
                  <button
                    type="button"
                    onClick={() => scrollToBookingSection(bookingServiceRef.current)}
                  >
                    <span>1</span> Usługa
                  </button>
                </li>
                <li className={hasSelectedDay ? "complete" : "active"}>
                  <button
                    type="button"
                    onClick={() => scrollToBookingSection(bookingCalendarRef.current)}
                  >
                    <span>2</span> Dzień
                  </button>
                </li>
                <li className={selectedTime ? "complete active" : hasSelectedDay ? "active" : ""}>
                  <button
                    type="button"
                    disabled={!hasSelectedDay}
                    onClick={() => scrollToBookingSection(bookingTimeRef.current)}
                  >
                    <span>3</span> Godzina
                  </button>
                </li>
              </ol>
            </div>

            <div className="client-service-picker booking-scroll-target" ref={bookingServiceRef}>
              <p className="section-label">Wybierz usługę</p>
              <div className="service-list">
                {services.map((item) => (
                  <button
                    className={`service-card ${selectedServiceId === item.id ? "selected" : ""}`}
                    key={item.id}
                    type="button"
                    disabled={Boolean(reschedulingAppointment)}
                    onClick={() => {
                      setSelectedServiceId(item.id);
                      setSelectedTime("");
                      if (window.matchMedia("(max-width: 767px)").matches) {
                        window.requestAnimationFrame(() =>
                          scrollToBookingSection(bookingCalendarRef.current),
                        );
                      }
                    }}
                    aria-pressed={selectedServiceId === item.id}
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>{formatDuration(item.durationMinutes)}</small>
                    </span>
                    <b>{item.price}</b>
                  </button>
                ))}
              </div>
            </div>

            <div
              className="client-calendar booking-scroll-target"
              ref={bookingCalendarRef}
              onPointerDown={beginCalendarGesture}
              onPointerUp={endCalendarGesture}
              onPointerCancel={() => {
                calendarGestureRef.current = null;
              }}
              onClickCapture={(event) => {
                if (!calendarSwipeConsumedRef.current) return;
                event.preventDefault();
                event.stopPropagation();
              }}
            >
            <div className="calendar-header">
              <div>
                <p className="section-label">Kalendarz</p>
                <h2 aria-live="polite">{monthFormatter.format(visibleMonth)}</h2>
              </div>
              <div className="month-controls" aria-label="Zmiana miesiąca">
                <button
                  type="button"
                  disabled={!canShiftToPreviousMonth}
                  onClick={() => shiftMonth(-1)}
                  aria-label="Poprzedni miesiąc"
                >
                  ‹
                </button>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Następny miesiąc">
                  ›
                </button>
              </div>
            </div>

            <div className="weekday-row" aria-hidden="true">
              {["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>

            <div className="calendar-grid">
              {days.map((day) => {
                const key = dayKey(day.date);
                const isSelected = key === selectedDayKey;
                const isToday = key === dayKey(today);
                const progress = day.totalSlots
                  ? Math.min(100, (day.freeSlots / day.totalSlots) * 100)
                  : 0;

                return (
                  <button
                    className={`day-tile ${day.availability} ${
                      day.monthOffset === 0 ? "" : "outside-month"
                    } ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`}
                    disabled={day.freeSlots === 0}
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedKey(key);
                      setSelectedTime("");
                      if (window.matchMedia("(max-width: 767px)").matches) {
                        window.requestAnimationFrame(() =>
                          scrollToBookingSection(bookingTimeRef.current),
                        );
                      }
                    }}
                    aria-label={`${day.day}, ${availabilityLabel[day.availability]}`}
                  >
                    <span className="day-number">{day.day}</span>
                    {isToday ? <span className="today-dot" aria-label="Dzisiaj" /> : null}
                    <span className="availability-bar">
                      <span style={{ width: `${progress}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
            </div>

          </section>

          <aside className="day-summary" aria-label="Szczegóły rezerwacji">
            <div className="summary-block nearest-slot-block">
              <p className="section-label">Szybki wybór</p>
              <button
                className="nearest-slot-button"
                type="button"
                disabled={!nearestFreeSlot}
                onClick={selectNearestFreeSlot}
              >
                <span>Najbliższy wolny termin</span>
                <strong>
                  {nearestFreeSlot
                    ? `${dayFormatter.format(nearestFreeSlot.date)}, ${nearestFreeSlot.time}`
                    : "Brak wolnych terminów"}
                </strong>
              </button>
            </div>

            <div className="summary-heading booking-scroll-target" ref={bookingTimeRef}>
              <p className="section-label">Wybrany dzień</p>
              <h2>{selectedDayFormatter.format(selectedDay.date)}</h2>
            </div>

            <div className="summary-block">
              <p className="section-label">Wybierz godzinę</p>
              <div className="time-list">
                {availableTimes.length > 0 ? (
                  availableTimes.map((time) => (
                    <button
                      className={selectedTime === time ? "selected" : ""}
                      key={time}
                      type="button"
                      onClick={() => setSelectedTime(time)}
                      aria-pressed={selectedTime === time}
                    >
                      {time}
                    </button>
                  ))
                ) : (
                  <p className="empty-state">Brak wolnych godzin dla tej usługi.</p>
                )}
              </div>
            </div>
          </aside>
        </>
      ) : visibleStep === "confirm" ? (
        <section className="confirm-view" aria-label="Wypełnij i potwierdź">
          <button className="back-button" type="button" onClick={() => setStep("booking")}>
            ‹ Wróć
          </button>

          <div className="confirm-title">
            <p className="eyebrow">Krok 2 z 2</p>
            <h1>Potwierdź wizytę</h1>
          </div>

          <div className="booking-recap" aria-label="Podsumowanie wyboru">
            <span className="booking-recap-service">
              <small>Usługa</small>
              <strong>{selectedService.name}</strong>
              <em>{formatDuration(selectedService.durationMinutes)}</em>
            </span>
            <strong className="booking-recap-price">{selectedService.price}</strong>
            <span className="booking-recap-date">
              <small>Termin</small>
              <strong>{dayFormatter.format(selectedDay.date)}, {selectedTime}</strong>
            </span>
          </div>

          <form
            className="confirm-form"
            aria-label="Dane do rezerwacji"
            onSubmit={(event) => {
              event.preventDefault();
              if (canConfirm) {
                void confirmBooking();
              }
            }}
          >
            <label>
              Imię i nazwisko
              <input
                type="text"
                value={form.fullName}
                onChange={(event) => updateForm("fullName", event.target.value)}
                autoComplete="name"
                enterKeyHint="next"
                required
                aria-invalid={form.fullName.length > 0 && form.fullName.trim().length < 3}
              />
            </label>
            <label>
              Numer telefonu
              <input
                type="tel"
                inputMode="numeric"
                maxLength={11}
                pattern="[0-9 ]{11}"
                value={form.phone}
                onChange={(event) => updateForm("phone", event.target.value)}
                autoComplete="tel"
                enterKeyHint="done"
                required
                aria-invalid={form.phone.length > 0 && getPhoneDigits(form.phone).length !== 9}
              />
            </label>
          </form>
        </section>
      ) : (
        <section className="success-view" aria-label="Potwierdzenie wizyty">
          <div className="success-topbar">
            <img className="success-logo-mark" src="/brand/bnb-logo.png" alt="BNB Barbershop" />
            <button
              className="calendar-save-button"
              type="button"
              disabled={!bookingSummary}
              onClick={addBookingToCalendar}
              aria-label="Dodaj wizytę do kalendarza"
              title="Dodaj wizytę do kalendarza"
            >
              <span aria-hidden="true" />
            </button>
          </div>

          <div className={`success-loader ${successReady ? "done" : ""}`} aria-live="polite">
            <span className="loader-ring" />
            <span className="loader-check" aria-hidden="true" />
          </div>

          {successReady && bookingSummary ? (
            <div className="success-summary">
              <p className="eyebrow">Wizyta potwierdzona</p>
              <h1>{bookingSummary.serviceName}</h1>
              <div className="success-details">
                <span>{dayFormatter.format(bookingSummary.date)}</span>
                <span>{bookingSummary.time}</span>
                <span>{formatDuration(bookingSummary.durationMinutes)}</span>
                <span>{bookingSummary.servicePrice}</span>
              </div>
              <div className="client-summary">
                <span>{bookingSummary.fullName}</span>
                <span>{bookingSummary.phone}</span>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {notificationPanelOpen ? (
        <div
          className="notification-panel-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNotificationPanelOpen(false);
          }}
        >
          <aside
            className="notification-panel client-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Lista powiadomień"
          >
            <div
              className="sheet-grabber"
              aria-hidden="true"
              onPointerDown={beginSheetGesture}
              onPointerUp={(event) => endSheetGesture(event, () => setNotificationPanelOpen(false))}
              onPointerCancel={() => {
                sheetGestureRef.current = null;
              }}
            />
            <div className="notification-panel-header">
              <strong>Powiadomienia</strong>
              <button
                type="button"
                onClick={() => setNotificationPanelOpen(false)}
                aria-label="Zamknij"
              >
                ×
              </button>
            </div>
            {notifications.length > 0 ? (
              <div className="notification-list">
                {notifications.map((notification) => (
                  <article className="notification-item" key={notification.id}>
                    <div className="notification-item-title">
                      <strong>{notification.title}</strong>
                      <button
                        type="button"
                        onClick={() => deleteNotification(notification.id)}
                        aria-label="Usuń powiadomienie"
                      >
                        ×
                      </button>
                    </div>
                    <span>{notification.body}</span>
                    <small>
                      {new Intl.DateTimeFormat("pl-PL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(notification.createdAt))}
                    </small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="notification-empty">Brak powiadomień.</p>
            )}
          </aside>
        </div>
      ) : null}

      {activeNotification ? (
        <div className="notification-toast" role="status" aria-live="polite">
          <strong>{activeNotification.title}</strong>
          <span>{activeNotification.body}</span>
        </div>
      ) : null}

      {clientDialog &&
      (clientDialog.mode === "create" || manualBookingClient) &&
      visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop client-creator-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isClientSaving) {
              setClientDialog(null);
              setClientFeedback(null);
            }
          }}
        >
          <section
            className="client-appointment-modal client-creator-modal"
            role="dialog"
            aria-modal="true"
            aria-label={clientDialog.mode === "create" ? "Dodaj klienta" : "Umów klienta"}
          >
            <button
              className="modal-close-button"
              type="button"
              disabled={isClientSaving}
              onClick={() => {
                setClientDialog(null);
                setClientFeedback(null);
              }}
              aria-label="Zamknij"
            >
              ×
            </button>

            <header className="client-creator-header">
              <span className="client-creator-icon" aria-hidden="true">
                {clientDialog.mode === "create" ? "+" : <span className="small-calendar-icon" />}
              </span>
              <div>
                <p className="eyebrow">
                  {clientDialog.mode === "create" ? "Nowy kontakt" : "Ręczna rezerwacja"}
                </p>
                <h2>
                  {clientDialog.mode === "create" ? "Dodaj klienta" : manualBookingClient?.name}
                </h2>
              </div>
            </header>

            {clientDialog.mode === "create" ? (
              <>
                <div className="client-save-mode" aria-label="Sposób zapisu">
                  <button
                    className={clientSaveMode === "record" ? "active" : ""}
                    type="button"
                    onClick={() => {
                      setClientSaveMode("record");
                      setClientFeedback(null);
                    }}
                  >
                    Tylko zapisz
                  </button>
                  <button
                    className={clientSaveMode === "booking" ? "active" : ""}
                    type="button"
                    onClick={() => {
                      setClientSaveMode("booking");
                      setClientFeedback(null);
                    }}
                  >
                    Zapisz i umów
                  </button>
                </div>

                <div className="client-form-grid">
                  <label>
                    <span>Imię</span>
                    <input
                      type="text"
                      autoComplete="given-name"
                      value={clientDraft.firstName}
                      onChange={(event) =>
                        setClientDraft((current) => ({ ...current, firstName: event.target.value }))
                      }
                      placeholder="Jan"
                    />
                  </label>
                  <label>
                    <span>Nazwisko</span>
                    <input
                      type="text"
                      autoComplete="family-name"
                      value={clientDraft.lastName}
                      onChange={(event) =>
                        setClientDraft((current) => ({ ...current, lastName: event.target.value }))
                      }
                      placeholder="Kowalski"
                    />
                  </label>
                  <label>
                    <span>E-mail <small>opcjonalnie</small></span>
                    <input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={clientDraft.email}
                      onChange={(event) =>
                        setClientDraft((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="jan@gmail.com"
                    />
                  </label>
                  <label>
                    <span>Numer telefonu</span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      inputMode="tel"
                      value={clientDraft.phone}
                      onChange={(event) =>
                        setClientDraft((current) => ({
                          ...current,
                          phone: formatPhoneNumber(getPhoneDigits(event.target.value)),
                        }))
                      }
                      placeholder="500 000 000"
                    />
                  </label>
                </div>
              </>
            ) : (
              <div className="manual-client-recap">
                <span>{formatPhoneNumber(getPhoneDigits(manualBookingClient?.phone ?? ""))}</span>
                {manualBookingClient?.email ? <span>{manualBookingClient.email}</span> : null}
              </div>
            )}

            {clientDialog.mode === "book" || clientSaveMode === "booking" ? (
              <div className="manual-booking-section">
                <div className="manual-booking-heading">
                  <div>
                    <p className="section-label">Termin wizyty</p>
                    <strong>Dowolny dzień w kalendarzu</strong>
                  </div>
                  <span>Poza grafikiem</span>
                </div>
                <div className="manual-booking-grid">
                  <label className="service-field">
                    <span>Usługa</span>
                    <select
                      value={manualBookingDraft.serviceId}
                      onChange={(event) =>
                        setManualBookingDraft((current) => ({
                          ...current,
                          serviceId: event.target.value,
                        }))
                      }
                    >
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} · {service.price} · {service.durationMinutes} min
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Data</span>
                    <input
                      type="date"
                      min={dayKey(today)}
                      value={manualBookingDraft.dateKey}
                      onChange={(event) =>
                        setManualBookingDraft((current) => ({
                          ...current,
                          dateKey: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Godzina</span>
                    <input
                      type="time"
                      step="900"
                      value={manualBookingDraft.startTime}
                      onChange={(event) =>
                        setManualBookingDraft((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <div className={`manual-booking-status ${manualBookingHasConflict ? "conflict" : "free"}`}>
                  <span aria-hidden="true" />
                  {manualBookingHasConflict
                    ? "Termin koliduje z inną wizytą"
                    : "Termin jest wolny i może zostać zapisany"}
                </div>
              </div>
            ) : null}

            {clientFeedback ? (
              <div className={`client-dialog-feedback ${clientFeedback.kind}`} role="alert">
                {clientFeedback.message}
              </div>
            ) : null}

            <footer className="client-creator-footer">
              <button
                type="button"
                disabled={isClientSaving}
                onClick={() => {
                  setClientDialog(null);
                  setClientFeedback(null);
                }}
              >
                Anuluj
              </button>
              <button
                className="primary"
                type="button"
                disabled={
                  isClientSaving ||
                  (clientDialog.mode === "create" && !clientDraftIsValid) ||
                  ((clientDialog.mode === "book" || clientSaveMode === "booking") &&
                    manualBookingHasConflict)
                }
                onClick={() => void handleSaveClientFromDialog()}
              >
                {isClientSaving
                  ? "Zapisywanie..."
                  : clientDialog.mode === "book" || clientSaveMode === "booking"
                    ? "Zapisz wizytę"
                    : "Dodaj do bazy"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {selectedAdminClient && visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop admin-client-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedAdminClientId(null);
          }}
        >
          <section
            className="client-appointment-modal admin-client-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Karta klienta ${selectedAdminClient.name}`}
          >
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setSelectedAdminClientId(null)}
              aria-label="Zamknij kartę klienta"
            >
              ×
            </button>

            <header className="client-profile-header">
              <span className="client-profile-avatar">
                {selectedAdminClient.photoUrl ? (
                  <img src={selectedAdminClient.photoUrl} alt="" />
                ) : (
                  selectedAdminClient.name.slice(0, 1)
                )}
              </span>
              <div>
                <p className="eyebrow">Karta klienta</p>
                <h2>{selectedAdminClient.name}</h2>
                <span>
                  {selectedAdminClient.appointments.length} wizyt ·{" "}
                  {selectedAdminClient.nextAppointment
                    ? "ma kolejny termin"
                    : selectedAdminClient.appointments.length > 0
                      ? "tylko historia"
                      : "gotowy do umówienia"}
                </span>
              </div>
            </header>

            <div className="client-profile-contact">
              <div>
                <small>Telefon</small>
                <strong>
                  {getPhoneDigits(selectedAdminClient.phone).length === 9
                    ? formatPhoneNumber(getPhoneDigits(selectedAdminClient.phone))
                    : "Brak numeru"}
                </strong>
              </div>
              <div>
                <small>E-mail</small>
                <strong>{selectedAdminClient.email || "Brak adresu"}</strong>
              </div>
              <div className="client-profile-contact-actions">
                <button
                  className="book"
                  type="button"
                  onClick={() => openManualClientBooking(selectedAdminClient)}
                >
                  <span className="small-calendar-icon" aria-hidden="true" />
                  Umów
                </button>
                <button
                  className="sms-button"
                  type="button"
                  disabled={
                    getPhoneDigits(selectedAdminClient.phone).length !== 9 ||
                    selectedAdminClient.appointments.length === 0
                  }
                  onClick={() => {
                    const appointment =
                      selectedAdminClient.nextAppointment ?? selectedAdminClient.appointments.at(-1);
                    if (appointment) openSmsComposer(selectedAdminClient, appointment);
                  }}
                >
                  <span className="sms-icon" aria-hidden="true" />
                  SMS
                </button>
                {selectedAdminClient.email ? (
                  <a
                    href={`mailto:${selectedAdminClient.email}?subject=${encodeURIComponent("BNB Barbershop - Twoja wizyta")}`}
                  >
                    <span className="email-icon" aria-hidden="true" />
                    E-mail
                  </a>
                ) : null}
              </div>
            </div>

            <div className="client-history-heading">
              <div>
                <p className="section-label">Historia wizyt</p>
                <strong>Od najnowszej</strong>
              </div>
              {selectedAdminClient.rescheduledCount > 0 ? (
                <span>{selectedAdminClient.rescheduledCount} do potwierdzenia</span>
              ) : null}
            </div>

            <div className="client-history-list">
              {selectedAdminClient.appointments.length === 0 ? (
                <div className="client-profile-empty-history">
                  <strong>Brak wizyt w historii</strong>
                  <span>Klient jest już w bazie i możesz umówić jego pierwszy termin.</span>
                  <button type="button" onClick={() => openManualClientBooking(selectedAdminClient)}>
                    Umów pierwszą wizytę
                  </button>
                </div>
              ) : [...selectedAdminClient.appointments].reverse().map((appointment) => {
                const isPast = getAppointmentEndDateTime(appointment).getTime() <= currentDate.getTime();
                const isRescheduled =
                  normalizeAppointmentStatus(appointment.status) === "rescheduled";
                const isCompleted =
                  normalizeAppointmentStatus(appointment.status) === "completed";
                const settlementAvailable = canSettleAppointment(appointment, currentDate);
                const potentialNoShow = isPotentialNoShow(appointment, currentDate);

                return (
                  <article className="client-history-row" key={appointment.id}>
                    <div className="client-history-date">
                      <strong>{dateFromKey(appointment.dateKey).getDate()}</strong>
                      <span>{clientMonthFormatter.format(dateFromKey(appointment.dateKey))}</span>
                    </div>
                    <div className="client-history-main">
                      <strong>{appointment.serviceName}</strong>
                      <span>
                        {appointment.startTime} -{" "}
                        {addMinutesToTime(appointment.startTime, appointment.durationMinutes)} ·{" "}
                        {appointment.price}
                      </span>
                      <small>
                        {isCompleted
                          ? "Wizyta rozliczona"
                          : potentialNoShow
                            ? "Minęła bez rozliczenia"
                            : settlementAvailable
                              ? "Możesz już rozliczyć"
                              : "Nadchodząca wizyta"}
                      </small>
                    </div>
                    <em
                      className={`appointment-status ${
                        potentialNoShow ? "missed" : normalizeAppointmentStatus(appointment.status)
                      }`}
                    >
                      {potentialNoShow
                        ? "Nierozliczona"
                        : appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                    </em>
                    <div className="client-history-actions">
                      {settlementAvailable ? (
                        <button
                          className="settle"
                          type="button"
                          disabled={Boolean(settlingAppointmentId)}
                          onClick={() => void settleAdminAppointment(appointment)}
                        >
                          {settlingAppointmentId === appointment.id ? "Zapisywanie..." : "Rozlicz"}
                        </button>
                      ) : null}
                      {getPhoneDigits(selectedAdminClient.phone).length === 9 ? (
                        <button
                          type="button"
                          onClick={() => openSmsComposer(selectedAdminClient, appointment)}
                        >
                          SMS
                        </button>
                      ) : null}
                      {!isPast ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAdminClientId(null);
                            openAdminAppointmentEdit(appointment);
                          }}
                        >
                          Edytuj
                        </button>
                      ) : null}
                      {isRescheduled ? (
                        <button
                          className="confirm"
                          type="button"
                          disabled={isSaving}
                          onClick={() => {
                            void confirmClientRescheduledAppointment(appointment.id);
                          }}
                        >
                          Potwierdź
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {smsComposer && smsClient && smsAppointment && visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop sms-composer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSmsComposer(null);
          }}
        >
          <section
            className="client-appointment-modal sms-composer-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Nowa wiadomość SMS do ${smsClient.name}`}
          >
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setSmsComposer(null)}
              aria-label="Zamknij wiadomość SMS"
            >
              ×
            </button>
            <div className="sms-composer-heading">
              <span className="sms-composer-icon" aria-hidden="true">
                <span className="sms-icon" />
              </span>
              <div>
                <p className="eyebrow">Nowa wiadomość</p>
                <h2>{smsClient.name}</h2>
                <span>{formatPhoneNumber(getPhoneDigits(smsClient.phone))}</span>
              </div>
            </div>

            <label className="sms-appointment-select">
              <span>Wizyta</span>
              <select
                value={smsComposer.appointmentId}
                onChange={(event) => selectSmsAppointment(event.target.value)}
              >
                {[...smsClient.appointments].reverse().map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {adminClientDateFormatter.format(dateFromKey(appointment.dateKey))},{" "}
                    {appointment.startTime} · {appointment.serviceName}
                  </option>
                ))}
              </select>
            </label>

            <div className="sms-template-picker" aria-label="Szablon wiadomości">
              {smsTemplates.map((template) => (
                <button
                  className={smsComposer.template === template ? "active" : ""}
                  key={template}
                  type="button"
                  onClick={() => selectSmsTemplate(template)}
                  aria-pressed={smsComposer.template === template}
                >
                  {smsTemplateLabels[template]}
                </button>
              ))}
            </div>

            <label className="sms-message-field">
              <span>Treść wiadomości</span>
              <textarea
                value={smsComposer.message}
                maxLength={480}
                autoFocus
                onChange={(event) =>
                  setSmsComposer((current) =>
                    current ? { ...current, message: event.target.value } : current,
                  )
                }
              />
            </label>

            <div className="sms-composer-footer">
              <span>{smsComposer.message.length}/480 znaków</span>
              <a
                className={smsComposer.message.trim() ? "" : "disabled"}
                href={buildSmsHref(
                  getPhoneDigits(smsClient.phone),
                  smsComposer.message,
                )}
                aria-disabled={!smsComposer.message.trim()}
                onClick={(event) => {
                  if (!smsComposer.message.trim()) event.preventDefault();
                }}
              >
                Otwórz aplikację SMS
              </a>
            </div>
          </section>
        </div>
      ) : null}

      {selectedAdminEditAppointment && visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAdminEditAppointmentId(null);
          }}
        >
          <section
            className="client-appointment-modal admin-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edytuj wizytę klienta"
          >
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setAdminEditAppointmentId(null)}
              aria-label="Zamknij edycję wizyty"
            >
              ×
            </button>
            <div className="modal-title">
              <p className="eyebrow">Edycja wizyty</p>
              <h2>{selectedAdminEditAppointment.clientName}</h2>
            </div>

            <div className="admin-edit-recap">
              <span>{selectedAdminEditAppointment.serviceName}</span>
              <strong>
                {adminClientDateFormatter.format(dateFromKey(selectedAdminEditAppointment.dateKey))},{" "}
                {selectedAdminEditAppointment.startTime}
              </strong>
            </div>

            <div className="admin-edit-form">
              <label>
                Dzień
                <input
                  type="date"
                  min={dayKey(today)}
                  value={adminEditDraft.dateKey}
                  onChange={(event) =>
                    setAdminEditDraft((current) => ({
                      ...current,
                      dateKey: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Godzina
                <select
                  value={adminEditDraft.startTime}
                  onChange={(event) =>
                    setAdminEditDraft((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                >
                  {workTimeOptions.slice(0, -1).map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="modal-client-note">
              <strong>Ręczna zmiana admina</strong>
              <span>
                Możesz wybrać dzień bez dostępności publicznej. Klient zobaczy wizytę jako
                przesuniętą.
              </span>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                disabled={isSaving || !adminEditDraft.dateKey || !adminEditDraft.startTime}
                onClick={() => {
                  void saveAdminAppointmentEdit();
                }}
              >
                Zapisz zmianę
              </button>
              <button
                className="danger"
                type="button"
                disabled={isSaving}
                onClick={() => setAdminEditAppointmentId(null)}
              >
                Anuluj
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {clientAppointmentsListOpen && visibleStep !== "admin" ? (
        <div
          className="client-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setClientAppointmentsListOpen(false);
          }}
        >
          <section
            className="client-appointment-modal client-bottom-sheet appointment-list-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Wybierz swoją wizytę"
          >
            <div
              className="sheet-grabber"
              aria-hidden="true"
              onPointerDown={beginSheetGesture}
              onPointerUp={(event) =>
                endSheetGesture(event, () => setClientAppointmentsListOpen(false))
              }
              onPointerCancel={() => {
                sheetGestureRef.current = null;
              }}
            />
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setClientAppointmentsListOpen(false)}
              aria-label="Zamknij listę wizyt"
            >
              ×
            </button>
            <div className="modal-title">
              <p className="eyebrow">Twoje wizyty</p>
              <h2>Wybierz termin</h2>
            </div>

            <div className="client-appointment-list">
              {clientAppointments.map((appointment) => (
                <button
                  className="client-appointment-option"
                  key={appointment.id}
                  type="button"
                  onClick={() => {
                    setClientAppointmentId(appointment.id);
                    setClientAppointmentsListOpen(false);
                  }}
                >
                  <span>
                    <strong>{appointment.serviceName}</strong>
                    <small>
                      {dayFormatter.format(dateFromKey(appointment.dateKey))},{" "}
                      {appointment.startTime} -{" "}
                      {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}
                    </small>
                    <em className={`appointment-status ${normalizeAppointmentStatus(appointment.status)}`}>
                      {appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                    </em>
                  </span>
                  <b>{appointment.price}</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {selectedClientAppointment && visibleStep !== "admin" ? (
        <div
          className="client-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setClientAppointmentId(null);
          }}
        >
          <section
            className="client-appointment-modal client-bottom-sheet appointment-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Szczegóły Twojej wizyty"
          >
            <div
              className="sheet-grabber"
              aria-hidden="true"
              onPointerDown={beginSheetGesture}
              onPointerUp={(event) => endSheetGesture(event, () => setClientAppointmentId(null))}
              onPointerCancel={() => {
                sheetGestureRef.current = null;
              }}
            />
            <button
              className="modal-calendar-button calendar-save-button"
              type="button"
              onClick={() => {
                void addAppointmentToCalendar(selectedClientAppointment);
              }}
              aria-label="Dodaj tę wizytę do kalendarza"
              title="Dodaj tę wizytę do kalendarza"
            >
              <span aria-hidden="true" />
            </button>
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setClientAppointmentId(null)}
              aria-label="Zamknij szczegóły wizyty"
            >
              ×
            </button>
            <div className="modal-title">
              <p className="eyebrow">Twoja wizyta</p>
              <h2>{selectedClientAppointment.serviceName}</h2>
            </div>

            <div className="modal-details">
              <span>
                <small>Dzień</small>
                <strong>{dayFormatter.format(dateFromKey(selectedClientAppointment.dateKey))}</strong>
              </span>
              <span>
                <small>Godzina</small>
                <strong>
                  {selectedClientAppointment.startTime} -{" "}
                  {addMinutesToTime(
                    selectedClientAppointment.startTime,
                    selectedClientAppointment.durationMinutes,
                  )}
                </strong>
              </span>
              <span>
                <small>Czas trwania</small>
                <strong>{formatDuration(selectedClientAppointment.durationMinutes)}</strong>
              </span>
              <span>
                <small>Cena</small>
                <strong>{selectedClientAppointment.price}</strong>
              </span>
              <span>
                <small>Status</small>
                <strong>
                  {appointmentStatusLabels[normalizeAppointmentStatus(selectedClientAppointment.status)]}
                </strong>
              </span>
            </div>

            <div className="modal-client-note">
              <strong>{selectedClientAppointment.clientName}</strong>
              <span>
                {normalizeAppointmentStatus(selectedClientAppointment.status) === "rescheduled"
                  ? "Termin został przesunięty przez administratora. Jeśli nowa data Ci pasuje, potwierdź wizytę poniżej."
                  : "W razie zmiany planów możesz przesunąć termin albo odwołać wizytę."}
              </span>
            </div>

            <div
              className={`modal-actions ${
                normalizeAppointmentStatus(selectedClientAppointment.status) === "rescheduled"
                  ? "with-confirmation"
                  : ""
              }`}
            >
              {normalizeAppointmentStatus(selectedClientAppointment.status) === "rescheduled" ? (
                <button
                  className="confirm"
                  type="button"
                  disabled={isSaving}
                  onClick={() => confirmClientRescheduledAppointment(selectedClientAppointment.id)}
                >
                  Potwierdź nowy termin
                </button>
              ) : null}
              <button
                type="button"
                disabled={isSaving}
                onClick={() => beginClientReschedule(selectedClientAppointment)}
              >
                Zmień
              </button>
              <button
                className="danger"
                type="button"
                disabled={isSaving}
                onClick={() => setPendingClientCancellationId(selectedClientAppointment.id)}
              >
                Odwołaj wizytę
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingClientCancellation && visibleStep !== "admin" ? (
        <div
          className="client-modal-backdrop cancellation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingClientCancellationId(null);
          }}
        >
          <section
            className="client-appointment-modal client-bottom-sheet cancellation-sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancellation-title"
            aria-describedby="cancellation-description"
          >
            <div
              className="sheet-grabber"
              aria-hidden="true"
              onPointerDown={beginSheetGesture}
              onPointerUp={(event) =>
                endSheetGesture(event, () => setPendingClientCancellationId(null))
              }
              onPointerCancel={() => {
                sheetGestureRef.current = null;
              }}
            />
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setPendingClientCancellationId(null)}
              aria-label="Wróć bez odwoływania wizyty"
            >
              ×
            </button>
            <div className="modal-title">
              <p className="eyebrow">Potwierdzenie</p>
              <h2 id="cancellation-title">Odwołać wizytę?</h2>
            </div>
            <p className="cancellation-copy" id="cancellation-description">
              {pendingClientCancellation.serviceName}, {dayFormatter.format(
                dateFromKey(pendingClientCancellation.dateKey),
              )} o {pendingClientCancellation.startTime}. Tej operacji nie można cofnąć.
            </p>
            <div className="modal-actions cancellation-actions">
              <button type="button" onClick={() => setPendingClientCancellationId(null)}>
                Wróć
              </button>
              <button
                className="danger"
                type="button"
                disabled={isSaving}
                onClick={() => cancelClientAppointment(pendingClientCancellation.id)}
              >
                Odwołaj wizytę
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {visibleStep !== "admin" ? (
        <footer className="bottom-footer" aria-label="Akcja rezerwacji">
          <button
            className={footerClassName}
            type="button"
            disabled={footerDisabled}
            onClick={() => {
              if (visibleStep === "booking") {
                if (reschedulingAppointment) {
                  void saveClientReschedule();
                  return;
                }

                setStep("confirm");
                return;
              }

              if (visibleStep === "confirm") {
                void confirmBooking();
                return;
              }

              setSelectedTime("");
              setBookingSummary(null);
              setStep("booking");
            }}
          >
            {footerLabel}
          </button>
        </footer>
      ) : null}
    </main>
  );
}
