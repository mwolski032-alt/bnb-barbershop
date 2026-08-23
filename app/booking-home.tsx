"use client";

import {
  useCallback,
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
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { onValue, ref, serverTimestamp, set, update } from "firebase/database";
import {
  Apple,
  ArrowLeft,
  BarChart3,
  Bell,
  BellRing,
  Bot,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock,
  Clock3,
  Compass,
  Download,
  EllipsisVertical,
  Mail,
  MessageSquare,
  Phone,
  Scissors,
  Share2,
  Smartphone,
  SquarePlus,
  Trash2,
  Users,
  UsersRound,
  X,
} from "lucide-react";

import { firebaseApp, realtimeDb } from "./lib/firebase";
import {
  AppointmentApiError,
  createAppointmentOperationId,
  fetchClientAppointmentData,
  mutateAppointment,
  type AppointmentApiResult,
  type AppointmentMutationAction,
} from "./lib/appointments";
import {
  disablePushNotifications,
  getPushNotificationDeviceStatus,
  isPushNotificationsLocallyDisabled,
  listenForForegroundPushNotifications,
  registerPushNotifications,
  type PushDeviceStatus,
} from "./lib/notifications";
import {
  isServiceCatalogReady,
  resolveActiveBarberId,
  shouldApplyAppointmentSnapshot,
} from "../shared/appointment-sync.mjs";
import {
  formatNearestAppointmentLabel,
  selectNearestAppointments,
} from "../shared/appointment-label.mjs";
import {
  getGoogleSignInErrorMessage,
  shouldFallbackToRedirect,
  shouldUseRedirectSignIn,
} from "../shared/auth-flow.mjs";
import { isBookableStartTime } from "../shared/booking-time.mjs";

type Availability = "high" | "medium" | "low" | "none";
type Step = "booking" | "confirm" | "success" | "admin";
type BarberAdminSection =
  | "schedule"
  | "clients"
  | "analytics"
  | "work"
  | "services"
  | "profile";
type AdminSection = Exclude<BarberAdminSection, "clients"> | "team";
type StandaloneAdminSection = Exclude<BarberAdminSection, "schedule" | "clients">;
type AdminWorkspaceTab = "upcoming" | "schedule" | "clients";

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
  version?: number;
  lastOperationId?: string;
  createdAt?: number;
  updatedAt?: number;
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

type AppointmentStatus = "confirmed" | "rescheduled" | "cancelled" | "completed" | "no_show";
type AppointmentColor = "blue" | "mint" | "pink" | "violet" | "amber" | "coral" | "sky" | "lime";

type BookingSummary = {
  barberId: string;
  barberName: string;
  barberPhotoUrl: string;
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
  serviceId?: string;
  clientName: string;
  clientEmail?: string;
  clientPhotoUrl?: string;
  phone?: string;
  userId?: string;
  serviceName: string;
  price: string;
  color: AppointmentColor;
  status?: AppointmentStatus;
  rescheduledAt?: number;
  rescheduledBy?: "client" | "admin";
  confirmedAt?: number;
  confirmedBy?: "client" | "admin";
  noShowAt?: number;
  noShowBy?: "admin";
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

type SessionContext = {
  role: "owner" | "barber" | "client";
  assignedRole?: "barber";
  active: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  barberId: string;
  access: Record<BarberAdminSection, boolean>;
  roleError?: "conflicting_barber_assignment";
};

type SmsTemplate = "confirmation" | "reschedule" | "reminder" | "custom";
type ClientFilter = "all" | "upcoming" | "rescheduled" | "missing-phone";
type ClientWorkspaceTab = "appointments" | "directory";
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
  hiddenFromDirectory: boolean;
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
  hiddenFor?: Record<string, boolean>;
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
  | { mode: "create"; waitlistEntryId?: string }
  | { mode: "book"; clientId: string; waitlistEntryId?: string };

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
type WaitlistTimePreference = "any" | "morning" | "afternoon" | "evening";

type WaitlistOffer = {
  dateKey: string;
  startTime: string;
  barberId: string;
  serviceId: string;
  serviceName: string;
  price: string;
  durationMinutes: number;
  offeredAt: number;
  expiresAt: number;
};

type WaitlistEntry = {
  id: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  phone: string;
  barberId: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  dateFrom: string;
  dateTo: string;
  timePreference: WaitlistTimePreference;
  status: "waiting" | "offered";
  offer?: WaitlistOffer | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

type WaitlistDraft = {
  dateFrom: string;
  dateTo: string;
  timePreference: WaitlistTimePreference;
  clientName: string;
  phone: string;
};

type PendingWaitlistSelection = {
  waitlistId: string;
  barberId: string;
  serviceId: string;
  dateKey: string;
  startTime: string;
};

type BarberProfile = {
  id: string;
  name: string;
  label: string;
  accent: "blue" | "mint";
  userId: string;
  email: string;
  active: boolean;
  access: Record<BarberAdminSection, boolean>;
  createdAt?: number;
  updatedAt?: number;
};

type TeamMemberDraft = {
  name: string;
  email: string;
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

type ProfileAvatarProps = {
  className: string;
  name: string;
  photoUrl?: string | null;
  alt?: string;
};

const barberAdminSections: BarberAdminSection[] = [
  "schedule",
  "clients",
  "analytics",
  "work",
  "services",
  "profile",
];
const standaloneAdminSections: StandaloneAdminSection[] = ["analytics", "work", "services", "profile"];
const fullBarberAccess: Record<BarberAdminSection, boolean> = {
  schedule: true,
  clients: true,
  analytics: true,
  work: true,
  services: true,
  profile: true,
};
const noBarberAccess: Record<BarberAdminSection, boolean> = {
  schedule: false,
  clients: false,
  analytics: false,
  work: false,
  services: false,
  profile: false,
};
const emptyBarberDetails: BarberDetails = {
  displayName: "",
  phone: "",
  email: "",
  instagram: "",
  bio: "",
  photoUrl: "",
};

const waitlistTimePreferenceLabels: Record<WaitlistTimePreference, string> = {
  any: "Dowolna pora",
  morning: "Rano · do 12:00",
  afternoon: "Popołudnie · 12:00–17:00",
  evening: "Wieczór · od 17:00",
};

function ProfileAvatar({ className, name, photoUrl, alt = "" }: ProfileAvatarProps) {
  const [failedPhotoUrl, setFailedPhotoUrl] = useState("");
  const normalizedPhotoUrl = photoUrl?.trim() ?? "";
  const showPhoto = Boolean(normalizedPhotoUrl && failedPhotoUrl !== normalizedPhotoUrl);
  const initial = name.trim().slice(0, 1).toLocaleUpperCase("pl") || "?";

  return (
    <span className={`profile-avatar ${className}`}>
      {showPhoto ? (
        <img
          src={normalizedPhotoUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedPhotoUrl(normalizedPhotoUrl)}
        />
      ) : (
        <span className="profile-avatar-fallback" aria-hidden={alt ? undefined : true}>
          {initial}
        </span>
      )}
    </span>
  );
}

const unavailableService: Service = {
  id: "",
  barberId: "",
  name: "Brak dostępnej usługi",
  price: "",
  durationMinutes: 30,
  order: 0,
};

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
  no_show: "Nieobecność",
};

const adminSectionLabels: Record<AdminSection, string> = {
  schedule: "Terminy",
  analytics: "Analiza",
  work: "Praca",
  services: "Usługi",
  profile: "Profil",
  team: "Zespół",
};

const teamAccessLabels: Record<BarberAdminSection, string> = {
  schedule: "Terminarz",
  clients: "Baza klientów",
  analytics: "Analiza",
  work: "Praca",
  services: "Usługi",
  profile: "Profil",
};

const adminNavigationLabels: Record<AdminSection, string> = {
  schedule: "Terminy",
  analytics: "Analiza",
  work: "Praca",
  services: "Usługi",
  profile: "Profil",
  team: "Zespół",
};

const adminNavigationIcons = {
  schedule: CalendarDays,
  analytics: BarChart3,
  work: Clock3,
  services: Scissors,
  profile: CircleUserRound,
  team: UsersRound,
} satisfies Record<AdminSection, typeof CalendarDays>;

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
  status === "rescheduled" || status === "cancelled" || status === "completed" || status === "no_show"
    ? status
    : "confirmed";

const isClosedAppointmentStatus = (status?: string) =>
  ["cancelled", "completed", "no_show"].includes(normalizeAppointmentStatus(status));

const isVisibleInClientDatabase = (status?: string) =>
  !["cancelled", "no_show"].includes(normalizeAppointmentStatus(status));

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

const shiftDateKey = (key: string, days: number) => {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dayKey(date);
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
  Number.isFinite(Number(appointment.settlement?.amount))
    ? Number(appointment.settlement?.amount)
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
    `Barber: ${summary.barberName}`,
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
  barberId: appointment.barberId,
  barberName:
    "Barber",
  barberPhotoUrl: "",
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
  if (isClosedAppointmentStatus(appointment.status)) {
    return false;
  }
  const settlementAvailableAt = getAppointmentDateTime(appointment);
  settlementAvailableAt.setMinutes(settlementAvailableAt.getMinutes() + 1);
  return now.getTime() >= settlementAvailableAt.getTime();
};

const isPotentialNoShow = (appointment: AdminAppointment, now: Date) =>
  !isClosedAppointmentStatus(appointment.status) &&
  now.getTime() > getAppointmentEndDateTime(appointment).getTime();

const getCalendarAppointmentState = (appointment: AdminAppointment, now: Date) => {
  const status = normalizeAppointmentStatus(appointment.status);
  if (status === "no_show") return { className: "no-show", label: "Nieobecność" };
  if (status === "completed") return { className: "completed", label: "Rozliczona" };
  if (isPotentialNoShow(appointment, now)) {
    return { className: "missed", label: "Nierozliczona" };
  }
  if (status === "rescheduled" && appointment.rescheduledBy !== "admin") {
    return { className: "settlement-due", label: "Do potwierdzenia" };
  }
  if (canSettleAppointment(appointment, now)) {
    return { className: "settlement-due", label: "Do rozliczenia" };
  }
  return { className: status, label: appointmentStatusLabels[status] };
};

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

const normalizeServices = (
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

const servicesToRecord = (items: Service[], barberId: string) =>
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

const normalizeBarberAccess = (
  value: Partial<Record<BarberAdminSection, boolean>> | null | undefined,
): Record<BarberAdminSection, boolean> =>
  Object.fromEntries(
    barberAdminSections.map((section) => [section, value?.[section] === true]),
  ) as Record<BarberAdminSection, boolean>;

const normalizeTeamMember = (
  id: string,
  value: Partial<BarberProfile> | null,
  index: number,
): BarberProfile => ({
  id,
  name: value?.name?.trim() || `Barber ${index + 1}`,
  label: value?.label?.trim() || `Barber ${index + 1}`,
  accent: value?.accent === "mint" ? "mint" : index % 2 === 0 ? "blue" : "mint",
  userId: value?.userId?.trim() ?? "",
  email: value?.email?.trim().toLocaleLowerCase("pl") ?? "",
  active: value?.active === true,
  access: normalizeBarberAccess(value?.access),
  createdAt: Number(value?.createdAt) || undefined,
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
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  const targetSize = Math.max(1, Math.min(512, sourceSize));
  const canvas = document.createElement("canvas");
  canvas.width = targetSize;
  canvas.height = targetSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nie udało się przygotować zdjęcia.");
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    targetSize,
    targetSize,
  );
  return canvas.toDataURL("image/webp", 0.86);
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
  now: Date,
) =>
  timeSlots.filter(
    (time) =>
      isBookableStartTime(dateKeyValue, time, now) &&
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

const availabilityLabel: Record<Availability, string> = {
  high: "Dużo wolnych godzin",
  medium: "Średnia dostępność",
  low: "Bardzo mało godzin",
  none: "Brak terminów",
};

const pushDeviceStatusLabel: Record<PushDeviceStatus, string> = {
  checking: "Sprawdzanie powiadomień",
  enabled: "Powiadomienia włączone na tym urządzeniu",
  disabled: "Powiadomienia wyłączone na tym urządzeniu",
  blocked: "Powiadomienia zablokowane w ustawieniach urządzenia",
  unsupported: "Powiadomienia niedostępne na tym urządzeniu",
  error: "Nie udało się sprawdzić powiadomień",
};

type InstallPlatform = "ios" | "android";
type InstallGuideIcon =
  | "safari"
  | "share"
  | "add"
  | "done"
  | "chrome"
  | "menu"
  | "download";

const installGuideSteps: Record<
  InstallPlatform,
  Array<{ title: string; description: string; icon: InstallGuideIcon }>
> = {
  ios: [
    {
      title: "Otwórz stronę w Safari",
      description: "Instrukcja instalacji na iPhonie i iPadzie działa bezpośrednio w Safari.",
      icon: "safari",
    },
    {
      title: "Naciśnij Udostępnij",
      description: "Na dole ekranu wybierz ikonę kwadratu ze strzałką skierowaną do góry.",
      icon: "share",
    },
    {
      title: "Dodaj do ekranu początkowego",
      description: "Przewiń listę działań i wybierz opcję „Do ekranu początkowego”.",
      icon: "add",
    },
    {
      title: "Potwierdź przyciskiem Dodaj",
      description: "Ikona BNB pojawi się na ekranie głównym i będzie otwierać aplikację pełnoekranowo.",
      icon: "done",
    },
  ],
  android: [
    {
      title: "Otwórz stronę w Chrome",
      description: "Na telefonie z Androidem otwórz stronę BNB w przeglądarce Google Chrome.",
      icon: "chrome",
    },
    {
      title: "Otwórz menu Chrome",
      description: "Naciśnij trzy kropki w prawym górnym rogu przeglądarki.",
      icon: "menu",
    },
    {
      title: "Wybierz instalację",
      description: "Naciśnij „Zainstaluj aplikację” lub „Dodaj do ekranu głównego”.",
      icon: "download",
    },
    {
      title: "Potwierdź instalację",
      description: "Po potwierdzeniu ikona BNB pojawi się na ekranie głównym telefonu.",
      icon: "done",
    },
  ],
};

function ChromeBrandIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#ea4335" d="M12 12 3.34 7A10 10 0 0 1 20.66 7Z" />
      <path fill="#34a853" d="m12 12 8.66-5A10 10 0 0 1 12 22Z" />
      <path fill="#fbbc05" d="m12 12v10A10 10 0 0 1 3.34 7Z" />
      <circle cx="12" cy="12" r="4.55" fill="#fff" />
      <circle cx="12" cy="12" r="3.75" fill="#4285f4" />
    </svg>
  );
}

function InstallStepGraphic({ icon }: { icon: InstallGuideIcon }) {
  if (icon === "chrome") return <ChromeBrandIcon className="install-guide-step-svg" />;
  if (icon === "safari") return <Compass aria-hidden="true" />;
  if (icon === "share") return <Share2 aria-hidden="true" />;
  if (icon === "add") return <SquarePlus aria-hidden="true" />;
  if (icon === "menu") return <EllipsisVertical aria-hidden="true" />;
  if (icon === "download") return <Download aria-hidden="true" />;
  return <CheckCircle2 aria-hidden="true" />;
}

function InstallGuideDialog({ onClose }: { onClose: () => void }) {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyboard);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const steps = platform ? installGuideSteps[platform] : [];
  const currentStep = steps[stepIndex];
  const returnToPlatformChoice = () => {
    setPlatform(null);
    setStepIndex(0);
  };
  const goBack = () => {
    if (stepIndex === 0) {
      returnToPlatformChoice();
    } else {
      setStepIndex((current) => current - 1);
    }
  };

  return (
    <div
      className="install-guide-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="install-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-title"
      >
        <div className="install-guide-grabber" aria-hidden="true" />
        <button className="install-guide-close" type="button" onClick={onClose} aria-label="Zamknij">
          <X aria-hidden="true" />
        </button>

        {!platform ? (
          <>
            <header className="install-guide-heading">
              <span className="install-guide-heading-icon" aria-hidden="true">
                <Smartphone />
              </span>
              <div>
                <p className="eyebrow">Szybka instalacja</p>
                <h2 id="install-guide-title">Wybierz swój telefon</h2>
              </div>
            </header>
            <p className="install-guide-lead">
              Pokażemy dokładnie, gdzie nacisnąć. Instalacja zajmie mniej niż minutę.
            </p>
            <div className="install-platform-list">
              <button
                className="install-platform-option"
                type="button"
                onClick={() => {
                  setPlatform("ios");
                  setStepIndex(0);
                }}
              >
                <span className="install-platform-logo ios" aria-hidden="true">
                  <Apple />
                </span>
                <span className="install-platform-copy">
                  <strong>iPhone lub iPad</strong>
                  <small>Instrukcja dla Safari</small>
                </span>
                <span className="install-platform-browser safari" aria-hidden="true">
                  <Compass />
                </span>
                <ChevronRight className="install-platform-chevron" aria-hidden="true" />
              </button>
              <button
                className="install-platform-option"
                type="button"
                onClick={() => {
                  setPlatform("android");
                  setStepIndex(0);
                }}
              >
                <span className="install-platform-logo android" aria-hidden="true">
                  <Bot />
                </span>
                <span className="install-platform-copy">
                  <strong>Telefon z Androidem</strong>
                  <small>Instrukcja dla Chrome</small>
                </span>
                <span className="install-platform-browser" aria-hidden="true">
                  <ChromeBrandIcon />
                </span>
                <ChevronRight className="install-platform-chevron" aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <div className="install-guide-step" aria-live="polite">
            <div className="install-guide-step-topline">
              <button className="install-guide-back" type="button" onClick={goBack}>
                <ArrowLeft aria-hidden="true" />
                Wstecz
              </button>
              <span>{platform === "ios" ? "iPhone / Safari" : "Android / Chrome"}</span>
            </div>
            <div className="install-guide-progress" aria-label={`Krok ${stepIndex + 1} z ${steps.length}`}>
              {steps.map((step, index) => (
                <span
                  className={index <= stepIndex ? "active" : ""}
                  key={step.title}
                  aria-hidden="true"
                />
              ))}
            </div>
            <span className={`install-guide-step-icon ${currentStep.icon}`} aria-hidden="true">
              <InstallStepGraphic icon={currentStep.icon} />
            </span>
            <p className="install-guide-step-counter">
              Krok {stepIndex + 1} z {steps.length}
            </p>
            <h2 id="install-guide-title">{currentStep.title}</h2>
            <p className="install-guide-step-description">{currentStep.description}</p>
            <div className="install-guide-actions">
              <button className="install-guide-secondary" type="button" onClick={goBack}>
                Wstecz
              </button>
              <button
                className="install-guide-primary"
                type="button"
                onClick={() => {
                  if (stepIndex === steps.length - 1) {
                    onClose();
                  } else {
                    setStepIndex((current) => current + 1);
                  }
                }}
              >
                {stepIndex === steps.length - 1 ? "Gotowe" : "Dalej"}
                {stepIndex === steps.length - 1 ? (
                  <CheckCircle2 aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function BookingHome() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const today = currentDate;
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const closeInstallGuide = useCallback(() => setInstallGuideOpen(false), []);
  const [bookingError, setBookingError] = useState("");
  const [dataError, setDataError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [step, setStep] = useState<Step>("booking");
  const [adminSection, setAdminSection] = useState<AdminSection>("schedule");
  const [adminWorkspaceTab, setAdminWorkspaceTab] =
    useState<AdminWorkspaceTab>("upcoming");
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedKey, setSelectedKey] = useState(() => dayKey(today));
  const [adminSelectedKey, setAdminSelectedKey] = useState(() => dayKey(today));
  const [selectedBarberId, setSelectedBarberId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<BarberProfile[]>([]);
  const [teamDialogMemberId, setTeamDialogMemberId] = useState<string | null>(null);
  const [teamMemberDraft, setTeamMemberDraft] = useState<TeamMemberDraft>({
    name: "",
    email: "",
  });
  const [teamFeedback, setTeamFeedback] = useState<WorkFeedback | null>(null);
  const [isTeamSaving, setIsTeamSaving] = useState(false);
  const [barberServices, setBarberServices] = useState<Service[]>([]);
  const [loadedServicesBarberId, setLoadedServicesBarberId] = useState("");
  const [areBarberServicesLoading, setAreBarberServicesLoading] = useState(false);
  const [barberServicesError, setBarberServicesError] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [allAdminAppointments, setAllAdminAppointments] = useState<AdminAppointment[]>([]);
  const [ownClientAppointments, setOwnClientAppointments] = useState<AdminAppointment[]>([]);
  const [clientRecords, setClientRecords] = useState<ClientRecord[]>([]);
  const [clientWaitlistEntries, setClientWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [allAdminWaitlistEntries, setAllAdminWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [waitlistDialogOpen, setWaitlistDialogOpen] = useState(false);
  const [waitlistDraft, setWaitlistDraft] = useState<WaitlistDraft>(() => ({
    dateFrom: dayKey(today),
    dateTo: shiftDateKey(dayKey(today), 7),
    timePreference: "any",
    clientName: "",
    phone: "",
  }));
  const [waitlistFeedback, setWaitlistFeedback] = useState<WorkFeedback | null>(null);
  const [isWaitlistSaving, setIsWaitlistSaving] = useState(false);
  const [pendingWaitlistSelection, setPendingWaitlistSelection] =
    useState<PendingWaitlistSelection | null>(null);
  const [barberWorkSettings, setBarberWorkSettings] = useState<WorkSettings>(defaultWorkSettings);
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
  const [pendingNotificationAppointmentId, setPendingNotificationAppointmentId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [calendarClientSearch, setCalendarClientSearch] = useState("");
  const [calendarClientPickerOpen, setCalendarClientPickerOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");
  const [clientWorkspaceTab, setClientWorkspaceTab] = useState<ClientWorkspaceTab>("appointments");
  const [pendingClientRemovalId, setPendingClientRemovalId] = useState<string | null>(null);
  const [clientDialog, setClientDialog] = useState<ClientDialogState | null>(null);
  const [clientSaveMode, setClientSaveMode] = useState<ClientSaveMode>("record");
  const [clientDraft, setClientDraft] = useState<ClientDraft>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [manualBookingDraft, setManualBookingDraft] = useState<ManualBookingDraft>({
    serviceId: "",
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
  const [pushDeviceStatus, setPushDeviceStatus] = useState<PushDeviceStatus>("checking");
  const [isPushDeviceUpdating, setIsPushDeviceUpdating] = useState(false);
  const [pushDeviceFeedback, setPushDeviceFeedback] = useState<WorkFeedback | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const bookingServiceRef = useRef<HTMLDivElement | null>(null);
  const bookingBarberRef = useRef<HTMLDivElement | null>(null);
  const bookingCalendarRef = useRef<HTMLDivElement | null>(null);
  const bookingTimeRef = useRef<HTMLDivElement | null>(null);
  const latestSyncRevisionRef = useRef(-1);
  const appointmentSyncChannelRef = useRef<BroadcastChannel | null>(null);
  const pendingAppointmentOperationsRef = useRef(
    new Map<string, Promise<AppointmentApiResult<AdminAppointment>>>(),
  );
  const pendingAppointmentRefreshRef = useRef<Promise<AppointmentApiResult<AdminAppointment>> | null>(
    null,
  );
  const retryOperationIdsRef = useRef(new Map<string, string>());
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
  const isOwner = sessionContext?.role === "owner" && sessionContext.active;
  const signedInBarberId =
    sessionContext?.role === "barber" && sessionContext.active
      ? sessionContext.barberId
      : null;
  const isBarber = Boolean(signedInBarberId);
  const isAdmin = isOwner || isBarber;
  const pushDeviceEnabled = pushDeviceStatus === "enabled";
  const pushDeviceLabel = pushDeviceStatusLabel[pushDeviceStatus];
  const signedInBarberAccess = sessionContext?.access ?? fullBarberAccess;
  const canAccessAdminSchedule =
    Boolean(isOwner) || Boolean(isBarber && signedInBarberAccess.schedule);
  const canAccessAdminClients =
    Boolean(isOwner) || Boolean(isBarber && signedInBarberAccess.clients);
  const canAccessAdminWorkspace = canAccessAdminSchedule || canAccessAdminClients;
  const canAccessAdminSection = (section: AdminSection) =>
    isOwner ||
    (isBarber && section !== "team" && signedInBarberAccess[section as BarberAdminSection]);
  const visibleAdminSections: AdminSection[] = [
    ...(canAccessAdminWorkspace ? (["schedule"] as AdminSection[]) : []),
    ...standaloneAdminSections.filter((section) => canAccessAdminSection(section)),
    ...(isOwner ? (["team"] as AdminSection[]) : []),
  ];
  const activeAdminNavIndex = Math.max(0, visibleAdminSections.indexOf(adminSection));
  const activeBarberId = resolveActiveBarberId({
    step,
    signedInBarberId,
    selectedBarberId,
    activeBarberIds: teamMembers.filter((barber) => barber.active).map((barber) => barber.id),
  });
  const visibleBarberId = isOwner
    ? selectedBarberId
    : step === "admin"
      ? signedInBarberId
      : selectedBarberId;
  const selectedBarber =
    teamMembers.find((barber) => barber.id === visibleBarberId) ?? null;
  const signedInBarber =
    teamMembers.find((barber) => barber.id === signedInBarberId) ?? null;
  const signedInBarberProfile = signedInBarberId
    ? barberProfiles[signedInBarberId] ?? emptyBarberDetails
    : emptyBarberDetails;
  const signedInBarberName =
    signedInBarberProfile.displayName || signedInBarber?.name || "Barber";
  const activeBarberProfile = barberProfiles[activeBarberId] ?? emptyBarberDetails;
  const activeBarberName = activeBarberProfile.displayName || selectedBarber?.name || "Barber";
  const clientBarberOptions = useMemo(
    () =>
      teamMembers.filter((barber) => barber.active).map((barber) => {
        const profile = barberProfiles[barber.id] ?? emptyBarberDetails;
        return {
          ...barber,
          name: profile.displayName || barber.name,
          photoUrl: profile.photoUrl,
          bio: profile.bio,
          instagram: profile.instagram,
        };
      }),
    [barberProfiles, teamMembers],
  );
  const activeClientBarber =
    clientBarberOptions.find((barber) => barber.id === activeBarberId) ??
    selectedBarber ??
    teamMembers[0];
  const serviceCatalogReady = isServiceCatalogReady({
    activeBarberId,
    loadedBarberId: loadedServicesBarberId,
    isLoading: areBarberServicesLoading,
    error: barberServicesError,
  });
  const services = useMemo(
    () => (serviceCatalogReady ? barberServices : []),
    [barberServices, serviceCatalogReady],
  );
  const workSettings = barberWorkSettings;
  const barberAllAppointments = useMemo(
    () =>
      allAdminAppointments.filter(
        (appointment) =>
          !isAdmin || appointment.barberId === activeBarberId,
      ),
    [activeBarberId, allAdminAppointments, isAdmin],
  );
  const adminAppointments = useMemo(
    () =>
      barberAllAppointments.filter(
        (appointment) => normalizeAppointmentStatus(appointment.status) !== "cancelled",
      ),
    [barberAllAppointments],
  );
  const ownerBarberSummaries = useMemo(
    () =>
      teamMembers.map((barber) => {
        const profile = barberProfiles[barber.id] ?? emptyBarberDetails;
        const barberAppointments = allAdminAppointments.filter(
          (appointment) =>
            appointment.barberId === barber.id &&
            normalizeAppointmentStatus(appointment.status) !== "cancelled",
        );
        const upcomingAppointments = barberAppointments
          .filter(
            (appointment) =>
              !isClosedAppointmentStatus(appointment.status) &&
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
    [allAdminAppointments, barberProfiles, currentDate, teamMembers, today],
  );
  const reschedulingAppointment =
    ownClientAppointments.find((appointment) => appointment.id === reschedulingAppointmentId) ?? null;
  const activeBarberAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.barberId === activeBarberId),
    [activeBarberId, appointments],
  );
  const schedulingAppointments = reschedulingAppointment
    ? activeBarberAppointments.filter(
        (appointment) => appointment.id !== reschedulingAppointment.id,
      )
    : activeBarberAppointments;
  const selectedService = useMemo(
    () =>
      services.find((item) => item.id === selectedServiceId) ??
      services[0] ??
      { ...unavailableService, barberId: activeBarberId },
    [activeBarberId, selectedServiceId, services],
  );
  const activeClientWaitlistEntry =
    clientWaitlistEntries.find(
      (entry) =>
        entry.barberId === activeBarberId && entry.serviceId === selectedService.id,
    ) ?? null;
  const adminWaitlistEntries = useMemo(
    () =>
      allAdminWaitlistEntries
        .filter((entry) => entry.barberId === activeBarberId)
        .sort(
          (first, second) =>
            (first.status === "offered" ? -1 : 1) -
              (second.status === "offered" ? -1 : 1) ||
            first.dateFrom.localeCompare(second.dateFrom) ||
            first.createdAt - second.createdAt,
        ),
    [activeBarberId, allAdminWaitlistEntries],
  );
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
              !isClosedAppointmentStatus(appointment.status) &&
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
          hiddenFromDirectory: Boolean(clientRecord?.hiddenFor?.[activeBarberId]),
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
  const activeAdminClientProfiles = useMemo(
    () =>
      adminClientProfiles.filter(
        (client) =>
          Boolean(client.nextAppointment) ||
          client.appointments.some((appointment) => canSettleAppointment(appointment, currentDate)),
      ),
    [adminClientProfiles, currentDate],
  );
  const directoryAdminClientProfiles = useMemo(
    () => adminClientProfiles.filter((client) => !client.hiddenFromDirectory),
    [adminClientProfiles],
  );
  const clientWorkspaceProfiles =
    clientWorkspaceTab === "appointments"
      ? activeAdminClientProfiles
      : directoryAdminClientProfiles;
  const filteredAdminClients = useMemo(() => {
    const query = clientSearch.trim().toLocaleLowerCase("pl");

    return clientWorkspaceProfiles.filter((client) => {
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
  }, [clientFilter, clientSearch, clientWorkspaceProfiles]);
  const calendarBookingClients = useMemo(() => {
    const query = calendarClientSearch.trim().toLocaleLowerCase("pl");

    return adminClientProfiles.filter((client) =>
      !query
        ? true
        : [client.name, client.email, client.phone, getPhoneDigits(client.phone)]
            .join(" ")
            .toLocaleLowerCase("pl")
            .includes(query),
    );
  }, [adminClientProfiles, calendarClientSearch]);
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
        !isClosedAppointmentStatus(appointment.status) &&
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
        currentDate,
      ),
    [currentDate, schedulingAppointments, selectedDayKey, selectedService, workSettings],
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
        currentDate,
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
  }, [currentDate, schedulingAppointments, selectedService, today, workSettings]);
  const clientAppointments = useMemo(
    () =>
      activeUser
        ? ownClientAppointments
            .filter(
              (appointment) =>
                appointment.userId === activeUser.uid &&
                !isClosedAppointmentStatus(appointment.status) &&
                getAppointmentEndDateTime(appointment).getTime() > currentDate.getTime(),
            )
            .sort((first, second) => {
              if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
              return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
            })
        : [],
    [activeUser, currentDate, ownClientAppointments],
  );
  const nearestClientAppointment = clientAppointments[0] ?? null;
  const nearestClientAppointmentBarber = nearestClientAppointment
    ? clientBarberOptions.find((barber) => barber.id === nearestClientAppointment.barberId) ?? null
    : null;
  const reschedulingClientBarber = reschedulingAppointment
    ? clientBarberOptions.find((barber) => barber.id === reschedulingAppointment.barberId) ?? null
    : null;
  const clientFirstName = (activeUser?.displayName ?? "Kliencie").trim().split(/\s+/)[0] || "Kliencie";
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const canShiftToPreviousMonth = visibleMonth.getTime() > currentMonthStart.getTime();
  const selectedClientAppointment =
    clientAppointments.find((appointment) => appointment.id === clientAppointmentId) ??
    ownClientAppointments.find(
      (appointment) =>
        appointment.id === clientAppointmentId && appointment.userId === activeUser?.uid,
    ) ??
    null;
  const selectedClientAppointmentIsClosed = Boolean(
    selectedClientAppointment &&
      isClosedAppointmentStatus(selectedClientAppointment.status),
  );
  const selectedClientAppointmentIsRescheduled = Boolean(
    selectedClientAppointment &&
      normalizeAppointmentStatus(selectedClientAppointment.status) === "rescheduled",
  );
  const selectedClientNeedsConfirmation = Boolean(
    selectedClientAppointmentIsRescheduled &&
      selectedClientAppointment &&
      selectedClientAppointment.rescheduledBy !== "client",
  );
  const selectedClientAppointmentBarber = selectedClientAppointment
    ? clientBarberOptions.find((barber) => barber.id === selectedClientAppointment.barberId) ?? null
    : null;
  const pendingClientCancellation =
    clientAppointments.find((appointment) => appointment.id === pendingClientCancellationId) ?? null;
  const selectedAdminEditAppointment =
    adminAppointments.find((appointment) => appointment.id === adminEditAppointmentId) ??
    allAdminAppointments.find(
      (appointment) =>
        appointment.id === adminEditAppointmentId && appointment.barberId === activeBarberId,
    ) ??
    null;
  const selectedAdminEditAppointmentIsClosed = Boolean(
    selectedAdminEditAppointment &&
      isClosedAppointmentStatus(selectedAdminEditAppointment.status),
  );
  const selectedAdminClient =
    adminClientProfiles.find((client) => client.id === selectedAdminClientId) ?? null;
  const pendingClientRemoval =
    adminClientProfiles.find((client) => client.id === pendingClientRemovalId) ?? null;
  const manualBookingClient =
    clientDialog?.mode === "book"
      ? adminClientProfiles.find((client) => client.id === clientDialog.clientId) ?? null
      : null;
  const manualBookingWaitlistEntry = clientDialog?.waitlistEntryId
    ? allAdminWaitlistEntries.find((entry) => entry.id === clientDialog.waitlistEntryId) ?? null
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
  const manualBookingStatus = !serviceCatalogReady
    ? {
        kind: barberServicesError ? "unavailable" : "loading",
        message: barberServicesError || "Pobieram usługi wybranego barbera...",
      }
    : services.length === 0
      ? {
          kind: "unavailable",
          message: "Ten barber nie ma jeszcze aktywnych usług.",
        }
      : manualBookingHasConflict
        ? {
            kind: "conflict",
            message: "Termin koliduje z inną wizytą",
          }
        : {
            kind: "free",
            message: "Termin jest wolny i może zostać zapisany",
          };
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
  const editingTeamMember = teamDialogMemberId
    ? teamMembers.find((member) => member.id === teamDialogMemberId) ?? null
    : null;
  const activeTeamMembersCount = teamMembers.filter((member) => member.active).length;
  const hasSelectedBarber = Boolean(selectedBarber);
  const hasSelectedDay = selectedKey === selectedDayKey && availableTimes.length > 0;
  const canContinue = Boolean(
    hasSelectedBarber && selectedServiceId && hasSelectedDay && selectedTime,
  );
  const canConfirm =
    Boolean(activeUser) && form.fullName.trim().length >= 3 && getPhoneDigits(form.phone).length === 9;
  const canJoinWaitlist = Boolean(
    activeUser &&
      selectedBarber &&
      selectedService.id &&
      waitlistDraft.clientName.trim().length >= 3 &&
      getPhoneDigits(waitlistDraft.phone).length === 9 &&
      waitlistDraft.dateFrom >= dayKey(today) &&
      waitlistDraft.dateTo >= waitlistDraft.dateFrom,
  );
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

  const applyAppointmentSnapshot = useCallback(
    (result: AppointmentApiResult<AdminAppointment>) => {
      const incomingRevision = Math.max(0, Number(result.syncRevision) || 0);
      if (!shouldApplyAppointmentSnapshot(latestSyncRevisionRef.current, incomingRevision)) {
        return false;
      }
      latestSyncRevisionRef.current = incomingRevision;
      const normalizeLoadedAppointments = (items: AdminAppointment[] = []) =>
        items
        .map((appointment) => ({
          ...appointment,
          version: Math.max(1, Number(appointment.version) || 1),
          barberId: appointment.barberId,
          status: normalizeAppointmentStatus(appointment.status),
          color: normalizeAppointmentColor(appointment.color),
        }))
        .sort((first, second) => {
          if (first.dateKey !== second.dateKey) return first.dateKey.localeCompare(second.dateKey);
          return timeToMinutes(first.startTime) - timeToMinutes(second.startTime);
        });

      const loadedAdminAppointments = normalizeLoadedAppointments(
        result.adminAppointments ?? result.clientAppointments ?? [],
      );
      const loadedClientAppointments = normalizeLoadedAppointments(result.clientAppointments ?? []);

      setAllAdminAppointments(loadedAdminAppointments);
      setOwnClientAppointments(loadedClientAppointments);
      setAppointments(result.occupancy ?? []);
      setClientRecords((result.adminClients ?? []) as ClientRecord[]);
      setClientWaitlistEntries((result.clientWaitlist ?? []) as WaitlistEntry[]);
      setAllAdminWaitlistEntries((result.adminWaitlist ?? []) as WaitlistEntry[]);
      if (result.teamMembers) {
        setTeamMembers(
          (result.teamMembers as Partial<BarberProfile>[]).map((member, index) =>
            normalizeTeamMember(member.id ?? `barber-${index + 1}`, member, index),
          ),
        );
      }
      if (result.context) {
        setSessionContext(result.context as SessionContext);
      }
      setSessionReady(true);
      setDataError("");
      return true;
    },
    [],
  );

  const refreshClientAppointmentData = useCallback(async () => {
    if (pendingAppointmentRefreshRef.current) return pendingAppointmentRefreshRef.current;

    const refresh = fetchClientAppointmentData<AdminAppointment>()
      .then((result) => {
        applyAppointmentSnapshot(result);
        return result;
      })
      .finally(() => {
        pendingAppointmentRefreshRef.current = null;
      });
    pendingAppointmentRefreshRef.current = refresh;
    return refresh;
  }, [applyAppointmentSnapshot]);

  const runAppointmentOperation = useCallback(
    (
      action: AppointmentMutationAction,
      payload: Record<string, unknown>,
      options: { key: string; expectedVersion: number },
    ) => {
      const pending = pendingAppointmentOperationsRef.current.get(options.key);
      if (pending) return pending;

      const operationId =
        retryOperationIdsRef.current.get(options.key) ?? createAppointmentOperationId();
      retryOperationIdsRef.current.set(options.key, operationId);

      const operation = mutateAppointment<AdminAppointment>(action, payload, {
        operationId,
        expectedVersion: options.expectedVersion,
      })
        .then((result) => {
          applyAppointmentSnapshot(result);
          retryOperationIdsRef.current.delete(options.key);
          appointmentSyncChannelRef.current?.postMessage({
            revision: Number(result.syncRevision) || 0,
          });
          return result;
        })
        .catch((error: unknown) => {
          if (error instanceof AppointmentApiError) {
            if (error.result) applyAppointmentSnapshot(error.result);
            if (error.status < 500) retryOperationIdsRef.current.delete(options.key);
          }
          throw error;
        })
        .finally(() => pendingAppointmentOperationsRef.current.delete(options.key));

      pendingAppointmentOperationsRef.current.set(options.key, operation);
      return operation;
    },
    [applyAppointmentSnapshot],
  );

  const registerCurrentPushDevice = useCallback(async () => {
    if (!activeUser || isOwner) return null;

    const result = await registerPushNotifications(
      {
        uid: activeUser.uid,
        displayName: activeUser.displayName ?? null,
        email: activeUser.email ?? null,
      },
      isAdmin,
    ).catch(() => ({ ok: false as const, reason: "token_error" as const }));
    setPushDeviceStatus(
      result.ok
        ? "enabled"
        : result.reason === "unsupported_browser" ||
            result.reason === "unsupported_firebase_messaging"
          ? "unsupported"
          : result.reason === "permission_denied" && Notification.permission === "denied"
            ? "blocked"
            : "error",
    );
    return result;
  }, [activeUser, isAdmin, isOwner]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentDate(new Date()), 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!activeUser || isOwner) {
      setPushDeviceStatus("checking");
      setPushDeviceFeedback(null);
      return undefined;
    }

    let stopped = false;
    const notificationUser = {
      uid: activeUser.uid,
      displayName: activeUser.displayName ?? null,
      email: activeUser.email ?? null,
    };
    const refreshStatus = async () => {
      const status = await getPushNotificationDeviceStatus(notificationUser);
      if (!stopped) setPushDeviceStatus(status);
    };
    const refreshAfterReturn = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };

    setPushDeviceStatus("checking");
    void refreshStatus();
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", refreshAfterReturn);

    return () => {
      stopped = true;
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", refreshAfterReturn);
    };
  }, [activeUser, isOwner]);

  useEffect(() => {
    if (!pushDeviceFeedback) return undefined;
    const timeoutId = window.setTimeout(() => setPushDeviceFeedback(null), 4500);
    return () => window.clearTimeout(timeoutId);
  }, [pushDeviceFeedback]);

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
    if (
      !activeUser ||
      isOwner ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted" ||
      isPushNotificationsLocallyDisabled(activeUser.uid)
    ) {
      return;
    }

    void registerCurrentPushDevice();
  }, [activeUser, isOwner, registerCurrentPushDevice]);

  useEffect(() => {
    if (!activeUser || isOwner) return undefined;

    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void listenForForegroundPushNotifications(() => {
      void refreshClientAppointmentData();
    })
      .then((listener) => {
        if (stopped) {
          listener();
          return;
        }
        unsubscribe = listener;
      })
      .catch(() => undefined);

    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [activeUser, isOwner, refreshClientAppointmentData]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const appointmentId = url.searchParams.get("appointment")?.trim();
    if (appointmentId) setPendingNotificationAppointmentId(appointmentId);
    const waitlistId = url.searchParams.get("waitlist")?.trim() ?? "";
    const barberId = url.searchParams.get("barber")?.trim() ?? "";
    const serviceId = url.searchParams.get("service")?.trim() ?? "";
    const dateKey = url.searchParams.get("date")?.trim() ?? "";
    const startTime = url.searchParams.get("time")?.trim() ?? "";
    if (waitlistId && barberId && serviceId && dateKey && startTime) {
      setPendingWaitlistSelection({ waitlistId, barberId, serviceId, dateKey, startTime });
    }
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

    void getRedirectResult(firebaseAuth).catch((error: { code?: string }) => {
      setAuthError(getGoogleSignInErrorMessage(error.code));
      setIsSigningIn(false);
    });

    return onAuthStateChanged(firebaseAuth, (user) => {
      setCurrentUser(user);
      setSessionContext(null);
      setSessionReady(!user);
      setAuthReady(true);
      if (user) setAuthError("");

      if (user?.displayName) {
        setForm((current) => ({
          ...current,
          fullName: current.fullName || user.displayName || "",
        }));
      }
    });
  }, []);

  useEffect(() => {
    setSelectedBarberId(null);
    if (activeUser) {
      window.localStorage.removeItem(`bnb-notifications-${activeUser.uid}`);
    }
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser || !sessionContext) {
      setTeamMembers([]);
      return undefined;
    }

    if (!isOwner && sessionContext.role !== "barber") return undefined;

    const teamPath = isOwner ? "team/barbers" : `team/barbers/${sessionContext.barberId}`;
    const teamRef = ref(realtimeDb, teamPath);
    return onValue(teamRef, (snapshot) => {
      const snapshotValue = snapshot.val() as
        | Record<string, Partial<BarberProfile>>
        | Partial<BarberProfile>
        | null;
      const value = isOwner
        ? (snapshotValue as Record<string, Partial<BarberProfile>> | null)
        : snapshotValue
          ? { [sessionContext.barberId]: snapshotValue as Partial<BarberProfile> }
          : null;
      if (!value) {
        return;
      }

      const loadedMembers = Object.entries(value).map(([id, member], index) =>
        normalizeTeamMember(id, member, index),
      );
      setTeamMembers((current) =>
        isOwner
          ? loadedMembers
          : current.map((member) =>
              member.id === sessionContext.barberId ? loadedMembers[0] : member,
            ),
      );
      const signedInMember = loadedMembers.find(
        (member) => member.id === sessionContext.barberId,
      );
      if (
        sessionContext?.role === "barber" &&
        signedInMember?.active === false
      ) {
        setSessionContext({
          role: "client",
          assignedRole: "barber",
          active: false,
          isAdmin: false,
          isOwner: false,
          barberId: "",
          access: noBarberAccess,
        });
        setStep("booking");
      } else if (sessionContext.role === "barber" && signedInMember) {
        setSessionContext((current) =>
          current?.role === "barber" &&
          barberAdminSections.some(
            (section) => current.access[section] !== signedInMember.access[section],
          )
            ? { ...current, access: signedInMember.access }
            : current,
        );
      }
    }, () => {
      void refreshClientAppointmentData();
    });
  }, [activeUser, isOwner, refreshClientAppointmentData, sessionContext]);

  useEffect(() => {
    if (!activeUser) {
      setAppointments([]);
      setAllAdminAppointments([]);
      setOwnClientAppointments([]);
      setClientRecords([]);
      setClientWaitlistEntries([]);
      setAllAdminWaitlistEntries([]);
      setWaitlistDialogOpen(false);
      setPendingWaitlistSelection(null);
      latestSyncRevisionRef.current = -1;
      return undefined;
    }

    let stopped = false;
    let refreshTimer = 0;
    let requestInProgress = false;
    const loadClientAppointments = async () => {
      if (requestInProgress || stopped) return;
      requestInProgress = true;
      try {
        await refreshClientAppointmentData();
      } catch {
        if (!stopped) {
          setSessionReady(true);
          setDataError("Nie udało się odświeżyć terminarza. Sprawdź połączenie i spróbuj ponownie.");
        }
      } finally {
        requestInProgress = false;
        if (!stopped) {
          refreshTimer = window.setTimeout(
            loadClientAppointments,
            document.visibilityState === "visible" ? 30000 : 120000,
          );
        }
      }
    };

    void loadClientAppointments();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(refreshTimer);
        void loadClientAppointments();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stopped = true;
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeUser, refreshClientAppointmentData]);

  useEffect(() => {
    if (!activeUser) return undefined;

    const revisionRef = ref(realtimeDb, "appointmentSync/revision");
    return onValue(
      revisionRef,
      (snapshot) => {
        const revision = Math.max(0, Number(snapshot.val()) || 0);
        if (revision > latestSyncRevisionRef.current) void refreshClientAppointmentData();
      },
      () => {
        // The periodic authenticated API refresh remains the fallback when the signal is unavailable.
      },
    );
  }, [activeUser, refreshClientAppointmentData]);

  useEffect(() => {
    if (!activeUser || typeof BroadcastChannel === "undefined") return undefined;

    const channel = new BroadcastChannel("bnb-appointment-sync");
    appointmentSyncChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ revision?: number }>) => {
      const revision = Number(event.data?.revision) || 0;
      if (revision > latestSyncRevisionRef.current) void refreshClientAppointmentData();
    };

    return () => {
      appointmentSyncChannelRef.current = null;
      channel.close();
    };
  }, [activeUser, refreshClientAppointmentData]);

  useEffect(() => {
    if (!activeUser) {
      setBarberProfiles({});
      return undefined;
    }

    setBarberProfiles({});
    const visibleProfiles = isBarber && step === "admin"
      ? teamMembers.filter((barber) => barber.id === signedInBarberId)
      : teamMembers;
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
  }, [activeUser, isBarber, signedInBarberId, step, teamMembers]);

  useEffect(() => {
    const defaultProfile = teamMembers.find((barber) => barber.id === activeBarberId);
    setProfileDraft({
      ...activeBarberProfile,
      displayName: activeBarberProfile.displayName || defaultProfile?.name || "",
      photoUrl: activeBarberProfile.photoUrl,
    });
    setProfileFeedback(null);
  }, [activeBarberId, activeBarberProfile, teamMembers]);

  useEffect(() => {
    if (!activeUser || !pendingNotificationAppointmentId) return;

    const adminAppointment = allAdminAppointments.find(
      (item) => item.id === pendingNotificationAppointmentId,
    );
    const clientAppointment = ownClientAppointments.find(
      (item) =>
        item.id === pendingNotificationAppointmentId && item.userId === activeUser.uid,
    );
    const appointment = adminAppointment ?? clientAppointment;
    if (!appointment) return;

    if (isAdmin && adminAppointment) {
      setSelectedBarberId(appointment.barberId);
      setAdminSection("schedule");
      setAdminWorkspaceTab("schedule");
      setAdminSelectedKey(appointment.dateKey);
      setAdminEditDraft({ dateKey: appointment.dateKey, startTime: appointment.startTime });
      setAdminEditAppointmentId(appointment.id);
      setStep("admin");
    } else {
      setClientAppointmentId(appointment.id);
    }
    setPendingNotificationAppointmentId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("appointment");
    url.searchParams.delete("event");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [activeUser, allAdminAppointments, isAdmin, ownClientAppointments, pendingNotificationAppointmentId]);

  useEffect(() => {
    if (!activeUser || !pendingWaitlistSelection || !sessionReady) return;
    const entry = clientWaitlistEntries.find(
      (item) => item.id === pendingWaitlistSelection.waitlistId,
    );
    const clearWaitlistUrl = () => {
      const url = new URL(window.location.href);
      ["waitlist", "barber", "service", "date", "time", "event"].forEach((key) =>
        url.searchParams.delete(key),
      );
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    };

    if (!entry?.offer || Number(entry.offer.expiresAt) <= currentDate.getTime()) {
      setWaitlistFeedback({
        kind: "error",
        message: "Ta oferta już wygasła. Nadal powiadomimy Cię o kolejnym pasującym terminie.",
      });
      setPendingWaitlistSelection(null);
      clearWaitlistUrl();
      return;
    }
    if (selectedBarberId !== pendingWaitlistSelection.barberId) {
      setSelectedBarberId(pendingWaitlistSelection.barberId);
      setSelectedServiceId("");
      setSelectedTime("");
      return;
    }
    if (!serviceCatalogReady) return;
    if (!services.some((service) => service.id === pendingWaitlistSelection.serviceId)) {
      setWaitlistFeedback({ kind: "error", message: "Wybrana usługa nie jest już dostępna." });
      setPendingWaitlistSelection(null);
      clearWaitlistUrl();
      return;
    }
    if (
      selectedServiceId !== pendingWaitlistSelection.serviceId ||
      selectedKey !== pendingWaitlistSelection.dateKey
    ) {
      const offerDate = dateFromKey(pendingWaitlistSelection.dateKey);
      setSelectedServiceId(pendingWaitlistSelection.serviceId);
      setVisibleMonth(new Date(offerDate.getFullYear(), offerDate.getMonth(), 1));
      setSelectedKey(pendingWaitlistSelection.dateKey);
      setSelectedTime("");
      return;
    }
    if (!availableTimes.includes(pendingWaitlistSelection.startTime)) return;

    setSelectedTime(pendingWaitlistSelection.startTime);
    setForm({ fullName: entry.clientName, phone: entry.phone });
    setPendingWaitlistSelection(null);
    clearWaitlistUrl();
    window.requestAnimationFrame(() => {
      const target = bookingTimeRef.current;
      if (!target) return;
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  }, [
    activeUser,
    availableTimes,
    clientWaitlistEntries,
    currentDate,
    pendingWaitlistSelection,
    selectedBarberId,
    selectedKey,
    selectedServiceId,
    serviceCatalogReady,
    services,
    sessionReady,
  ]);

  useEffect(() => {
    if (!activeUser || !activeBarberId) {
      setBarberWorkSettings(defaultWorkSettings);
      return undefined;
    }

    const barberWorkSettingsRef = ref(realtimeDb, `barbers/${activeBarberId}/workSettings`);
    return onValue(barberWorkSettingsRef, (snapshot) => {
      const value = snapshot.val() as Partial<WorkSettings> | null;
      setBarberWorkSettings(normalizeWorkSettings(value, activeBarberId));
    });
  }, [activeBarberId, activeUser]);

  useEffect(() => {
    if (!activeUser || !activeBarberId) {
      setBarberServices([]);
      setLoadedServicesBarberId("");
      setAreBarberServicesLoading(false);
      setBarberServicesError("");
      return undefined;
    }

    setBarberServices([]);
    setLoadedServicesBarberId("");
    setAreBarberServicesLoading(true);
    setBarberServicesError("");
    const barberServicesRef = ref(realtimeDb, `barbers/${activeBarberId}/services`);
    return onValue(
      barberServicesRef,
      (snapshot) => {
        const value = snapshot.val() as Record<string, Partial<Service>> | null;
        setBarberServices(normalizeServices(value, activeBarberId));
        setLoadedServicesBarberId(activeBarberId);
        setAreBarberServicesLoading(false);
        setBarberServicesError("");
      },
      () => {
        setBarberServices([]);
        setLoadedServicesBarberId(activeBarberId);
        setAreBarberServicesLoading(false);
        setBarberServicesError("Nie udało się pobrać usług. Spróbuj ponownie.");
      },
    );
  }, [activeBarberId, activeUser]);

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
      setSelectedServiceId(services[0]?.id ?? "");
      setSelectedTime("");
    }

    if (!services.some((service) => service.id === manualBookingDraft.serviceId)) {
      setManualBookingDraft((current) => ({
        ...current,
        serviceId: services[0]?.id ?? "",
      }));
    }
  }, [manualBookingDraft.serviceId, selectedServiceId, services]);

  useEffect(() => {
    if (!reschedulingAppointment || reschedulingAppointment.barberId !== activeBarberId) return;

    const matchingService =
      services.find((service) => service.name === reschedulingAppointment.serviceName) ??
      services.find(
        (service) => service.durationMinutes === reschedulingAppointment.durationMinutes,
      );
    if (matchingService && matchingService.id !== selectedServiceId) {
      setSelectedServiceId(matchingService.id);
    }
  }, [activeBarberId, reschedulingAppointment, selectedServiceId, services]);

  useEffect(() => {
    if (step === "admin" && !isAdmin) {
      setStep("booking");
    }
  }, [isAdmin, step]);

  useEffect(() => {
    if (step !== "admin" || isOwner || !isBarber) return;
    if (adminSection === "schedule" && canAccessAdminWorkspace) {
      if (adminWorkspaceTab === "schedule" && !canAccessAdminSchedule) {
        setAdminWorkspaceTab("upcoming");
      } else if (adminWorkspaceTab === "clients" && !canAccessAdminClients) {
        setAdminWorkspaceTab("upcoming");
      }
      return;
    }
    if (
      adminSection !== "team" &&
      adminSection !== "schedule" &&
      signedInBarberAccess[adminSection]
    ) {
      return;
    }

    const firstAllowedSection: AdminSection | undefined = canAccessAdminWorkspace
      ? "schedule"
      : standaloneAdminSections.find((section) => signedInBarberAccess[section]);
    if (firstAllowedSection) {
      setAdminSection(firstAllowedSection);
      if (firstAllowedSection === "schedule") setAdminWorkspaceTab("upcoming");
    } else {
      setStep("booking");
    }
  }, [
    adminSection,
    adminWorkspaceTab,
    canAccessAdminClients,
    canAccessAdminSchedule,
    canAccessAdminWorkspace,
    isBarber,
    isOwner,
    signedInBarberAccess,
    step,
  ]);

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
        pendingClientRemovalId ||
        clientDialog ||
        smsComposer ||
        waitlistDialogOpen,
    );
    if (!clientModalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusTopOverlay = () => {
      const overlays = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
      );
      const overlay = overlays.at(-1);
      overlay?.querySelector<HTMLElement>(focusableSelector)?.focus();
    };
    const focusFrame = window.requestAnimationFrame(focusTopOverlay);
    const closeTopOverlay = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const overlays = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
        );
        const overlay = overlays.at(-1);
        const focusable = overlay
          ? Array.from(overlay.querySelectorAll<HTMLElement>(focusableSelector)).filter(
              (element) => element.offsetParent !== null,
            )
          : [];
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if (event.key !== "Escape") return;

      if (waitlistDialogOpen) {
        setWaitlistDialogOpen(false);
      } else if (pendingClientRemovalId) {
        setPendingClientRemovalId(null);
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
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeTopOverlay);
      previouslyFocused?.focus();
    };
  }, [
    clientAppointmentsListOpen,
    clientDialog,
    pendingClientCancellation,
    pendingClientRemovalId,
    selectedAdminClient,
    selectedAdminEditAppointment,
    selectedClientAppointment,
    smsComposer,
    visibleStep,
    waitlistDialogOpen,
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
  }, [adminSection, adminWorkspaceTab, visibleStep]);

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
        setSelectedServiceId(nextServices[0]?.id ?? "");
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
        teamMembers.find((barber) => barber.id === activeBarberId)?.name ||
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

  const openOwnerBarberPanel = (
    barberId: string,
    section: AdminSection = "schedule",
  ) => {
    setSelectedBarberId(barberId);
    setAdminSection(section);
    if (section === "schedule") {
      setAdminWorkspaceTab("upcoming");
    }
    setAdminSelectedKey(dayKey(today));
    setClientSearch("");
    setClientFilter("all");
    setClientFeedback(null);
    setWorkFeedback(null);
  };

  const openTeamMemberEditDialog = (member: BarberProfile) => {
    setTeamMemberDraft({
      name: member.name,
      email: member.email,
    });
    setTeamFeedback(null);
    setTeamDialogMemberId(member.id);
  };

  const saveTeamMember = async () => {
    if (!isOwner || isTeamSaving) return;

    const name = teamMemberDraft.name.trim();
    const email = teamMemberDraft.email.trim().toLocaleLowerCase("pl");
    const existingMember = teamDialogMemberId
      ? teamMembers.find((member) => member.id === teamDialogMemberId) ?? null
      : null;

    if (!existingMember) {
      setTeamFeedback({ kind: "error", message: "Nie znaleziono konta barbera." });
      return;
    }

    if (name.length < 2 || (email && !isValidEmail(email))) {
      setTeamFeedback({
        kind: "error",
        message: "Podaj imię oraz poprawny adres e-mail albo pozostaw go pusty.",
      });
      return;
    }

    const memberId = existingMember.id;
    const memberIndex = Math.max(0, teamMembers.findIndex((member) => member.id === memberId));
    const now = Date.now();
    const member = normalizeTeamMember(
      memberId,
      {
        ...existingMember,
        name,
        label: existingMember.label || `Barber ${memberIndex + 1}`,
        accent: existingMember.accent || (memberIndex % 2 === 0 ? "blue" : "mint"),
        email,
        active: existingMember.active,
        access: existingMember.access,
        createdAt: existingMember.createdAt ?? now,
        updatedAt: now,
      },
      memberIndex,
    );

    try {
      setIsTeamSaving(true);
      setTeamFeedback(null);
      const updates: Record<string, unknown> = {
        [`team/barbers/${memberId}`]: member,
      };
      updates[`barbers/${memberId}/profile/displayName`] = name;
      updates[`barbers/${memberId}/profile/email`] = email;
      updates[`barbers/${memberId}/profile/updatedAt`] = now;
      await update(ref(realtimeDb), updates);
      setTeamDialogMemberId(null);
    } catch {
      setTeamFeedback({ kind: "error", message: "Nie udało się zapisać członka zespołu." });
    } finally {
      setIsTeamSaving(false);
    }
  };

  const updateTeamMemberActive = async (member: BarberProfile, active: boolean) => {
    if (!isOwner || isTeamSaving) return;
    try {
      setIsTeamSaving(true);
      setTeamFeedback(null);
      await update(ref(realtimeDb, `team/barbers/${member.id}`), {
        active,
        updatedAt: serverTimestamp(),
      });
    } catch {
      setTeamFeedback({ kind: "error", message: "Nie udało się zmienić stanu konta." });
    } finally {
      setIsTeamSaving(false);
    }
  };

  const updateTeamMemberAccess = async (
    member: BarberProfile,
    section: BarberAdminSection,
    allowed: boolean,
  ) => {
    if (!isOwner || isTeamSaving) return;
    try {
      setIsTeamSaving(true);
      setTeamFeedback(null);
      await update(ref(realtimeDb, `team/barbers/${member.id}`), {
        [`access/${section}`]: allowed,
        updatedAt: serverTimestamp(),
      });
    } catch {
      setTeamFeedback({ kind: "error", message: "Nie udało się zmienić zakresu dostępu." });
    } finally {
      setIsTeamSaving(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setIsSigningIn(true);

    try {
      const firebaseAuth = getAuth(firebaseApp);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const useRedirect = shouldUseRedirectSignIn(window.navigator);

      if (useRedirect) {
        await signInWithRedirect(firebaseAuth, provider);
      } else {
        await signInWithPopup(firebaseAuth, provider);
      }
    } catch (error) {
      const errorCode = (error as { code?: string }).code;
      if (shouldFallbackToRedirect(errorCode)) {
        try {
          const firebaseAuth = getAuth(firebaseApp);
          const provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          await signInWithRedirect(firebaseAuth, provider);
          return;
        } catch (redirectError) {
          setAuthError(
            getGoogleSignInErrorMessage((redirectError as { code?: string }).code),
          );
        }
      } else if (
        errorCode !== "auth/popup-closed-by-user" &&
        errorCode !== "auth/cancelled-popup-request"
      ) {
        setAuthError(getGoogleSignInErrorMessage(errorCode));
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

  const handlePushDeviceToggle = async () => {
    if (!activeUser || isOwner || isPushDeviceUpdating || pushDeviceStatus === "checking") return;

    setIsPushDeviceUpdating(true);
    setPushDeviceFeedback(null);
    const notificationUser = {
      uid: activeUser.uid,
      displayName: activeUser.displayName ?? null,
      email: activeUser.email ?? null,
    };

    try {
      if (pushDeviceEnabled) {
        const result = await disablePushNotifications(notificationUser);
        if (!result.ok) {
          setPushDeviceStatus("error");
          setPushDeviceFeedback({
            kind: "error",
            message: "Nie udało się wyłączyć powiadomień. Spróbuj ponownie.",
          });
          return;
        }
        setPushDeviceStatus("disabled");
        setPushDeviceFeedback({
          kind: "success",
          message: "Powiadomienia na tym urządzeniu są wyłączone.",
        });
        return;
      }

      if (
        pushDeviceStatus === "blocked" ||
        (typeof Notification !== "undefined" && Notification.permission === "denied")
      ) {
        setPushDeviceStatus("blocked");
        setPushDeviceFeedback({
          kind: "error",
          message: "Odblokuj powiadomienia dla BNB Barbershop w ustawieniach telefonu.",
        });
        return;
      }

      if (pushDeviceStatus === "unsupported") {
        setPushDeviceFeedback({
          kind: "error",
          message:
            "Ta przeglądarka nie obsługuje powiadomień. Na iPhonie dodaj aplikację do ekranu początkowego.",
        });
        return;
      }

      const result = await registerCurrentPushDevice();
      if (!result?.ok) {
        setPushDeviceFeedback({
          kind: "error",
          message:
            result?.reason === "permission_denied"
              ? typeof Notification !== "undefined" && Notification.permission === "denied"
                ? "Powiadomienia zostały zablokowane. Włącz je w ustawieniach telefonu."
                : "Zezwól na powiadomienia w komunikacie systemowym."
              : "Nie udało się włączyć powiadomień. Spróbuj ponownie.",
        });
        return;
      }

      setPushDeviceFeedback({
        kind: "success",
        message: "Powiadomienia na tym urządzeniu są włączone.",
      });
    } finally {
      setIsPushDeviceUpdating(false);
    }
  };

  const selectBookingBarber = (barberId: string, scrollToServices = true) => {
    if (barberId === activeBarberId && selectedBarberId === barberId) return;

    setSelectedBarberId(barberId);
    setSelectedServiceId("");
    setSelectedTime("");
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedKey(dayKey(today));

    if (scrollToServices && window.matchMedia("(max-width: 767px)").matches) {
      window.requestAnimationFrame(() => scrollToBookingSection(bookingServiceRef.current));
    }
  };

  const openWaitlistDialog = () => {
    const startDate = selectedKey >= dayKey(today) ? selectedKey : dayKey(today);
    setWaitlistDraft({
      dateFrom: startDate,
      dateTo: shiftDateKey(startDate, 7),
      timePreference: "any",
      clientName: form.fullName || activeUser?.displayName || "",
      phone: form.phone,
    });
    setWaitlistFeedback(null);
    setWaitlistDialogOpen(true);
  };

  const joinClientWaitlist = async () => {
    if (!canJoinWaitlist || !activeUser || !selectedBarber || isWaitlistSaving) return;
    const waitlistId = `waitlist-${window.crypto?.randomUUID?.() ?? Date.now()}`;
    try {
      setIsWaitlistSaving(true);
      setWaitlistFeedback(null);
      await runAppointmentOperation(
        "join_waitlist",
        {
          waitlistEntry: {
            id: waitlistId,
            barberId: activeBarberId,
            serviceId: selectedService.id,
            clientName: waitlistDraft.clientName.trim(),
            phone: waitlistDraft.phone,
            dateFrom: waitlistDraft.dateFrom,
            dateTo: waitlistDraft.dateTo,
            timePreference: waitlistDraft.timePreference,
          },
        },
        {
          key: `join_waitlist:${activeBarberId}:${selectedService.id}`,
          expectedVersion: 0,
        },
      );
      setForm((current) => ({
        fullName: current.fullName || waitlistDraft.clientName.trim(),
        phone: current.phone || waitlistDraft.phone,
      }));
      setWaitlistDialogOpen(false);
      setWaitlistFeedback({
        kind: "success",
        message: "Gotowe. Powiadomimy Cię, gdy zwolni się pasujący termin.",
      });
      if (!pushDeviceEnabled && pushDeviceStatus !== "unsupported") {
        void registerCurrentPushDevice();
      }
    } catch (error) {
      setWaitlistFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Nie udało się zapisać na listę.",
      });
    } finally {
      setIsWaitlistSaving(false);
    }
  };

  const leaveClientWaitlist = async (entry: WaitlistEntry) => {
    if (isWaitlistSaving) return;
    try {
      setIsWaitlistSaving(true);
      setWaitlistFeedback(null);
      await runAppointmentOperation(
        "leave_waitlist",
        { waitlistId: entry.id },
        { key: `leave_waitlist:${entry.id}`, expectedVersion: entry.version },
      );
      setWaitlistFeedback({ kind: "success", message: "Usunięto zapis z listy rezerwowej." });
    } catch (error) {
      setWaitlistFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Nie udało się usunąć zapisu.",
      });
    } finally {
      setIsWaitlistSaving(false);
    }
  };

  const removeAdminWaitlistEntry = async (entry: WaitlistEntry) => {
    if (isWaitlistSaving) return;
    try {
      setIsWaitlistSaving(true);
      setBookingError("");
      await runAppointmentOperation(
        "remove_waitlist_admin",
        { waitlistId: entry.id },
        { key: `remove_waitlist_admin:${entry.id}`, expectedVersion: entry.version },
      );
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Nie udało się usunąć zapisu.");
    } finally {
      setIsWaitlistSaving(false);
    }
  };

  const acceptWaitlistOffer = (entry: WaitlistEntry) => {
    if (!entry.offer) return;
    setPendingWaitlistSelection({
      waitlistId: entry.id,
      barberId: entry.barberId,
      serviceId: entry.serviceId,
      dateKey: entry.offer.dateKey,
      startTime: entry.offer.startTime,
    });
    setStep("booking");
    setWaitlistFeedback({
      kind: "success",
      message: "Termin czeka na Ciebie. Sprawdź wybór i potwierdź rezerwację.",
    });
  };

  const beginClientReschedule = (appointment: AdminAppointment) => {
    const appointmentDate = dateFromKey(appointment.dateKey);

    selectBookingBarber(appointment.barberId, false);
    setVisibleMonth(new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), 1));
    setSelectedKey(appointment.dateKey);
    setSelectedTime(appointment.startTime);
    setClientAppointmentId(null);
    setClientAppointmentsListOpen(false);
    setReschedulingAppointmentId(appointment.id);
    setStep("booking");
    window.requestAnimationFrame(() => scrollToBookingSection(bookingCalendarRef.current));
  };

  const cancelClientAppointment = async (appointmentId: string) => {
    const appointment = ownClientAppointments.find((item) => item.id === appointmentId);

    setPendingClientCancellationId(null);
    setClientAppointmentId(null);
    setClientAppointmentsListOpen(false);
    if (reschedulingAppointmentId === appointmentId) {
      setReschedulingAppointmentId(null);
      setSelectedTime("");
    }

    if (!appointment) return;
    try {
      setIsSaving(true);
      setBookingError("");
      await runAppointmentOperation(
        "cancel_client",
        { appointmentId },
        { key: `cancel_client:${appointmentId}`, expectedVersion: appointment.version ?? 1 },
      );
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Nie udało się odwołać wizyty.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmClientRescheduledAppointment = async (appointmentId: string) => {
    if (isSaving) return;

    const confirmsAsAdmin = step === "admin";
    const appointment = confirmsAsAdmin
      ? adminAppointments.find((item) => item.id === appointmentId)
      : ownClientAppointments.find((item) => item.id === appointmentId);
    if (!appointment) return;

    try {
      setIsSaving(true);
      setBookingError("");
      await runAppointmentOperation(
        confirmsAsAdmin ? "confirm_admin" : "confirm_client",
        { appointmentId },
        {
          key: `${confirmsAsAdmin ? "confirm_admin" : "confirm_client"}:${appointmentId}`,
          expectedVersion: appointment.version ?? 1,
        },
      );
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Nie udało się potwierdzić wizyty.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveClientReschedule = async () => {
    if (!reschedulingAppointment || !selectedTime || isSaving) return;

    try {
      setIsSaving(true);
      setBookingError("");
      await runAppointmentOperation(
        "reschedule_client",
        {
          appointmentId: reschedulingAppointment.id,
          dateKey: selectedDayKey,
          startTime: selectedTime,
        },
        {
          key: `reschedule_client:${reschedulingAppointment.id}`,
          expectedVersion: reschedulingAppointment.version ?? 1,
        },
      );
      setReschedulingAppointmentId(null);
      setSelectedTime("");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Nie udało się przesunąć wizyty.");
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
    if (!canConfirm || !selectedTime || isSaving || !activeUser || !selectedBarber) return;

    const appointmentId = window.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const clientId = activeUser.uid;
    const appointmentColor = getNextAppointmentColor(
      selectedDayKey,
      allAdminAppointments.filter((appointment) => appointment.barberId === activeBarberId),
    );
    const adminAppointment: AdminAppointment = {
      id: appointmentId,
      barberId: activeBarberId,
      clientId,
      serviceId: selectedService.id,
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
      barberId: activeBarberId,
      barberName: activeBarberName,
      barberPhotoUrl: activeBarberProfile.photoUrl,
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
      setBookingError("");
      const name = splitClientName(form.fullName);
      await runAppointmentOperation(
        "create_client",
        {
          appointment: adminAppointment,
          client: {
            firstName: name.firstName,
            lastName: name.lastName,
            phone: form.phone,
          },
        },
        { key: "create_client:booking", expectedVersion: 0 },
      );
      setForm({ fullName: "", phone: "" });
      setStep("success");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Nie udało się zapisać wizyty.");
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
      await runAppointmentOperation(
        "reschedule_admin",
        {
          appointmentId: selectedAdminEditAppointment.id,
          dateKey: adminEditDraft.dateKey,
          startTime: adminEditDraft.startTime,
        },
        {
          key: `reschedule_admin:${selectedAdminEditAppointment.id}`,
          expectedVersion: selectedAdminEditAppointment.version ?? 1,
        },
      );
      setAdminSelectedKey(adminEditDraft.dateKey);
      setAdminEditAppointmentId(null);
    } finally {
      setIsSaving(false);
    }
  };

  const moveAdminAppointment = async (appointmentId: string, startTime: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!appointment || !canMoveAdminAppointment(appointment, startTime)) {
      setDraggedAppointmentId(null);
      return;
    }

    try {
      await runAppointmentOperation(
        "reschedule_admin",
        { appointmentId, dateKey: adminSelectedKey, startTime },
        {
          key: `reschedule_admin:${appointmentId}`,
          expectedVersion: appointment.version ?? 1,
        },
      );
    } finally {
      setDraggedAppointmentId(null);
    }
  };

  const shiftAdminAppointment = (appointmentId: string, minutes: -15 | 15) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!appointment) return;

    void moveAdminAppointment(
      appointmentId,
      minutesToTime(timeToMinutes(appointment.startTime) + minutes),
    );
  };

  const declineAdminAppointment = async (appointmentId: string) => {
    const appointment = adminAppointments.find((item) => item.id === appointmentId);
    if (!window.confirm(`Odwołać wizytę ${appointment?.clientName ?? "klienta"}?`)) return;

    if (!appointment) return;
    await runAppointmentOperation(
      "cancel_admin",
      { appointmentId },
      { key: `cancel_admin:${appointmentId}`, expectedVersion: appointment.version ?? 1 },
    );
  };

  const footerLabel =
    visibleStep === "booking"
      ? !selectedBarber
        ? "Wybierz barbera"
        : reschedulingAppointment
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
      ? !selectedBarber || !canContinue || isSaving
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
      serviceId: serviceCatalogReady ? services[0]?.id ?? "" : "",
      dateKey: adminSelectedKey >= todayKey ? adminSelectedKey : todayKey,
      startTime: "18:00",
    });
  };

  const openClientCreator = (saveMode: ClientSaveMode = "record") => {
    setClientDraft({ firstName: "", lastName: "", email: "", phone: "" });
    setClientSaveMode(saveMode);
    setClientFeedback(null);
    resetManualBookingDraft();
    setClientDialog({ mode: "create" });
  };

  const openCalendarAppointmentCreator = () => {
    setCalendarClientSearch("");
    setCalendarClientPickerOpen(true);
  };

  const openNewCalendarClientBooking = () => {
    setCalendarClientPickerOpen(false);
    openClientCreator("booking");
  };

  const openManualClientBooking = (client: AdminClientProfile) => {
    setCalendarClientPickerOpen(false);
    setSelectedAdminClientId(null);
    setClientFeedback(null);
    resetManualBookingDraft();
    setClientDialog({ mode: "book", clientId: client.id });
  };

  const openWaitlistBooking = (entry: WaitlistEntry) => {
    const phoneDigits = getPhoneDigits(entry.phone);
    const normalizedEmail = entry.clientEmail.trim().toLocaleLowerCase("pl");
    const matchingClient = adminClientProfiles.find((client) => {
      const sameUser = client.appointments.some(
        (appointment) => appointment.userId === entry.userId,
      );
      const samePhone =
        phoneDigits.length === 9 && getPhoneDigits(client.phone) === phoneDigits;
      const sameEmail =
        Boolean(normalizedEmail) &&
        client.email.trim().toLocaleLowerCase("pl") === normalizedEmail;
      return sameUser || samePhone || sameEmail;
    });
    const todayKey = dayKey(today);
    const suggestedTime =
      entry.offer?.startTime ??
      ({ any: "18:00", morning: "09:00", afternoon: "13:00", evening: "18:00" } as const)[
        entry.timePreference
      ];

    setCalendarClientPickerOpen(false);
    setSelectedAdminClientId(null);
    setClientFeedback(null);
    setManualBookingDraft({
      serviceId: services.some((service) => service.id === entry.serviceId)
        ? entry.serviceId
        : services[0]?.id ?? "",
      dateKey: entry.offer?.dateKey ?? (entry.dateFrom >= todayKey ? entry.dateFrom : todayKey),
      startTime: suggestedTime,
    });

    if (matchingClient) {
      setClientDialog({
        mode: "book",
        clientId: matchingClient.id,
        waitlistEntryId: entry.id,
      });
      return;
    }

    const name = splitClientName(entry.clientName);
    setClientDraft({
      firstName: name.firstName,
      lastName: name.lastName,
      email: entry.clientEmail,
      phone: formatPhoneNumber(phoneDigits),
    });
    setClientSaveMode("booking");
    setClientDialog({ mode: "create", waitlistEntryId: entry.id });
  };

  const handleSaveClientFromDialog = async () => {
    if (!clientDialog || !isAdmin || isClientSaving) return;

    const isCreating = clientDialog.mode === "create";
    const shouldBook = clientDialog.mode === "book" || clientSaveMode === "booking";
    if (isCreating && !canAccessAdminClients) {
      setClientFeedback({
        kind: "error",
        message: "Nie masz uprawnień do tworzenia nowych kart klientów.",
      });
      return;
    }
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
    if (shouldBook && !serviceCatalogReady) {
      setClientFeedback({
        kind: "error",
        message: barberServicesError || "Poczekaj na pobranie usług wybranego barbera.",
      });
      return;
    }
    if (shouldBook && services.length === 0) {
      setClientFeedback({
        kind: "error",
        message: "Najpierw dodaj aktywną usługę w sekcji Usługi.",
      });
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
      manualBookingWaitlistEntry?.userId ||
      undefined;
    const name = splitClientName(fullName);
    const now = getTimestamp();
    const existingRecord = clientRecords.find((record) => record.id === clientId);
    const clientRecord = {
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
      hiddenFor: {
        ...(existingRecord?.hiddenFor ?? {}),
        [activeBarberId]: false,
      },
      createdAt: existingRecord?.createdAt ?? now,
      updatedAt: now,
    } satisfies ClientRecord;
    const appointmentIds =
      matchingClient && matchingClient.id !== clientId
        ? matchingClient.appointments.map((appointment) => appointment.id)
        : [];

    let manualAppointment: AdminAppointment | null = null;
    if (shouldBook && manualBookingService) {
      const appointmentId = createEntityId("appointment");
      manualAppointment = {
        id: appointmentId,
        barberId: activeBarberId,
        clientId,
        serviceId: manualBookingService.id,
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
    }

    try {
      setIsClientSaving(true);
      const result =
        !canAccessAdminClients && manualAppointment
          ? await runAppointmentOperation(
              "create_admin",
              { appointment: manualAppointment },
              { key: `create_admin:${manualAppointment.id}`, expectedVersion: 0 },
            )
          : await runAppointmentOperation(
              "upsert_admin_client",
              {
                barberId: activeBarberId,
                client: clientRecord,
                appointmentIds,
                ...(manualAppointment ? { appointment: manualAppointment } : {}),
              },
              { key: `upsert_admin_client:${clientId}`, expectedVersion: 0 },
            );
      if (manualAppointment) {
        const savedAppointment = result.appointment ?? manualAppointment;
        setAdminSelectedKey(savedAppointment.dateKey);
      }
      setClientDialog(null);
      setClientFeedback({
        kind: "success",
        message: manualAppointment
          ? `Wizyta zapisana: ${adminClientDateFormatter.format(
              dateFromKey(manualAppointment.dateKey),
            )}, ${manualAppointment.startTime}.`
          : matchingClient
            ? "Dane klienta zostały połączone z istniejącą kartą."
            : "Klient został dodany do bazy.",
      });
    } catch (error) {
      setClientFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Nie udało się zapisać wizyty.",
      });
    } finally {
      setIsClientSaving(false);
    }
  };

  const removeClientFromDirectory = async () => {
    if (!pendingClientRemovalId || !isAdmin || isClientSaving) return;

    try {
      setIsClientSaving(true);
      await runAppointmentOperation(
        "delete_admin_client",
        { clientId: pendingClientRemovalId, barberId: activeBarberId },
        { key: `delete_admin_client:${pendingClientRemovalId}`, expectedVersion: 0 },
      );
      setPendingClientRemovalId(null);
      setSelectedAdminClientId(null);
      setClientFeedback({
        kind: "success",
        message: "Klient i jego historia wizyt zostały trwale usunięte z bazy.",
      });
    } catch {
      setClientFeedback({ kind: "error", message: "Nie udało się usunąć klienta z kartoteki." });
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
      const settledAmount = getServicePriceValue(appointment.price);
      await runAppointmentOperation(
        "settle_admin",
        { appointmentId: appointment.id, amount: settledAmount },
        {
          key: `settle_admin:${appointment.id}`,
          expectedVersion: appointment.version ?? 1,
        },
      );
    } finally {
      setSettlingAppointmentId(null);
    }
  };

  const markAdminAppointmentNoShow = async (appointment: AdminAppointment) => {
    if (!isAdmin || isSaving || !isPotentialNoShow(appointment, currentDate)) return;
    if (!window.confirm(`Oznaczyć nieobecność klienta ${appointment.clientName}?`)) return;

    try {
      setIsSaving(true);
      await runAppointmentOperation(
        "mark_no_show_admin",
        { appointmentId: appointment.id },
        {
          key: `mark_no_show_admin:${appointment.id}`,
          expectedVersion: appointment.version ?? 1,
        },
      );
    } finally {
      setIsSaving(false);
    }
  };

  const renderCalendarAppointmentActions = (appointment: AdminAppointment, mobile = false) => {
    const status = normalizeAppointmentStatus(appointment.status);
    const isClosed = isClosedAppointmentStatus(status);
    const potentialNoShow = isPotentialNoShow(appointment, currentDate);
    const settlementAvailable = canSettleAppointment(appointment, currentDate);
    const awaitsAdminConfirmation =
      status === "rescheduled" && appointment.rescheduledBy !== "admin";
    const canEdit = !isClosed && !potentialNoShow;

    if (isClosed) return null;

    return (
      <div className={mobile ? "mobile-agenda-actions" : "appointment-actions"}>
        {awaitsAdminConfirmation ? (
          <button
            className="confirm"
            type="button"
            disabled={isSaving}
            onClick={() => void confirmClientRescheduledAppointment(appointment.id)}
          >
            Potwierdź
          </button>
        ) : null}
        {settlementAvailable ? (
          <button
            className="settle"
            type="button"
            disabled={Boolean(settlingAppointmentId)}
            onClick={() => void settleAdminAppointment(appointment)}
          >
            {settlingAppointmentId === appointment.id ? "Zapis..." : "Rozlicz"}
          </button>
        ) : null}
        {potentialNoShow ? (
          <button
            className="no-show"
            type="button"
            disabled={isSaving}
            onClick={() => void markAdminAppointmentNoShow(appointment)}
          >
            Nieobecność
          </button>
        ) : null}
        {canEdit ? (
          <>
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
              className={mobile ? "decline" : "decline-button"}
              type="button"
              onClick={() => declineAdminAppointment(appointment.id)}
            >
              Anuluj
            </button>
          </>
        ) : null}
      </div>
    );
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
  const renderAdminWorkspaceTabs = () => (
    <nav className="admin-workspace-tabs" role="tablist" aria-label="Widok terminów i klientów">
      <button
        className={adminWorkspaceTab === "upcoming" ? "active" : ""}
        type="button"
        role="tab"
        aria-selected={adminWorkspaceTab === "upcoming"}
        onClick={() => setAdminWorkspaceTab("upcoming")}
      >
        <Clock className="workspace-tab-icon upcoming" aria-hidden="true" strokeWidth={2.1} />
        <span>Najbliższe</span>
        <small>{Math.min(4, upcomingAdminAppointments.length)}</small>
      </button>
      {canAccessAdminSchedule ? (
        <button
          className={adminWorkspaceTab === "schedule" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={adminWorkspaceTab === "schedule"}
          onClick={() => setAdminWorkspaceTab("schedule")}
        >
          <Calendar className="workspace-tab-icon schedule" aria-hidden="true" strokeWidth={2.1} />
          <span>Kalendarz</span>
        </button>
      ) : null}
      {canAccessAdminClients ? (
        <button
          className={adminWorkspaceTab === "clients" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={adminWorkspaceTab === "clients"}
          onClick={() => setAdminWorkspaceTab("clients")}
        >
          <Users className="workspace-tab-icon clients" aria-hidden="true" strokeWidth={2.1} />
          <span>Klienci</span>
        </button>
      ) : null}
    </nav>
  );
  if (!authReady || (activeUser && !sessionReady)) {
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
      <>
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
                Zaloguj się, wybierz barbera, usługę i godzinę, która pasuje do Twojego dnia.
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

            <button
              className="install-guide-trigger"
              type="button"
              onClick={() => setInstallGuideOpen(true)}
            >
              <span className="install-guide-trigger-icon" aria-hidden="true">
                <Smartphone />
              </span>
              <span className="install-guide-trigger-copy">
                <strong>Zainstaluj aplikację</strong>
                <small>Instrukcja dla iPhone&apos;a i Androida</small>
              </span>
              <span className="install-guide-trigger-browsers" aria-hidden="true">
                <Compass />
                <ChromeBrandIcon />
              </span>
              <ChevronRight className="install-guide-trigger-chevron" aria-hidden="true" />
            </button>

            {authError ? <p className="auth-error">{authError}</p> : null}
          </section>
        </main>
        {installGuideOpen ? (
          <InstallGuideDialog onClose={closeInstallGuide} />
        ) : null}
      </>
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
                  setAdminWorkspaceTab("upcoming");
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
            <span className="owner-topbar-spacer" />
          </div>

          {isOwner && !selectedBarber ? (
            <div className="owner-barber-select" aria-label="Wybór barbera">
              <header className="owner-barber-heading">
                <p className="eyebrow">Panel zespołu</p>
                <h2>Czyj panel chcesz otworzyć?</h2>
                <span>Każdy barber ma osobne terminy, analizę, pracę, usługi i profil.</span>
                <button
                  className="owner-team-button"
                  type="button"
                  onClick={() => {
                    const firstBarberId = teamMembers[0]?.id;
                    if (firstBarberId) openOwnerBarberPanel(firstBarberId, "team");
                  }}
                  disabled={teamMembers.length === 0}
                >
                  <span className="team-icon" aria-hidden="true" />
                  Zarządzaj zespołem
                </button>
              </header>

              <div className="owner-barber-grid">
                {ownerBarberSummaries.map((barber) => (
                  <button
                    className={`owner-barber-card ${barber.accent}`}
                    type="button"
                    key={barber.id}
                    onClick={() => openOwnerBarberPanel(barber.id)}
                    aria-label={`Otwórz pełny panel barbera ${barber.name}`}
                  >
                    <ProfileAvatar
                      className="owner-barber-avatar"
                      name={barber.name}
                      photoUrl={barber.photoUrl}
                    />
                    <span className="owner-barber-main">
                      <small>
                        {barber.label} · {barber.active ? "aktywne" : "wyłączone"}
                      </small>
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
              {adminSection !== "team" ? (
                <div className="selected-barber-context" aria-label="Wybrany barber">
                <ProfileAvatar
                  className={`selected-barber-avatar ${activeClientBarber.accent}`}
                  name={activeBarberName}
                  photoUrl={activeBarberProfile.photoUrl}
                />
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
              ) : null}

              <div className="admin-content-frame">
            <div
              className={`admin-tab-panel admin-workspace-panel nearest-workspace-panel ${
                adminSection === "schedule" && adminWorkspaceTab === "upcoming" ? "active" : ""
              }`}
            >
              {renderAdminWorkspaceTabs()}
              <div className="admin-section-header nearest-section-header">
                <div>
                  <p className="eyebrow">Pierwszy rzut oka</p>
                  <h2>4 najbliższe wizyty</h2>
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie najbliższych wizyt">
                  <span>
                    <strong>{upcomingAdminAppointments.length}</strong>
                    nadchodzących
                  </span>
                  <span>
                    <strong>
                      {
                        upcomingAdminAppointments.filter(
                          (appointment) => appointment.dateKey === dayKey(today),
                        ).length
                      }
                    </strong>
                    dzisiaj
                  </span>
                </div>
              </div>

              <div className="nearest-appointments-view">
                {nearestAdminAppointments.length > 0 ? (
                  <div className="nearest-appointments-list">
                    {nearestAdminAppointments.map((appointment, index) => {
                      const client = adminClientProfiles.find((profile) =>
                        profile.appointments.some((item) => item.id === appointment.id),
                      );
                      const appointmentStart = getAppointmentDateTime(appointment);
                      const appointmentEnd = getAppointmentEndDateTime(appointment);
                      const isInProgress =
                        appointmentStart.getTime() <= currentDate.getTime() &&
                        appointmentEnd.getTime() > currentDate.getTime();
                      const nearestAppointmentLabel =
                        index === 0
                          ? formatNearestAppointmentLabel({
                              distanceLabel: getAppointmentDistanceLabel(
                                appointment.dateKey,
                                today,
                              ),
                              startTime: appointment.startTime,
                              startTimestamp: appointmentStart.getTime(),
                              nowTimestamp: currentDate.getTime(),
                            })
                          : "";
                      const settlementAvailable = canSettleAppointment(appointment, currentDate);
                      const hasPhone = getPhoneDigits(client?.phone ?? appointment.phone ?? "").length === 9;

                      return (
                        <article
                          className={`nearest-appointment-card ${appointment.color} ${
                            index === 0 ? "primary" : ""
                          }`}
                          key={appointment.id}
                        >
                          <div
                            className={`nearest-appointment-order ${
                              index === 0 ? "primary-label" : ""
                            }`}
                          >
                            {index === 0 ? (
                              <strong>{nearestAppointmentLabel}</strong>
                            ) : (
                              <>
                                <span>{index + 1}</span>
                                <small>
                                  {getAppointmentDistanceLabel(appointment.dateKey, today)}
                                </small>
                              </>
                            )}
                          </div>
                          <div className="nearest-appointment-time">
                            <strong>{appointment.startTime}</strong>
                            <span>
                              do {addMinutesToTime(appointment.startTime, appointment.durationMinutes)}
                            </span>
                          </div>
                          <ProfileAvatar
                            className="nearest-appointment-avatar"
                            name={appointment.clientName}
                            photoUrl={appointment.clientPhotoUrl}
                          />
                          <div className="nearest-appointment-main">
                            <small>
                              {adminClientDateFormatter.format(dateFromKey(appointment.dateKey))}
                            </small>
                            <h3>{appointment.clientName}</h3>
                            <span>{appointment.serviceName} · {appointment.price}</span>
                          </div>
                          <div className="nearest-appointment-state">
                            {isInProgress ? <strong>W trakcie</strong> : null}
                            <em
                              className={`appointment-status ${normalizeAppointmentStatus(
                                appointment.status,
                              )}`}
                            >
                              {appointmentStatusLabels[normalizeAppointmentStatus(appointment.status)]}
                            </em>
                          </div>
                          <div className="nearest-appointment-actions">
                            {canAccessAdminSchedule && settlementAvailable ? (
                              <button
                                className="settle"
                                type="button"
                                disabled={Boolean(settlingAppointmentId)}
                                onClick={() => void settleAdminAppointment(appointment)}
                              >
                                {settlingAppointmentId === appointment.id ? "Zapisywanie..." : "Rozlicz"}
                              </button>
                            ) : null}
                            {canAccessAdminSchedule ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAdminSelectedKey(appointment.dateKey);
                                  setAdminWorkspaceTab("schedule");
                                  openAdminAppointmentEdit(appointment);
                                }}
                              >
                                Edytuj
                              </button>
                            ) : null}
                            {canAccessAdminClients && client ? (
                              <button
                                type="button"
                                onClick={() => setSelectedAdminClientId(client.id)}
                              >
                                Karta
                              </button>
                            ) : null}
                            {canAccessAdminClients && client && hasPhone ? (
                              <button
                                className="sms"
                                type="button"
                                onClick={() => openSmsComposer(client, appointment)}
                              >
                                SMS
                              </button>
                            ) : null}
                            {canAccessAdminSchedule ? (
                              <button
                                className="cancel"
                                type="button"
                                onClick={() => void declineAdminAppointment(appointment.id)}
                                aria-label={`Odwołaj wizytę ${appointment.clientName} o ${appointment.startTime}`}
                              >
                                Odwołaj
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="nearest-appointments-empty">
                    <span className="workspace-empty-icon" aria-hidden="true" />
                    <strong>Brak nadchodzących wizyt</strong>
                    <p>Nowe rezerwacje pojawią się tutaj automatycznie.</p>
                    {canAccessAdminClients ? (
                      <button type="button" onClick={() => setAdminWorkspaceTab("clients")}>
                        Przejdź do klientów
                      </button>
                    ) : canAccessAdminSchedule ? (
                      <button type="button" onClick={() => setAdminWorkspaceTab("schedule")}>
                        Otwórz kalendarz
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <section className="admin-waitlist" aria-labelledby="admin-waitlist-title">
                <header>
                  <span className="admin-waitlist-icon" aria-hidden="true">
                    <BellRing />
                  </span>
                  <div>
                    <p className="eyebrow">Automatyczne uzupełnianie luk</p>
                    <h3 id="admin-waitlist-title">Lista rezerwowa</h3>
                  </div>
                  <strong>{adminWaitlistEntries.length}</strong>
                </header>
                {adminWaitlistEntries.length > 0 ? (
                  <div className="admin-waitlist-list">
                    {adminWaitlistEntries.map((entry) => {
                      const phoneDigits = getPhoneDigits(entry.phone);
                      const offerMinutes = entry.offer
                        ? Math.max(
                            0,
                            Math.ceil(
                              (Number(entry.offer.expiresAt) - currentDate.getTime()) / 60000,
                            ),
                          )
                        : 0;
                      return (
                        <article
                          className={`admin-waitlist-row ${entry.status}`}
                          key={entry.id}
                        >
                          <ProfileAvatar
                            className="admin-waitlist-avatar"
                            name={entry.clientName}
                          />
                          <div className="admin-waitlist-main">
                            <span>
                              <strong>{entry.clientName}</strong>
                              <em>{entry.status === "offered" ? "Oferta wysłana" : "Oczekuje"}</em>
                            </span>
                            <small>{entry.serviceName}</small>
                            <p>
                              {entry.dateFrom === entry.dateTo
                                ? adminClientDateFormatter.format(dateFromKey(entry.dateFrom))
                                : `${dayFormatter.format(dateFromKey(entry.dateFrom))} – ${dayFormatter.format(
                                    dateFromKey(entry.dateTo),
                                  )}`}
                              {" · "}
                              {waitlistTimePreferenceLabels[entry.timePreference]}
                            </p>
                            {entry.offer ? (
                              <b>
                                {entry.offer.dateKey}, {entry.offer.startTime} · jeszcze {offerMinutes} min
                              </b>
                            ) : null}
                          </div>
                          <div className="admin-waitlist-actions">
                            {canAccessAdminSchedule ? (
                              <button
                                className="admin-waitlist-book"
                                type="button"
                                onClick={() => openWaitlistBooking(entry)}
                                aria-label={`Umów wizytę dla ${entry.clientName}`}
                              >
                                <CalendarPlus aria-hidden="true" />
                                <span>Umów</span>
                              </button>
                            ) : null}
                            {phoneDigits.length === 9 ? (
                              <>
                                <a href={`tel:+48${phoneDigits}`} aria-label={`Zadzwoń do ${entry.clientName}`}>
                                  <Phone aria-hidden="true" />
                                </a>
                                <a href={`sms:+48${phoneDigits}`} aria-label={`Napisz SMS do ${entry.clientName}`}>
                                  <MessageSquare aria-hidden="true" />
                                </a>
                              </>
                            ) : null}
                            <button
                              type="button"
                              disabled={isWaitlistSaving}
                              onClick={() => void removeAdminWaitlistEntry(entry)}
                              aria-label={`Usuń ${entry.clientName} z listy rezerwowej`}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="admin-waitlist-empty">
                    <strong>Nikt teraz nie oczekuje</strong>
                    <span>Nowe zgłoszenia klientów pojawią się tutaj automatycznie.</span>
                  </div>
                )}
              </section>
            </div>

            <div
              className={`admin-tab-panel admin-workspace-panel ${
                adminSection === "schedule" && adminWorkspaceTab === "schedule" ? "active" : ""
              }`}
            >
              {renderAdminWorkspaceTabs()}
              <div className="admin-section-header schedule-section-header">
                <div className="schedule-heading-main">
                  <p className="eyebrow">Wybrany dzień</p>
                  <h2>{adminClientDateFormatter.format(dateFromKey(adminSelectedKey))}</h2>
                  <button
                    className="schedule-add-appointment"
                    type="button"
                    onClick={openCalendarAppointmentCreator}
                  >
                    <span aria-hidden="true">+</span>
                    Dodaj wizytę
                  </button>
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
                      adminDayAppointments.map((appointment) => {
                        const calendarState = getCalendarAppointmentState(appointment, currentDate);

                        return (
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
                          <em className={`appointment-status ${calendarState.className}`}>
                            {calendarState.label}
                          </em>
                          {renderCalendarAppointmentActions(appointment, true)}
                          </article>
                        );
                      })
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
                      const calendarState = getCalendarAppointmentState(appointment, currentDate);
                      const appointmentIsEditable =
                        !isClosedAppointmentStatus(appointment.status) &&
                        !isPotentialNoShow(appointment, currentDate);

                      return (
                        <article
                          className={`admin-appointment ${appointment.color}`}
                          draggable={
                            !isTouchDevice &&
                            appointmentIsEditable
                          }
                          key={appointment.id}
                          onDragStart={() => {
                            if (appointmentIsEditable) {
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
                            <small className={`appointment-status ${calendarState.className}`}>
                              {calendarState.label}
                            </small>
                          </div>
                          {renderCalendarAppointmentActions(appointment)}
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`admin-tab-panel admin-workspace-panel ${
                adminSection === "schedule" && adminWorkspaceTab === "clients" ? "active" : ""
              }`}
            >
              {renderAdminWorkspaceTabs()}
              <div className="admin-section-header">
                <div className="client-section-title">
                  <div>
                    <p className="eyebrow">
                      {clientWorkspaceTab === "appointments" ? "Bieżąca obsługa" : "Kartoteka kontaktów"}
                    </p>
                    <h2>{clientWorkspaceTab === "appointments" ? "Aktywne wizyty" : "Klienci"}</h2>
                  </div>
                  {canAccessAdminClients ? (
                    <button className="add-client-button" type="button" onClick={() => openClientCreator()}>
                      <span aria-hidden="true">+</span>
                      Dodaj klienta
                    </button>
                  ) : null}
                </div>
                <div className="admin-section-stats" aria-label="Podsumowanie klientów">
                  <span>
                    <strong>
                      {clientWorkspaceTab === "appointments"
                        ? activeAdminClientProfiles.length
                        : directoryAdminClientProfiles.length}
                    </strong>
                    {clientWorkspaceTab === "appointments" ? "aktywnych" : "klientów"}
                  </span>
                  <span>
                    <strong>
                      {clientWorkspaceTab === "appointments"
                        ? activeAdminClientProfiles.filter((client) => client.rescheduledCount > 0).length
                        : directoryAdminClientProfiles.filter((client) => !client.nextAppointment).length}
                    </strong>
                    {clientWorkspaceTab === "appointments" ? "do potwierdzenia" : "bez wizyty"}
                  </span>
                </div>
              </div>

              <div className="clients-view" aria-label="Lista klientów">
                <div className="client-workspace-tabs" role="tablist" aria-label="Widok bazy klientów">
                  <button
                    className={clientWorkspaceTab === "appointments" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={clientWorkspaceTab === "appointments"}
                    onClick={() => {
                      setClientWorkspaceTab("appointments");
                      setClientFilter("all");
                      setClientSearch("");
                    }}
                  >
                    <Calendar
                      className="client-workspace-tab-icon appointments"
                      aria-hidden="true"
                      strokeWidth={2.1}
                    />
                    Aktywne wizyty
                    <small>{activeAdminClientProfiles.length}</small>
                  </button>
                  <button
                    className={clientWorkspaceTab === "directory" ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={clientWorkspaceTab === "directory"}
                    onClick={() => {
                      setClientWorkspaceTab("directory");
                      setClientFilter("all");
                      setClientSearch("");
                    }}
                  >
                    <Users
                      className="client-workspace-tab-icon directory"
                      aria-hidden="true"
                      strokeWidth={2.1}
                    />
                    Klienci
                    <small>{directoryAdminClientProfiles.length}</small>
                  </button>
                </div>

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
                      (clientWorkspaceTab === "appointments"
                        ? [
                            ["all", "Wszystkie"],
                            ["upcoming", "Nadchodzące"],
                            ["rescheduled", "Do potwierdzenia"],
                          ]
                        : [
                            ["all", "Wszyscy"],
                            ["upcoming", "Z terminem"],
                            ["missing-phone", "Brak telefonu"],
                          ]) as [ClientFilter, string][]
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
                          <ProfileAvatar
                            className="client-row-avatar"
                            name={client.name}
                            photoUrl={client.photoUrl}
                          />
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
                          {canAccessAdminSchedule && settlementAppointment ? (
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
                          {canAccessAdminSchedule ? (
                            <button
                              className="book-client-button"
                              type="button"
                              onClick={() => openManualClientBooking(client)}
                              aria-label={`Umów wizytę dla ${client.name}`}
                              title="Umów wizytę"
                            >
                              <Calendar className="small-calendar-icon" aria-hidden="true" strokeWidth={2.1} />
                            </button>
                          ) : null}
                          {hasPhone ? (
                            <a
                              className="client-phone-button"
                              href={`tel:+48${phoneDigits}`}
                              aria-label={`Zadzwoń do ${client.name}`}
                              title="Zadzwoń"
                            >
                              <Phone className="phone-icon" aria-hidden="true" strokeWidth={2.1} />
                            </a>
                          ) : (
                            <span className="client-phone-button disabled" aria-label="Brak numeru telefonu">
                              <Phone className="phone-icon" aria-hidden="true" strokeWidth={2.1} />
                            </span>
                          )}
                          {contactAppointment ? (
                            <button
                              className="sms-button"
                              type="button"
                              disabled={!hasPhone}
                              onClick={() => openSmsComposer(client, contactAppointment)}
                              aria-label={hasPhone ? `Napisz SMS do ${client.name}` : "Brak numeru telefonu"}
                            >
                              <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                            </button>
                          ) : hasPhone ? (
                            <a
                              className="sms-button"
                              href={`sms:+48${phoneDigits}`}
                              aria-label={`Napisz SMS do ${client.name}`}
                            >
                              <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                            </a>
                          ) : (
                            <span className="sms-button disabled" aria-label="Brak numeru telefonu">
                              <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                            </span>
                          )}
                          {client.email ? (
                            <a
                              className="client-email-button"
                              href={`mailto:${client.email}?subject=${encodeURIComponent("BNB Barbershop - Twoja wizyta")}`}
                              aria-label={`Napisz e-mail do ${client.name}`}
                            >
                              <Mail className="email-icon" aria-hidden="true" strokeWidth={2.1} />
                            </a>
                          ) : (
                            <span className="client-email-button disabled" aria-label="Brak adresu e-mail">
                              <Mail className="email-icon" aria-hidden="true" strokeWidth={2.1} />
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
                      <strong>
                        {clientWorkspaceTab === "appointments"
                          ? "Brak aktywnych wizyt"
                          : "Brak pasujących klientów"}
                      </strong>
                      <span>
                        {clientWorkspaceTab === "appointments"
                          ? "Klienci z nadchodzącym terminem lub wizytą do rozliczenia pojawią się tutaj."
                          : "Zmień filtr albo wyczyść wyszukiwanie."}
                      </span>
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

            {isOwner ? (
              <div className={`admin-tab-panel ${adminSection === "team" ? "active" : ""}`}>
                <div className="admin-section-header team-section-header">
                  <div>
                    <p className="eyebrow">Ustawienia właściciela</p>
                    <h2>Zespół BNB</h2>
                  </div>
                  <div className="admin-section-stats" aria-label="Stan zespołu">
                    <span>
                      <strong>{teamMembers.length}</strong>
                      barberzy
                    </span>
                    <span>
                      <strong>{activeTeamMembersCount}</strong>
                      aktywne konta
                    </span>
                  </div>
                </div>

                <div className="team-management-view">
                  <div className="team-management-toolbar">
                    <div>
                      <p className="section-label">Stały skład</p>
                      <strong>Konta i zakres dostępu</strong>
                    </div>
                  </div>

                  {teamFeedback && !teamDialogMemberId ? (
                    <p className={`work-feedback ${teamFeedback.kind}`}>{teamFeedback.message}</p>
                  ) : null}

                  <div className="team-member-list">
                    {teamMembers.map((member) => {
                      const profile = barberProfiles[member.id] ?? emptyBarberDetails;
                      return (
                        <article
                          className={`team-member-card ${member.active ? "active" : "inactive"}`}
                          key={member.id}
                        >
                          <header className="team-member-header">
                            <ProfileAvatar
                              className={`team-member-avatar ${member.accent}`}
                              name={profile.displayName || member.name}
                              photoUrl={profile.photoUrl}
                            />
                            <div>
                              <small>{member.label}</small>
                              <strong>{profile.displayName || member.name}</strong>
                              <span>
                                {member.email || profile.email || "Brak adresu e-mail"}
                              </span>
                            </div>
                            <label className="team-active-switch">
                              <input
                                type="checkbox"
                                checked={member.active}
                                disabled={isTeamSaving}
                                onChange={(event) =>
                                  void updateTeamMemberActive(member, event.target.checked)
                                }
                              />
                              <span aria-hidden="true" />
                              {member.active ? "Aktywne" : "Wyłączone"}
                            </label>
                          </header>

                          <div className="team-member-account">
                            <span>
                              <small>Konto Google</small>
                              <strong>Połączone</strong>
                            </span>
                            <div className="team-member-account-actions">
                              <button type="button" onClick={() => openTeamMemberEditDialog(member)}>
                                Edytuj dane
                              </button>
                            </div>
                          </div>

                          <div className="team-member-quick-actions">
                            <button
                              type="button"
                              onClick={() => openOwnerBarberPanel(member.id, "schedule")}
                            >
                              <span className="schedule-icon" aria-hidden="true" />
                              Terminarz
                            </button>
                            <button
                              type="button"
                              onClick={() => openOwnerBarberPanel(member.id, "analytics")}
                            >
                              <span className="analytics-icon" aria-hidden="true" />
                              Analiza
                            </button>
                          </div>

                          <fieldset className="team-access-grid">
                            <legend>Zakres dostępu</legend>
                            {barberAdminSections.map((section) => (
                              <label key={section}>
                                <input
                                  type="checkbox"
                                  checked={member.access[section]}
                                  disabled={isTeamSaving}
                                  onChange={(event) =>
                                    void updateTeamMemberAccess(
                                      member,
                                      section,
                                      event.target.checked,
                                    )
                                  }
                                />
                                <span aria-hidden="true" />
                                {teamAccessLabels[section]}
                              </label>
                            ))}
                          </fieldset>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

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
                  <ProfileAvatar
                    className={`barber-profile-photo ${activeClientBarber.accent}`}
                    name={activeBarberName}
                    photoUrl={profileDraft.photoUrl}
                    alt={`Profil ${activeBarberName}`}
                  />
                  <div className="barber-profile-preview-copy">
                    <p className="eyebrow">{activeClientBarber.label}</p>
                    <h3>{profileDraft.displayName || activeClientBarber.name}</h3>
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
                        placeholder={activeClientBarber.name}
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

          <nav
            className={`admin-bottom-nav ${isOwner ? "owner-nav" : ""}`}
            style={
              {
                "--admin-nav-items": visibleAdminSections.length,
                "--admin-nav-index": activeAdminNavIndex,
              } as CSSProperties
            }
            aria-label="Sekcje admina"
          >
            <span className="admin-nav-pill" aria-hidden="true" />
            {visibleAdminSections.map((section) => {
              const NavigationIcon = adminNavigationIcons[section];
              return (
                <button
                  className={adminSection === section ? "active" : ""}
                  key={section}
                  type="button"
                  onClick={() => {
                    setAdminSection(section);
                    if (section === "schedule") setAdminWorkspaceTab("upcoming");
                  }}
                >
                  <NavigationIcon
                    className="admin-nav-icon"
                    aria-hidden="true"
                    strokeWidth={1.9}
                  />
                  <span>{adminNavigationLabels[section]}</span>
                </button>
              );
            })}
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
              <div className="session-actions">
                <div className="session-pill">
                  <ProfileAvatar
                    className="session-avatar"
                    name={activeUser.displayName ?? activeUser.email ?? "Klient"}
                    photoUrl={activeUser.photoURL}
                  />
                  <strong>{activeUser.displayName ?? activeUser.email ?? "Klient"}</strong>
                  <button
                    type="button"
                    onClick={() => {
                      void handleSignOut();
                    }}
                  >
                    Wyloguj
                  </button>
                </div>
                {!isOwner ? (
                  <button
                    className={`push-toggle-button ${pushDeviceStatus} ${isPushDeviceUpdating ? "updating" : ""}`}
                    type="button"
                    aria-label={pushDeviceLabel}
                    aria-pressed={pushDeviceEnabled}
                    aria-busy={isPushDeviceUpdating}
                    title={pushDeviceLabel}
                    disabled={isPushDeviceUpdating || pushDeviceStatus === "checking"}
                    onClick={() => void handlePushDeviceToggle()}
                  >
                    <Bell size={18} strokeWidth={2.15} aria-hidden="true" />
                    <span className="push-toggle-status-dot" aria-hidden="true" />
                  </button>
                ) : null}
                {pushDeviceFeedback ? (
                  <span
                    className={`push-device-feedback ${pushDeviceFeedback.kind}`}
                    role="status"
                  >
                    {pushDeviceFeedback.message}
                  </span>
                ) : null}
              </div>
              {isAdmin ? (
                <button
                  className="avatar-button"
                  type="button"
                  onClick={() => setStep("admin")}
                  aria-label="Otwórz profil admina"
                >
                  <ProfileAvatar
                    className="admin-user-avatar"
                    name={isBarber ? signedInBarberName : activeUser.displayName ?? activeUser.email ?? "Admin"}
                    photoUrl={isBarber ? signedInBarberProfile.photoUrl : activeUser.photoURL}
                  />
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
                    {reschedulingClientBarber ? (
                      <span className="client-visit-barber">
                        <ProfileAvatar
                          className={`client-visit-barber-avatar ${reschedulingClientBarber.accent}`}
                          name={reschedulingClientBarber.name}
                          photoUrl={reschedulingClientBarber.photoUrl}
                        />
                        <span>{reschedulingClientBarber.name}</span>
                      </span>
                    ) : null}
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
                    {nearestClientAppointmentBarber ? (
                      <span className="client-visit-barber">
                        <ProfileAvatar
                          className={`client-visit-barber-avatar ${nearestClientAppointmentBarber.accent}`}
                          name={nearestClientAppointmentBarber.name}
                          photoUrl={nearestClientAppointmentBarber.photoUrl}
                        />
                        <span>{nearestClientAppointmentBarber.name}</span>
                      </span>
                    ) : null}
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
                    <span>Nową wizytę umówisz poniżej w czterech krótkich krokach.</span>
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
                <li className={selectedBarber ? "complete" : "active"}>
                  <button
                    type="button"
                    onClick={() => scrollToBookingSection(bookingBarberRef.current)}
                  >
                    <span>1</span> Barber
                  </button>
                </li>
                <li className={selectedBarber ? "complete" : ""}>
                  <button
                    type="button"
                    disabled={!selectedBarber}
                    onClick={() => scrollToBookingSection(bookingServiceRef.current)}
                  >
                    <span>2</span> Usługa
                  </button>
                </li>
                <li className={hasSelectedDay && selectedBarber ? "complete" : selectedBarber ? "active" : ""}>
                  <button
                    type="button"
                    disabled={!selectedBarber}
                    onClick={() => scrollToBookingSection(bookingCalendarRef.current)}
                  >
                    <span>3</span> Dzień
                  </button>
                </li>
                <li className={selectedTime ? "complete active" : hasSelectedDay ? "active" : ""}>
                  <button
                    type="button"
                    disabled={!hasSelectedDay}
                    onClick={() => scrollToBookingSection(bookingTimeRef.current)}
                  >
                    <span>4</span> Godzina
                  </button>
                </li>
              </ol>
            </div>

            <div className="client-barber-picker booking-scroll-target" ref={bookingBarberRef}>
              <p className="section-label">Wybierz barbera</p>
              <div className="client-barber-list">
                {clientBarberOptions.map((barber) => {
                  const isSelected = selectedBarber?.id === barber.id;
                  return (
                    <button
                      className={`client-barber-card ${barber.accent} ${isSelected ? "selected" : ""}`}
                      key={barber.id}
                      type="button"
                      disabled={Boolean(reschedulingAppointment)}
                      onClick={() => selectBookingBarber(barber.id)}
                      aria-pressed={isSelected}
                    >
                      <ProfileAvatar
                        className={`client-barber-avatar ${barber.accent}`}
                        name={barber.name}
                        photoUrl={barber.photoUrl}
                      />
                      <span className="client-barber-copy">
                        <small>{barber.label}</small>
                        <strong>{barber.name}</strong>
                        <span>
                          {barber.bio || (barber.instagram ? `@${barber.instagram}` : "BNB Barbershop")}
                        </span>
                      </span>
                      <i aria-hidden="true">{isSelected ? "✓" : "›"}</i>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedBarber ? (
              <>
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

              </>
            ) : (
              <div className="client-booking-empty" aria-live="polite">
                <span className="client-booking-empty-icon" aria-hidden="true" />
                <strong>Wybierz barbera</strong>
                <span>Usługi i wolne terminy pojawią się po wyborze.</span>
              </div>
            )}

          </section>

          <aside className="day-summary" aria-label="Szczegóły rezerwacji">
            {selectedBarber ? (
              <>
            <div className="client-selected-barber-summary">
              <ProfileAvatar
                className={`client-selected-barber-avatar ${activeClientBarber.accent}`}
                name={activeBarberName}
                photoUrl={activeBarberProfile.photoUrl}
              />
              <span>
                <small>Twój barber</small>
                <strong>{activeBarberName}</strong>
              </span>
              {!reschedulingAppointment ? (
                <button
                  type="button"
                  onClick={() => scrollToBookingSection(bookingBarberRef.current)}
                >
                  Zmień
                </button>
              ) : null}
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

            <div className={`waitlist-callout ${activeClientWaitlistEntry?.status ?? "available"}`}>
              <span className="waitlist-callout-icon" aria-hidden="true">
                {activeClientWaitlistEntry?.status === "offered" ? (
                  <CalendarClock />
                ) : (
                  <BellRing />
                )}
              </span>
              {activeClientWaitlistEntry ? (
                <div className="waitlist-callout-copy">
                  <small>
                    {activeClientWaitlistEntry.status === "offered"
                      ? "Termin czeka na Ciebie"
                      : "Jesteś na liście rezerwowej"}
                  </small>
                  <strong>
                    {activeClientWaitlistEntry.offer
                      ? `${dayFormatter.format(
                          dateFromKey(activeClientWaitlistEntry.offer.dateKey),
                        )}, ${activeClientWaitlistEntry.offer.startTime}`
                      : `${dayFormatter.format(
                          dateFromKey(activeClientWaitlistEntry.dateFrom),
                        )} – ${dayFormatter.format(
                          dateFromKey(activeClientWaitlistEntry.dateTo),
                        )}`}
                  </strong>
                  <span>
                    {activeClientWaitlistEntry.offer
                      ? `Masz jeszcze ${Math.max(
                          0,
                          Math.ceil(
                            (Number(activeClientWaitlistEntry.offer.expiresAt) -
                              currentDate.getTime()) /
                              60000,
                          ),
                        )} min na rezerwację.`
                      : waitlistTimePreferenceLabels[activeClientWaitlistEntry.timePreference]}
                  </span>
                </div>
              ) : (
                <div className="waitlist-callout-copy">
                  <small>Nie pasują dostępne godziny?</small>
                  <strong>Powiadom mnie o wolnym terminie</strong>
                  <span>Gdy ktoś odwoła wizytę, dostaniesz pierwszeństwo rezerwacji.</span>
                </div>
              )}
              <div className="waitlist-callout-actions">
                {activeClientWaitlistEntry?.status === "offered" ? (
                  <button type="button" onClick={() => acceptWaitlistOffer(activeClientWaitlistEntry)}>
                    Rezerwuję
                  </button>
                ) : activeClientWaitlistEntry ? (
                  <button
                    className="secondary"
                    type="button"
                    disabled={isWaitlistSaving}
                    onClick={() => void leaveClientWaitlist(activeClientWaitlistEntry)}
                  >
                    Wypisz mnie
                  </button>
                ) : (
                  <button type="button" onClick={openWaitlistDialog}>
                    Dołącz
                  </button>
                )}
              </div>
            </div>
            {waitlistFeedback ? (
              <p className={`waitlist-feedback ${waitlistFeedback.kind}`} role="status">
                {waitlistFeedback.message}
              </p>
            ) : null}
              </>
            ) : (
              <div className="day-summary-empty">
                <span className="client-booking-empty-icon" aria-hidden="true" />
                <strong>Wybierz barbera</strong>
                <span>Każdy barber ma własny terminarz i dostępne godziny.</span>
              </div>
            )}
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
            <span className="booking-recap-barber">
              <ProfileAvatar
                className={`booking-recap-barber-avatar ${activeClientBarber.accent}`}
                name={activeBarberName}
                photoUrl={activeBarberProfile.photoUrl}
              />
              <span>
                <small>Barber</small>
                <strong>{activeBarberName}</strong>
              </span>
            </span>
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
            {bookingError ? (
              <p className="booking-error" role="alert">
                {bookingError}
              </p>
            ) : null}
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
              <div className="success-barber">
                <ProfileAvatar
                  className="success-barber-avatar"
                  name={bookingSummary.barberName}
                  photoUrl={bookingSummary.barberPhotoUrl}
                />
                <span>
                  <small>Twój barber</small>
                  <strong>{bookingSummary.barberName}</strong>
                </span>
              </div>
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

      {teamDialogMemberId && editingTeamMember && isOwner && visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop team-member-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isTeamSaving) {
              setTeamDialogMemberId(null);
              setTeamFeedback(null);
            }
          }}
        >
          <section
            className="client-appointment-modal team-member-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-member-dialog-title"
          >
            <button
              className="modal-close-button"
              type="button"
              disabled={isTeamSaving}
              onClick={() => {
                setTeamDialogMemberId(null);
                setTeamFeedback(null);
              }}
              aria-label="Zamknij"
            >
              ×
            </button>

            <div className="team-member-dialog-heading">
              <span className="team-dialog-icon" aria-hidden="true">
                <span className="team-icon" />
              </span>
              <div>
                <p className="eyebrow">Edycja konta</p>
                <h2 id="team-member-dialog-title">{editingTeamMember.name}</h2>
              </div>
            </div>

            <form
              className="team-member-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTeamMember();
              }}
            >
              <label>
                Imię wyświetlane
                <input
                  type="text"
                  maxLength={50}
                  value={teamMemberDraft.name}
                  onChange={(event) =>
                    setTeamMemberDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  autoComplete="name"
                  required
                />
              </label>
              <label>
                E-mail
                <input
                  type="email"
                  maxLength={100}
                  value={teamMemberDraft.email}
                  onChange={(event) =>
                    setTeamMemberDraft((current) => ({ ...current, email: event.target.value }))
                  }
                  autoComplete="email"
                  placeholder="barber@gmail.com"
                />
              </label>
              <p className="team-account-help">
                E-mail jest opcjonalny i służy do powiadomień o wizytach. Dostęp Google jest przypisany na stałe.
              </p>

              {teamFeedback ? (
                <p className={`work-feedback ${teamFeedback.kind}`}>{teamFeedback.message}</p>
              ) : null}

              <div className="team-member-dialog-actions">
                <button
                  type="button"
                  disabled={isTeamSaving}
                  onClick={() => setTeamDialogMemberId(null)}
                >
                  Anuluj
                </button>
                <button className="primary" type="submit" disabled={isTeamSaving}>
                  {isTeamSaving ? "Zapisywanie..." : "Zapisz zmiany"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {calendarClientPickerOpen && visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop calendar-client-picker-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCalendarClientPickerOpen(false);
          }}
        >
          <section
            className="client-appointment-modal calendar-client-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Wybierz klienta do nowej wizyty"
          >
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setCalendarClientPickerOpen(false)}
              aria-label="Zamknij"
            >
              ×
            </button>
            <header className="client-creator-header">
              <span className="client-creator-icon" aria-hidden="true">
                <Calendar className="small-calendar-icon" strokeWidth={2.1} />
              </span>
              <div>
                <p className="eyebrow">Nowa wizyta</p>
                <h2>Wybierz klienta</h2>
              </div>
            </header>
            <label className="calendar-client-search">
              <span className="search-icon" aria-hidden="true" />
              <input
                type="search"
                autoFocus
                value={calendarClientSearch}
                onChange={(event) => setCalendarClientSearch(event.target.value)}
                placeholder="Imię, telefon lub e-mail"
              />
            </label>
            {canAccessAdminClients ? (
              <button
                className="calendar-new-client-button"
                type="button"
                onClick={openNewCalendarClientBooking}
              >
                <span aria-hidden="true">+</span>
                <strong>Nowy klient</strong>
                <small>Dodaj dane i od razu umów wizytę</small>
              </button>
            ) : null}
            <div className="calendar-client-list" aria-label="Klienci">
              {calendarBookingClients.length > 0 ? (
                calendarBookingClients.map((client) => (
                  <button
                    type="button"
                    key={client.id}
                    onClick={() => openManualClientBooking(client)}
                  >
                    <ProfileAvatar
                      className="calendar-client-avatar"
                      name={client.name}
                      photoUrl={client.photoUrl}
                    />
                    <span>
                      <strong>{client.name}</strong>
                      <small>
                        {formatPhoneNumber(getPhoneDigits(client.phone)) || client.email || "Klient z historii wizyt"}
                      </small>
                    </span>
                    <i aria-hidden="true">›</i>
                  </button>
                ))
              ) : (
                <div className="calendar-client-empty">
                  <strong>Nie znaleziono klienta</strong>
                  <span>
                    {canAccessAdminClients
                      ? "Dodaj nowego klienta powyżej."
                      : "Poproś właściciela o dostęp do Bazy klientów, aby tworzyć nowe kontakty."}
                  </span>
                </div>
              )}
            </div>
          </section>
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
                {clientDialog.mode === "create" ? "+" : <Calendar className="small-calendar-icon" strokeWidth={2.1} />}
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
                {canAccessAdminSchedule ? (
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
                ) : null}

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

            {canAccessAdminSchedule &&
            (clientDialog.mode === "book" || clientSaveMode === "booking") ? (
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
                      disabled={!serviceCatalogReady || services.length === 0}
                      onChange={(event) =>
                        setManualBookingDraft((current) => ({
                          ...current,
                          serviceId: event.target.value,
                        }))
                      }
                    >
                      {!serviceCatalogReady || services.length === 0 ? (
                        <option value="">
                          {areBarberServicesLoading || loadedServicesBarberId !== activeBarberId
                            ? "Ładowanie usług..."
                            : barberServicesError
                              ? "Nie udało się pobrać usług"
                              : "Brak aktywnych usług"}
                        </option>
                      ) : (
                        services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name} · {service.price} · {service.durationMinutes} min
                          </option>
                        ))
                      )}
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
                <div className={`manual-booking-status ${manualBookingStatus.kind}`}>
                  <span aria-hidden="true" />
                  {manualBookingStatus.message}
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
                    (!serviceCatalogReady || !manualBookingService || manualBookingHasConflict))
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
              <ProfileAvatar
                className="client-profile-avatar"
                name={selectedAdminClient.name}
                photoUrl={selectedAdminClient.photoUrl}
              />
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
                {canAccessAdminSchedule ? (
                  <button
                    className="book"
                    type="button"
                    onClick={() => openManualClientBooking(selectedAdminClient)}
                  >
                    <Calendar className="small-calendar-icon" aria-hidden="true" strokeWidth={2.1} />
                    Umów
                  </button>
                ) : null}
                {getPhoneDigits(selectedAdminClient.phone).length === 9 ? (
                  <a className="call" href={`tel:+48${getPhoneDigits(selectedAdminClient.phone)}`}>
                    <Phone className="phone-icon" aria-hidden="true" strokeWidth={2.1} />
                    Zadzwoń
                  </a>
                ) : null}
                {getPhoneDigits(selectedAdminClient.phone).length === 9 ? (
                  selectedAdminClient.appointments.length > 0 ? (
                    <button
                      className="sms-button"
                      type="button"
                      onClick={() => {
                        const appointment =
                          selectedAdminClient.nextAppointment ?? selectedAdminClient.appointments.at(-1);
                        if (appointment) openSmsComposer(selectedAdminClient, appointment);
                      }}
                    >
                      <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                      SMS
                    </button>
                  ) : (
                    <a href={`sms:+48${getPhoneDigits(selectedAdminClient.phone)}`}>
                      <MessageSquare className="sms-icon" aria-hidden="true" strokeWidth={2.1} />
                      SMS
                    </a>
                  )
                ) : null}
                {selectedAdminClient.email ? (
                  <a
                    href={`mailto:${selectedAdminClient.email}?subject=${encodeURIComponent("BNB Barbershop - Twoja wizyta")}`}
                  >
                    <Mail className="email-icon" aria-hidden="true" strokeWidth={2.1} />
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
                  <span>
                    {canAccessAdminSchedule
                      ? "Klient jest już w bazie i możesz umówić jego pierwszy termin."
                      : "Klient jest już zapisany w bazie."}
                  </span>
                  {canAccessAdminSchedule ? (
                    <button type="button" onClick={() => openManualClientBooking(selectedAdminClient)}>
                      Umów pierwszą wizytę
                    </button>
                  ) : null}
                </div>
              ) : [...selectedAdminClient.appointments].reverse().map((appointment) => {
                const isPast = getAppointmentEndDateTime(appointment).getTime() <= currentDate.getTime();
                const isRescheduled =
                  normalizeAppointmentStatus(appointment.status) === "rescheduled";
                const awaitsClientConfirmation =
                  isRescheduled && appointment.rescheduledBy === "admin";
                const awaitsAdminConfirmation =
                  isRescheduled && appointment.rescheduledBy !== "admin";
                const isCompleted =
                  normalizeAppointmentStatus(appointment.status) === "completed";
                const isCancelled =
                  normalizeAppointmentStatus(appointment.status) === "cancelled";
                const isNoShow =
                  normalizeAppointmentStatus(appointment.status) === "no_show";
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
                        {awaitsClientConfirmation
                          ? "Czeka na potwierdzenie klienta"
                          : awaitsAdminConfirmation
                            ? "Klient czeka na Twoje potwierdzenie"
                            : isCancelled
                              ? "Wizyta została odwołana"
                              : isNoShow
                                ? "Klient nie pojawił się na wizycie"
                              : isCompleted
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
                      {canAccessAdminSchedule && settlementAvailable ? (
                        <button
                          className="settle"
                          type="button"
                          disabled={Boolean(settlingAppointmentId)}
                          onClick={() => void settleAdminAppointment(appointment)}
                        >
                          {settlingAppointmentId === appointment.id ? "Zapisywanie..." : "Rozlicz"}
                        </button>
                      ) : null}
                      {canAccessAdminSchedule && potentialNoShow ? (
                        <button
                          className="no-show"
                          type="button"
                          disabled={isSaving}
                          onClick={() => void markAdminAppointmentNoShow(appointment)}
                        >
                          Nieobecność
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
                      {canAccessAdminSchedule &&
                      !isPast &&
                      !isClosedAppointmentStatus(appointment.status) ? (
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
                      {canAccessAdminSchedule && awaitsAdminConfirmation ? (
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
            {canAccessAdminClients ? (
              <footer className="client-profile-footer">
                <button
                  className="remove-client-button"
                  type="button"
                  onClick={() => setPendingClientRemovalId(selectedAdminClient.id)}
                >
                  <span className="trash-icon" aria-hidden="true" />
                  Usuń klienta
                </button>
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}

      {pendingClientRemoval && visibleStep === "admin" ? (
        <div
          className="client-modal-backdrop cancellation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isClientSaving) {
              setPendingClientRemovalId(null);
            }
          }}
        >
          <section
            className="client-appointment-modal cancellation-sheet client-removal-sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="client-removal-title"
            aria-describedby="client-removal-description"
          >
            <button
              className="modal-close-button"
              type="button"
              disabled={isClientSaving}
              onClick={() => setPendingClientRemovalId(null)}
              aria-label="Wróć bez usuwania klienta"
            >
              ×
            </button>
            <div className="modal-title">
              <p className="eyebrow">Kartoteka klientów</p>
              <h2 id="client-removal-title">Usunąć klienta?</h2>
            </div>
            <p className="cancellation-copy" id="client-removal-description">
              {pendingClientRemoval.name} oraz wszystkie powiązane wizyty zostaną trwale usunięte
              z bazy. Tej operacji nie można cofnąć.
            </p>
            <div className="modal-actions cancellation-actions">
              <button
                type="button"
                disabled={isClientSaving}
                onClick={() => setPendingClientRemovalId(null)}
              >
                Anuluj
              </button>
              <button
                className="danger"
                type="button"
                disabled={isClientSaving}
                onClick={() => void removeClientFromDirectory()}
              >
                {isClientSaving ? "Usuwanie..." : "Usuń na zawsze"}
              </button>
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
                <MessageSquare className="sms-icon" strokeWidth={2.1} />
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
            aria-label={selectedAdminEditAppointmentIsClosed ? "Szczegóły wizyty klienta" : "Edytuj wizytę klienta"}
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
              <p className="eyebrow">
                {selectedAdminEditAppointmentIsClosed ? "Szczegóły wizyty" : "Edycja wizyty"}
              </p>
              <h2>{selectedAdminEditAppointment.clientName}</h2>
            </div>

            <div className="admin-edit-recap">
              <span>{selectedAdminEditAppointment.serviceName}</span>
              <strong>
                {adminClientDateFormatter.format(dateFromKey(selectedAdminEditAppointment.dateKey))},{" "}
                {selectedAdminEditAppointment.startTime}
              </strong>
            </div>

            {selectedAdminEditAppointmentIsClosed ? (
              <div className="modal-client-note">
                <strong>
                  {normalizeAppointmentStatus(selectedAdminEditAppointment.status) === "cancelled"
                    ? "Wizyta została odwołana"
                    : normalizeAppointmentStatus(selectedAdminEditAppointment.status) === "no_show"
                      ? "Klient nie pojawił się na wizycie"
                      : "Wizyta została rozliczona"}
                </strong>
                <span>To jest zapis zakończonej operacji i nie można go już edytować.</span>
              </div>
            ) : (
              <>
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
              </>
            )}
          </section>
        </div>
      ) : null}

      {waitlistDialogOpen && selectedBarber && visibleStep === "booking" ? (
        <div
          className="client-modal-backdrop waitlist-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWaitlistDialogOpen(false);
          }}
        >
          <section
            className="client-appointment-modal client-bottom-sheet waitlist-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="waitlist-modal-title"
          >
            <div className="sheet-grabber" aria-hidden="true" />
            <button
              className="modal-close-button"
              type="button"
              onClick={() => setWaitlistDialogOpen(false)}
              aria-label="Zamknij listę rezerwową"
            >
              <X aria-hidden="true" />
            </button>
            <div className="waitlist-modal-heading">
              <span aria-hidden="true">
                <BellRing />
              </span>
              <div>
                <p className="eyebrow">Lista rezerwowa</p>
                <h2 id="waitlist-modal-title">Powiadom mnie o terminie</h2>
              </div>
            </div>
            <div className="waitlist-modal-summary">
              <ProfileAvatar
                className={`waitlist-modal-avatar ${activeClientBarber.accent}`}
                name={activeBarberName}
                photoUrl={activeBarberProfile.photoUrl}
              />
              <span>
                <small>{activeBarberName}</small>
                <strong>{selectedService.name}</strong>
                <em>{formatDuration(selectedService.durationMinutes)}</em>
              </span>
              <b>{selectedService.price}</b>
            </div>
            <form
              className="waitlist-form"
              onSubmit={(event) => {
                event.preventDefault();
                void joinClientWaitlist();
              }}
            >
              <div className="waitlist-date-fields">
                <label>
                  Od dnia
                  <input
                    type="date"
                    min={dayKey(today)}
                    max={shiftDateKey(dayKey(today), 60)}
                    value={waitlistDraft.dateFrom}
                    onChange={(event) =>
                      setWaitlistDraft((current) => ({
                        ...current,
                        dateFrom: event.target.value,
                        dateTo:
                          current.dateTo < event.target.value
                            ? event.target.value
                            : current.dateTo,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Do dnia
                  <input
                    type="date"
                    min={waitlistDraft.dateFrom}
                    max={shiftDateKey(waitlistDraft.dateFrom, 60)}
                    value={waitlistDraft.dateTo}
                    onChange={(event) =>
                      setWaitlistDraft((current) => ({ ...current, dateTo: event.target.value }))
                    }
                    required
                  />
                </label>
              </div>
              <fieldset className="waitlist-time-picker">
                <legend>Kiedy najbardziej Ci pasuje?</legend>
                <div>
                  {(Object.keys(waitlistTimePreferenceLabels) as WaitlistTimePreference[]).map(
                    (preference) => (
                      <button
                        className={waitlistDraft.timePreference === preference ? "active" : ""}
                        type="button"
                        key={preference}
                        onClick={() =>
                          setWaitlistDraft((current) => ({
                            ...current,
                            timePreference: preference,
                          }))
                        }
                        aria-pressed={waitlistDraft.timePreference === preference}
                      >
                        {waitlistTimePreferenceLabels[preference]}
                      </button>
                    ),
                  )}
                </div>
              </fieldset>
              <div className="waitlist-contact-fields">
                <label>
                  Imię i nazwisko
                  <input
                    type="text"
                    autoComplete="name"
                    value={waitlistDraft.clientName}
                    onChange={(event) =>
                      setWaitlistDraft((current) => ({
                        ...current,
                        clientName: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  Numer telefonu
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={waitlistDraft.phone}
                    onChange={(event) =>
                      setWaitlistDraft((current) => ({ ...current, phone: event.target.value }))
                    }
                    required
                  />
                </label>
              </div>
              {waitlistFeedback?.kind === "error" ? (
                <p className="waitlist-form-error" role="alert">
                  {waitlistFeedback.message}
                </p>
              ) : null}
              <div className="waitlist-form-actions">
                <button
                  className="secondary"
                  type="button"
                  disabled={isWaitlistSaving}
                  onClick={() => setWaitlistDialogOpen(false)}
                >
                  Wróć
                </button>
                <button type="submit" disabled={!canJoinWaitlist || isWaitlistSaving}>
                  <BellRing aria-hidden="true" />
                  {isWaitlistSaving ? "Zapisywanie..." : "Powiadom mnie"}
                </button>
              </div>
            </form>
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
                      {" · "}
                      {clientBarberOptions.find((barber) => barber.id === appointment.barberId)
                        ?.name ?? "Barber"}
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
            aria-labelledby="client-appointment-detail-title"
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
              <p className="eyebrow">
                {selectedClientAppointmentIsRescheduled
                  ? "Zmiana terminu"
                  : "Twoja wizyta"}
              </p>
              <h2 id="client-appointment-detail-title">{selectedClientAppointment.serviceName}</h2>
            </div>

            {selectedClientAppointmentBarber ? (
              <div className="appointment-barber-row">
                <ProfileAvatar
                  className={`appointment-barber-avatar ${selectedClientAppointmentBarber.accent}`}
                  name={selectedClientAppointmentBarber.name}
                  photoUrl={selectedClientAppointmentBarber.photoUrl}
                />
                <span>
                  <small>Barber</small>
                  <strong>{selectedClientAppointmentBarber.name}</strong>
                </span>
              </div>
            ) : null}

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
              <strong>
                {selectedClientAppointmentIsClosed
                  ? normalizeAppointmentStatus(selectedClientAppointment.status) === "cancelled"
                    ? "Wizyta została odwołana"
                    : normalizeAppointmentStatus(selectedClientAppointment.status) === "no_show"
                      ? "Wizyta została oznaczona jako nieobecność"
                      : "Wizyta została zakończona"
                  : selectedClientNeedsConfirmation
                  ? "Czy nowy termin Ci odpowiada?"
                  : selectedClientAppointmentIsRescheduled
                    ? "Czekamy na potwierdzenie barbera"
                    : selectedClientAppointment.confirmedBy === "client"
                      ? "Termin potwierdzony"
                      : selectedClientAppointment.clientName}
              </strong>
              <span>
                {selectedClientAppointmentIsClosed
                  ? "To podsumowanie pozostaje dostępne po otwarciu powiadomienia."
                  : selectedClientNeedsConfirmation
                  ? "Sprawdź datę i godzinę powyżej. Jeśli wszystko się zgadza, potwierdź nowy termin."
                  : selectedClientAppointmentIsRescheduled
                    ? "Twoja propozycja zmiany została zapisana. Barber może ją teraz potwierdzić."
                    : selectedClientAppointment.confirmedBy === "client"
                      ? "Dziękujemy. Barber widzi już Twoje potwierdzenie."
                      : "W razie zmiany planów możesz przesunąć termin albo odwołać wizytę."}
              </span>
            </div>

            {bookingError ? <p className="modal-operation-error" role="alert">{bookingError}</p> : null}

            {!selectedClientAppointmentIsClosed ? (
              <div
                className={`modal-actions ${
                  selectedClientNeedsConfirmation ? "with-confirmation" : ""
                }`}
              >
                {selectedClientNeedsConfirmation ? (
                  <button
                    className="confirm"
                    type="button"
                    disabled={isSaving}
                    onClick={() => confirmClientRescheduledAppointment(selectedClientAppointment.id)}
                  >
                    {isSaving ? "Potwierdzanie..." : "Potwierdzam nowy termin"}
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
            ) : null}
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

      {(bookingError || dataError) && visibleStep !== "confirm" ? (
        <div className="booking-operation-error" role="alert">
          {bookingError || dataError}
        </div>
      ) : null}

      {visibleStep !== "admin" && (visibleStep !== "booking" || selectedBarber) ? (
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
