"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
type AdminSection = "schedule" | "clients" | "work" | "services";

type Service = {
  id: string;
  name: string;
  price: string;
  durationMinutes: number;
  order?: number;
};

type Appointment = {
  id: string;
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

type AppointmentStatus = "confirmed" | "rescheduled" | "cancelled";
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
  clientName: string;
  clientEmail?: string;
  clientPhotoUrl?: string;
  phone?: string;
  userId?: string;
  serviceName: string;
  price: string;
  color: AppointmentColor;
  status?: AppointmentStatus;
};

type AvailabilityWindow = {
  id: string;
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

const adminUserIds = new Set(["XxBe4dwVYWZPtl004J4tWq6AMZ73"]);
const maxStoredNotifications = 40;

const defaultServices: Service[] = [
  {
    id: "mens-haircut",
    name: "Strzyżenie męskie",
    price: "30 zł",
    durationMinutes: 90,
    order: 0,
  },
  {
    id: "beard-trim",
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
const adminClientDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});
const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  confirmed: "Potwierdzona",
  rescheduled: "Przesunięta",
  cancelled: "Odwołana",
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
  status === "rescheduled" || status === "cancelled" ? status : "confirmed";

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

const getPhoneDigits = (value: string) => value.replace(/\D/g, "").slice(0, 9);

const getServicePriceValue = (value: string) =>
  Number(value.trim().replace(",", ".").replace(/[^\d.]/g, ""));

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
  custom: "Custom",
};

const smsTemplates: SmsTemplate[] = ["confirmation", "reschedule", "reminder", "custom"];

const buildClientSmsMessage = (template: SmsTemplate, appointment: AdminAppointment) => {
  const date = adminClientDateFormatter.format(dateFromKey(appointment.dateKey));
  const visit = `${date} o ${appointment.startTime}`;

  if (template === "confirmation") {
    return `Siema! Potwierdzam Twoja wizyte: ${visit}. Usluga: ${appointment.serviceName}. Do zobaczenia!`;
  }

  if (template === "reschedule") {
    return `Siema! Zmienilem termin Twojej wizyty. Nowy termin: ${visit}. Usluga: ${appointment.serviceName}. W razie pytan odpisz na ta wiadomosc.`;
  }

  if (template === "reminder") {
    return `Siema! Przypominam o Twojej wizycie jutro, ${visit}. Usluga: ${appointment.serviceName}. Do zobaczenia!`;
  }

  return "";
};

