import { get, ref } from "firebase/database";

import {
  CALENDAR_FILE_PATH,
  GOOGLE_CALENDAR_PACKAGE,
  SAMSUNG_CALENDAR_PACKAGE,
  androidCalendarIntent,
  buildIcs,
  calendarFileQuery,
  googleCalendarUrl,
  outlookCalendarUrl,
} from "../../shared/calendar-ics.mjs";
import { dayKey, dateFromKey } from "./booking-selectors";
import { type BookingSummary, type AdminAppointment } from "./booking-types";
import { formatDuration } from "./booking-format";
import { realtimeDb } from "./firebase";

const pad = (value: number) => String(value).padStart(2, "0");

/** Floating local time, "YYYYMMDDTHHMMSS". */
const localStamp = (date: Date) =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;

// The salon address is public. It is read ahead of the tap (see warmSalonAddress), because a browser only
// lets a tap open the calendar when it happens right away, not after a network request.
let salonAddress = "";
export const warmSalonAddress = () => {
  if (salonAddress) return;
  get(ref(realtimeDb, "shopfront/settings/address"))
    .then((snapshot) => { salonAddress = String(snapshot.val() ?? "").trim(); })
    .catch(() => undefined);
};

export const toCalendarEvent = (summary: BookingSummary, location = salonAddress) => {
  const [hour, minute] = summary.time.split(":").map(Number);
  const start = new Date(summary.date);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + summary.durationMinutes);

  return {
    event: {
      uid: `bnb-${dayKey(summary.date)}-${summary.time.replace(":", "")}@bnb-barbershop`,
      title: `BNB Barbershop - ${summary.serviceName}`,
      description: [
        `Barber: ${summary.barberName}`,
        `Usługa: ${summary.serviceName}`,
        `Cena: ${summary.servicePrice}`,
        `Czas trwania: ${formatDuration(summary.durationMinutes)}`,
      ].join("\n"),
      location,
      startLocal: localStamp(start),
      endLocal: localStamp(end),
    },
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
};

/** The visit as an .ics file's text. */
export const buildCalendarEvent = (summary: BookingSummary) => buildIcs(toCalendarEvent(summary).event);

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalledApp = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type CalendarTarget = "samsung" | "google-app" | "android-choose" | "apple" | "google" | "outlook" | "file";
export type CalendarChoice = { id: CalendarTarget; label: string; hint: string };

/** The calendars worth offering on this device, the most likely one first. */
export const getCalendarChoices = (): CalendarChoice[] => {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    const samsung = /SAMSUNG|SM-[A-Z0-9]+/i.test(ua);
    return [
      ...(samsung ? [{ id: "samsung" as const, label: "Kalendarz Samsung", hint: "Otworzy się z wypełnioną wizytą" }] : []),
      { id: "google-app", label: "Kalendarz Google", hint: "Aplikacja Google Calendar" },
      { id: "android-choose", label: "Inna aplikacja", hint: "Telefon zapyta: tylko raz albo zawsze" },
      { id: "file", label: "Pobierz plik .ics", hint: "Do otwarcia w dowolnym kalendarzu" },
    ];
  }
  if (isIos()) {
    return [
      { id: "apple", label: "Kalendarz iPhone'a", hint: "Apple Calendar" },
      { id: "google", label: "Kalendarz Google", hint: "Otworzy się w przeglądarce" },
      { id: "outlook", label: "Outlook", hint: "Otworzy się w przeglądarce" },
    ];
  }
  return [
    { id: "google", label: "Kalendarz Google", hint: "Otworzy się w nowej karcie" },
    { id: "outlook", label: "Outlook", hint: "Otworzy się w nowej karcie" },
    { id: "file", label: "Pobierz plik .ics", hint: "Apple Calendar, Outlook i inne programy" },
  ];
};

const CHOICE_KEY = "bnb-calendar-choice";
// Storage can be unavailable (private window, blocked data): the question is then simply asked every time.
export const getSavedCalendarChoice = (): CalendarTarget | null => {
  try {
    const saved = window.localStorage.getItem(CHOICE_KEY);
    return getCalendarChoices().some((choice) => choice.id === saved) ? (saved as CalendarTarget) : null;
  } catch {
    return null;
  }
};
export const saveCalendarChoice = (target: CalendarTarget | null) => {
  try {
    if (target) window.localStorage.setItem(CHOICE_KEY, target);
    else window.localStorage.removeItem(CHOICE_KEY);
  } catch { /* See above. */ }
};

/**
 * Opens the chosen calendar with the visit already filled in. Must run straight from the tap: a browser
 * only allows opening another app or tab as a direct reaction to it.
 */
export const addToCalendar = (summary: BookingSummary, target: CalendarTarget) => {
  const { event, startMs, endMs } = toCalendarEvent(summary);
  const fileUrl = `${CALENDAR_FILE_PATH}?${calendarFileQuery(event)}`;
  const openTab = (url: string) => { if (!window.open(url, "_blank", "noopener")) window.location.assign(url); };

  switch (target) {
    case "samsung":
      window.location.href = androidCalendarIntent(event, startMs, endMs, { packageName: SAMSUNG_CALENDAR_PACKAGE, fallbackUrl: googleCalendarUrl(event) });
      break;
    case "google-app":
      window.location.href = androidCalendarIntent(event, startMs, endMs, { packageName: GOOGLE_CALENDAR_PACKAGE });
      break;
    case "android-choose":
      window.location.href = androidCalendarIntent(event, startMs, endMs);
      break;
    case "apple":
      // Inside the installed app a normal navigation would leave it, so the file opens in a new view.
      if (isInstalledApp()) window.open(fileUrl, "_blank");
      else window.location.assign(fileUrl);
      break;
    case "outlook":
      openTab(outlookCalendarUrl(event, startMs, endMs));
      break;
    case "file": {
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = "wizyta-bnb.ics";
      document.body.appendChild(link);
      link.click();
      link.remove();
      break;
    }
    default:
      openTab(googleCalendarUrl(event));
  }
};
export const appointmentToBookingSummary = (appointment: AdminAppointment, barberName = "Barber"): BookingSummary => ({
  barberId: appointment.barberId,
  barberName,
  barberPhotoUrl: "",
  serviceName: appointment.serviceName,
  servicePrice: appointment.price,
  durationMinutes: appointment.durationMinutes,
  date: dateFromKey(appointment.dateKey),
  time: appointment.startTime,
  fullName: appointment.clientName,
  phone: appointment.phone ?? "",
});