const buildSmsHref = (phoneDigits: string, message: string) => {
  const cleanMessage = message.trim();

  return cleanMessage ? `sms:${phoneDigits}?body=${encodeURIComponent(cleanMessage)}` : `sms:${phoneDigits}`;
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

const normalizeWorkSettings = (value: Partial<WorkSettings> | null): WorkSettings => ({
  availability: value?.availability ?? {},
});

const normalizeServices = (value: Record<string, Partial<Service>> | null): Service[] => {
  const loadedServices = Object.entries(value ?? {})
    .map(([id, service], index) => ({
      id: service.id ?? id,
      name: service.name?.trim() || "Usługa",
      price: service.price?.trim() || "0 zł",
      durationMinutes: Number(service.durationMinutes) || 30,
      order: Number(service.order ?? index),
    }))
    .sort((first, second) => (first.order ?? 0) - (second.order ?? 0));

  return loadedServices.length > 0 ? loadedServices : defaultServices;
};

const servicesToRecord = (items: Service[]) =>
  Object.fromEntries(items.map((service, index) => [service.id, { ...service, order: index }]));

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
  const [services, setServices] = useState<Service[]>(defaultServices);
  const [selectedServiceId, setSelectedServiceId] = useState(defaultServices[0].id);
  const [selectedTime, setSelectedTime] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [adminAppointments, setAdminAppointments] = useState<AdminAppointment[]>([]);
  const [workSettings, setWorkSettings] = useState<WorkSettings>(defaultWorkSettings);
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
  const [adminEditAppointmentId, setAdminEditAppointmentId] = useState<string | null>(null);
  const [reschedulingAppointmentId, setReschedulingAppointmentId] = useState<string | null>(null);
  const [successReady, setSuccessReady] = useState(false);
  const [draggedAppointmentId, setDraggedAppointmentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);
  const [smsMenuDirections, setSmsMenuDirections] = useState<Record<string, "up" | "down">>({});
  const previousAppointmentsRef = useRef<Map<string, AdminAppointment> | null>(null);
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
  const isAdmin = Boolean(activeUser && adminUserIds.has(activeUser.uid));
  const reschedulingAppointment =
    adminAppointments.find((appointment) => appointment.id === reschedulingAppointmentId) ?? null;
  const schedulingAppointments = reschedulingAppointment
    ? appointments.filter((appointment) => appointment.id !== reschedulingAppointment.id)
    : appointments;
  const selectedService =
    services.find((item) => item.id === selectedServiceId) ?? services[0] ?? defaultServices[0];
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
                appointment.userId === activeUser.uid && appointment.dateKey >= dayKey(today),
            )
            .sort((first, second) => {
              if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
              return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
            })
        : [],
    [activeUser, adminAppointments, today],
  );
  const nearestClientAppointment = clientAppointments[0] ?? null;
  const selectedClientAppointment =
    clientAppointments.find((appointment) => appointment.id === clientAppointmentId) ?? null;
  const selectedAdminEditAppointment =
    adminAppointments.find((appointment) => appointment.id === adminEditAppointmentId) ?? null;
  const editingService = services.find((service) => service.id === editingServiceId) ?? null;
  const canContinue = Boolean(selectedServiceId && selectedKey && selectedTime);
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
    setNotificationPanelOpen(false);
    setActiveNotification(null);
    setNotifications(activeUser ? readStoredNotifications(activeUser.uid) : []);
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser) {
      setAppointments([]);
      setAdminAppointments([]);
      return undefined;
    }

    const appointmentsRef = ref(realtimeDb, "appointments");

    return onValue(appointmentsRef, (snapshot) => {
      const value = snapshot.val() as Record<string, Partial<AdminAppointment>> | null;
      const loadedAppointments = Object.entries(value ?? {})
        .map(([id, appointment]) => ({
          id: appointment.id ?? id,
          dateKey: appointment.dateKey ?? dayKey(today),
          startTime: appointment.startTime ?? "00:00",
          durationMinutes: Number(appointment.durationMinutes) || 30,
          clientName: appointment.clientName ?? "Klient",
          clientEmail: appointment.clientEmail ?? "",
          clientPhotoUrl: appointment.clientPhotoUrl ?? "",
          phone: appointment.phone ?? "",
          userId: appointment.userId ?? "",
          serviceName: appointment.serviceName ?? "Usługa",
          price: appointment.price ?? "0 zł",
          color: normalizeAppointmentColor(appointment.color),
          status: normalizeAppointmentStatus(appointment.status),
        }))
        .filter((appointment) => appointment.status !== "cancelled")
        .sort((first, second) => {
          if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
          return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        });

      setAdminAppointments(loadedAppointments);
      setAppointments(
        loadedAppointments.map(({ id, dateKey, startTime, durationMinutes }) => ({
          id,
          dateKey,
          startTime,
          durationMinutes,
        })),
      );
    });
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser) return;

    const previousAppointments = previousAppointmentsRef.current;
    const currentAppointments = new Map(adminAppointments.map((appointment) => [appointment.id, appointment]));

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
  }, [activeUser, adminAppointments, isAdmin, notifications]);

  useEffect(() => {
    if (!activeNotification) return undefined;

    const timer = window.setTimeout(() => setActiveNotification(null), 5200);
    return () => window.clearTimeout(timer);
  }, [activeNotification]);

  useEffect(() => {
    if (!activeUser) {
      setWorkSettings(defaultWorkSettings);
      return undefined;
    }

    const workSettingsRef = ref(realtimeDb, "workSettings");

    return onValue(workSettingsRef, (snapshot) => {
      setWorkSettings(normalizeWorkSettings(snapshot.val() as Partial<WorkSettings> | null));
    });
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser) {
      setServices(defaultServices);
      return undefined;
    }

    const servicesRef = ref(realtimeDb, "services");

    return onValue(servicesRef, (snapshot) => {
      const value = snapshot.val() as Record<string, Partial<Service>> | null;
      setServices(normalizeServices(value));

      if (!value && isAdmin) {
        void set(servicesRef, servicesToRecord(defaultServices));
      }
    });
  }, [activeUser, isAdmin]);

  useEffect(() => {
    if (selectedTime && !availableTimes.includes(selectedTime)) {
      setSelectedTime("");
    }
  }, [availableTimes, selectedTime]);

  useEffect(() => {
    if (!services.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(services[0]?.id ?? defaultServices[0].id);
      setSelectedTime("");
    }
  }, [selectedServiceId, services]);

  useEffect(() => {
    if (adminAppointmentDays.length === 0) return;
    if (!adminAppointmentDays.includes(adminSelectedKey)) {
      setAdminSelectedKey(adminAppointmentDays[0]);
    }
  }, [adminAppointmentDays, adminSelectedKey]);

  useEffect(() => {
    if (step === "admin" && !isAdmin) {
      setStep("booking");
    }
  }, [isAdmin, step]);

  useEffect(() => {
    if (visibleStep !== "success") return undefined;
    setSuccessReady(false);
    const timer = window.setTimeout(() => setSuccessReady(true), 3000);
    return () => window.clearTimeout(timer);
  }, [visibleStep]);

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

  const shiftMonth = (direction: -1 | 1) => {
    setVisibleMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + direction, 1),
    );
  };

  const selectNearestFreeSlot = () => {
    if (!nearestFreeSlot) return;

    setVisibleMonth(
      new Date(nearestFreeSlot.date.getFullYear(), nearestFreeSlot.date.getMonth(), 1),
    );
    setSelectedKey(nearestFreeSlot.dateKey);
    setSelectedTime(nearestFreeSlot.time);
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

  const addAvailabilityRange = () => {
    const availabilityUpdates = Object.fromEntries(
      getDateKeysInRange(availabilityDraft.start, availabilityDraft.end).map((key) => [
        key,
        {
          id: key,
          dateKey: key,
          startTime: availabilityDraft.startTime,
          endTime: availabilityDraft.endTime,
        },
      ]),
    );

    void update(ref(realtimeDb, "workSettings/availability"), availabilityUpdates);
  };

  const removeAvailabilityDate = (dateKeyValue: string) => {
    void remove(ref(realtimeDb, `workSettings/availability/${dateKeyValue}`));
  };

  const quickAddAvailability = (offset: number, startTime: string, endTime: string) => {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const key = dayKey(date);

    void set(ref(realtimeDb, `workSettings/availability/${key}`), {
      id: key,
      dateKey: key,
      startTime,
      endTime,
    });
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
      await set(ref(realtimeDb, "services"), servicesToRecord(nextServices));
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

    const nextServices = services.filter((service) => service.id !== serviceId);

    try {
      setIsSaving(true);
      await set(ref(realtimeDb, "services"), servicesToRecord(nextServices));
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
  };

  const cancelClientAppointment = (appointmentId: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
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

    try {
      setIsSaving(true);
      await update(ref(realtimeDb, `appointments/${appointmentId}`), {
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
    const appointmentColor = getNextAppointmentColor(selectedDayKey, adminAppointments);
    const adminAppointment: AdminAppointment = {
      id: appointmentId,
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
      await set(ref(realtimeDb, `appointments/${appointmentId}`), adminAppointment);
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

    void remove(ref(realtimeDb, `appointments/${appointmentId}`)).then(() => {
      if (appointment) {
        void sendAppointmentNotification("admin_cancelled", appointment);
      }
    });
  };

  const footerLabel =
    visibleStep === "booking"
      ? reschedulingAppointment
        ? "Zapisz zmianę"
        : "Dalej"
      : visibleStep === "confirm"
        ? "Potwierdź"
        : "Gotowe";
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
  const updateSmsMenuDirection = (appointmentId: string, trigger: HTMLElement) => {
    const row = trigger.closest(".client-row");
    const list = trigger.closest(".clients-view");
    const rowRect = row?.getBoundingClientRect();
    const listRect = list?.getBoundingClientRect();
    const estimatedMenuHeight = 190;
    const spaceBelow = listRect && rowRect ? listRect.bottom - rowRect.bottom : estimatedMenuHeight;
    const spaceAbove = listRect && rowRect ? rowRect.top - listRect.top : 0;
    const direction = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow ? "up" : "down";

    setSmsMenuDirections((current) =>
      current[appointmentId] === direction ? current : { ...current, [appointmentId]: direction },
    );
  };
  const notificationButton = (
    <button
      className={`notification-bell ${notifications.length > 0 ? "has-items" : ""}`}
      type="button"
      onClick={() => setNotificationPanelOpen((isOpen) => !isOpen)}
      aria-label="Otwórz listę powiadomień"
      aria-expanded={notificationPanelOpen}
    >
      <span aria-hidden="true">🔔</span>
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
            <p className="eyebrow">Rezerwacje online</p>
            <h1>Zaloguj się, żeby umówić wizytę</h1>
            <p className="auth-copy">
              Po zalogowaniu przypiszemy wizytę do Twojego konta. Dzięki temu później
              będziesz mógł wrócić do swoich rezerwacji.
            </p>
          </div>

          <div className="auth-benefits" aria-label="Co daje logowanie">
            <span>Twoje terminy w jednym miejscu</span>
            <span>Łatwiejsze przesunięcie wizyty</span>
            <span>Bez podglądu cudzych rezerwacji</span>
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
            <button className="back-button" type="button" onClick={() => setStep("booking")}>
              ‹ Wróć
            </button>
            <div>
              <p className="eyebrow">Admin</p>
              <h1>
                {adminSection === "schedule"
                  ? "Terminarz"
                  : adminSection === "clients"
                    ? "Klienci"
                    : adminSection === "work"
                      ? "Praca"
                      : "Usługi"}
              </h1>
            </div>
            {notificationButton}
          </div>

          <div className="admin-content-frame">
            <div className={`admin-tab-panel ${adminSection === "schedule" ? "active" : ""}`}>
              <div className="admin-section-header">
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
              </div>

              <div className="schedule-desktop-grid">
                <aside className="schedule-side-panel">
                  <div className="admin-days" aria-label="Dni z wizytami">
                    {adminAppointmentDays.length > 0 ? (
                      adminAppointmentDays.map((key) => {
                        const date = dateFromKey(key);
                        const appointmentsCount = adminAppointments.filter(
                          (appointment) => appointment.dateKey === key,
                        ).length;

                        return (
                          <button
                            className={key === adminSelectedKey ? "active" : ""}
                            key={key}
                            type="button"
                            onClick={() => setAdminSelectedKey(key)}
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
                              {" - "}
                              {appointmentsCount}
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
                        <button className="client-chip" key={appointment.id} type="button">
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
                          draggable
                          key={appointment.id}
                          onDragStart={() => setDraggedAppointmentId(appointment.id)}
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
                              className="decline-button"
                              type="button"
                              onClick={() => declineAdminAppointment(appointment.id)}
                              aria-label={`Odmów wizytę ${appointment.clientName}`}
                            >
                              Odmów
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className={`admin-tab-panel ${adminSection === "clients" ? "active" : ""}`}>
              <div className="admin-section-header">
                <div>
                  <p className="eyebrow">Kontakty</p>
                  <h2>Klienci z rezerwacji</h2>
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie klientów">
                  <span>
                    <strong>{adminClientAppointments.length}</strong>
                    zapisów
                  </span>
                  <span>
                    <strong>
                      {
                        new Set(
                          adminClientAppointments
                            .map(
                              (appointment) =>
                                getPhoneDigits(appointment.phone ?? "") ||
                                appointment.clientName.trim().toLowerCase(),
                            )
                            .filter(Boolean),
                        ).size
                      }
                    </strong>
                    klientów
                  </span>
                </div>
              </div>

              <div className="clients-view" aria-label="Lista klientów">
                {adminClientAppointments.length > 0 ? (
                  adminClientAppointments.map((appointment) => {
                    const phoneDigits = getPhoneDigits(appointment.phone ?? "");
                    const hasPhone = phoneDigits.length === 9;
                    const isRescheduled =
                      normalizeAppointmentStatus(appointment.status) === "rescheduled";

                    return (
                      <article className="client-row" key={appointment.id}>
                        <div className="client-row-avatar">
                          {appointment.clientName.slice(0, 1)}
                        </div>
                        <button
                          className="client-row-main client-row-edit"
                          type="button"
                          onClick={() => openAdminAppointmentEdit(appointment)}
                          aria-label={`Edytuj wizytę ${appointment.clientName}`}
                        >
                          <strong>{appointment.clientName}</strong>
                          <span>
                            {adminClientDateFormatter.format(dateFromKey(appointment.dateKey))},{" "}
                            {appointment.startTime} · {appointment.serviceName}
                          </span>
                          <small>{hasPhone ? formatPhoneNumber(phoneDigits) : "Brak numeru"}</small>
                          <em className={`appointment-status ${normalizeAppointmentStatus(appointment.status)}`}>
                            {appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                          </em>
                        </button>
                        {isRescheduled ? (
                          <button
                            className="client-confirm-button"
                            type="button"
                            disabled={isSaving}
                            onClick={() => {
                              void confirmClientRescheduledAppointment(appointment.id);
                            }}
                          >
                            Potwierdz
                          </button>
                        ) : null}
                        {hasPhone ? (
                          <details
                            className={`sms-menu ${smsMenuDirections[appointment.id] === "up" ? "drop-up" : ""}`}
                          >
                            <summary
                              className="sms-button"
                              onClick={(event) => updateSmsMenuDirection(appointment.id, event.currentTarget)}
                              aria-label={`Wyślij SMS do ${appointment.clientName}`}
                            >
                              💬
                            </summary>
                            <div className="sms-template-list">
                              {smsTemplates.map((template) => (
                                <a
                                  key={template}
                                  href={buildSmsHref(phoneDigits, buildClientSmsMessage(template, appointment))}
                                >
                                  {smsTemplateLabels[template]}
                                </a>
                              ))}
                            </div>
                          </details>
                        ) : (
                          <span className="sms-button disabled" aria-label="Brak numeru telefonu">
                            💬
                          </span>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <p className="clients-empty-state">Brak klientów do wyświetlenia.</p>
                )}
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
                <section className="work-editor-card availability-maker">
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">Nowa dostępność</p>
                      <h2>Okienko w kalendarzu</h2>
                    </div>
                  </div>

                  <div className="work-preset-grid">
                    {[
                      { label: "Po pracy", startTime: "17:00", endTime: "20:00" },
                      { label: "Wolne rano", startTime: "10:00", endTime: "13:00" },
                      { label: "Krótko", startTime: "18:00", endTime: "19:30" },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          setAvailabilityDraft((current) => ({
                            ...current,
                            startTime: preset.startTime,
                            endTime: preset.endTime,
                          }))
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
                    <span>
                      Dodasz {getDateKeysInRange(availabilityDraft.start, availabilityDraft.end).length}{" "}
                      {getDateKeysInRange(availabilityDraft.start, availabilityDraft.end).length === 1
                        ? "dzień"
                        : "dni"}{" "}
                      od {availabilityDraft.startTime} do {availabilityDraft.endTime}
                    </span>
                    <button type="button" onClick={addAvailabilityRange}>
                      Dodaj dostępność
                    </button>
                  </div>
                </section>

                <section className="work-editor-card">
                  <div className="work-editor-top">
                    <div>
                      <p className="eyebrow">Szybkie dodawanie</p>
                      <h2>Gotowe okienka</h2>
                    </div>
                  </div>

                  <div className="quick-availability-list">
                    <button type="button" onClick={() => quickAddAvailability(1, "17:00", "20:00")}>
                      <strong>Jutro</strong>
                      <span>17:00 - 20:00</span>
                    </button>
                    <button type="button" onClick={() => quickAddAvailability(2, "10:00", "13:00")}>
                      <strong>Za 2 dni</strong>
                      <span>10:00 - 13:00</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => quickAddAvailability(nextSaturdayOffset, "09:00", "14:00")}
                    >
                      <strong>Weekend</strong>
                      <span>09:00 - 14:00</span>
                    </button>
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
                                  <button
                                    type="button"
                                    onClick={() => removeAvailabilityDate(windowItem.dateKey)}
                                  >
                                    Usuń
                                  </button>
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
              <span>Klienci</span>
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
          </nav>
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
                  <h1>Umów wizytę</h1>
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

            <div className="calendar-header">
              <div>
                <p className="section-label">Kalendarz</p>
                <h2>{monthFormatter.format(visibleMonth)}</h2>
              </div>
              <div className="month-controls" aria-label="Zmiana miesiąca">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Poprzedni miesiąc">
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

            <section className="client-visit-panel" aria-label="Twoja wizyta">
              <div className="client-visit-heading">
                <p className="section-label">Twoja wizyta</p>
                {clientAppointments.length > 1 ? <span>{clientAppointments.length}</span> : null}
              </div>

              {reschedulingAppointment ? (
                <div className="client-visit-card editing">
                  <div>
                    <strong>Zmieniasz termin</strong>
                    <span>
                      Wybierz nowy dzień i godzinę dla usługi{" "}
                      {reschedulingAppointment.serviceName}.
                    </span>
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
                  onClick={() => {
                    if (clientAppointments.length > 1) {
                      setClientAppointmentsListOpen(true);
                      return;
                    }

                    setClientAppointmentId(nearestClientAppointment.id);
                  }}
                >
                  <span>
                    <strong>{nearestClientAppointment.serviceName}</strong>
                    <small>
                      {dayFormatter.format(dateFromKey(nearestClientAppointment.dateKey))},{" "}
                      {nearestClientAppointment.startTime} -{" "}
                      {addMinutesToTime(
                        nearestClientAppointment.startTime,
                        nearestClientAppointment.durationMinutes,
                      )}
                    </small>
                    <em className={`appointment-status ${normalizeAppointmentStatus(nearestClientAppointment.status)}`}>
                      {appointmentStatusLabels[normalizeAppointmentStatus(nearestClientAppointment.status)]}
                    </em>
                  </span>
                  <b>{nearestClientAppointment.price}</b>
                </button>
              ) : (
                <div className="client-visit-empty">
                  <strong>Nie masz zaplanowanej wizyty</strong>
                  <span>Wybierz usługę, dzień i godzinę, żeby dodać pierwszą rezerwację.</span>
                </div>
              )}
            </section>
          </section>

          <aside className="day-summary" aria-label="Szczegóły rezerwacji">
            <div className="summary-block">
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

            <div className="summary-heading">
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
            <p className="eyebrow">BNB Barbershop</p>
            <h1>Wypełnij i potwierdź</h1>
          </div>

          <div className="booking-recap" aria-label="Podsumowanie wyboru">
            <span>{selectedService.name}</span>
            <strong>{selectedService.price}</strong>
            <span>
              {dayFormatter.format(selectedDay.date)}, {selectedTime} ·{" "}
              {formatDuration(selectedService.durationMinutes)}
            </span>
          </div>

          <form className="confirm-form">
            <label>
              Imię i nazwisko
              <input
                type="text"
                value={form.fullName}
                onChange={(event) => updateForm("fullName", event.target.value)}
                autoComplete="name"
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
        <aside className="notification-panel" aria-label="Lista powiadomień">
          <div className="notification-panel-header">
            <strong>Powiadomienia</strong>
            <button type="button" onClick={() => setNotificationPanelOpen(false)} aria-label="Zamknij">
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
      ) : null}

      {activeNotification ? (
        <div className="notification-toast" role="status" aria-live="polite">
          <strong>{activeNotification.title}</strong>
          <span>{activeNotification.body}</span>
        </div>
      ) : null}

      {selectedAdminEditAppointment && visibleStep === "admin" ? (
        <div className="client-modal-backdrop" role="presentation">
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
        <div className="client-modal-backdrop" role="presentation">
          <section
            className="client-appointment-modal appointment-list-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Wybierz swoją wizytę"
          >
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
        <div className="client-modal-backdrop" role="presentation">
          <section
            className="client-appointment-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Szczegóły Twojej wizyty"
          >
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
                  Potwierdzam
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
                onClick={() => cancelClientAppointment(selectedClientAppointment.id)}
              >
                Odmów
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
