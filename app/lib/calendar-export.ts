import { get, ref } from "firebase/database";

import {
  CALENDAR_FILE_PATH,
  androidCalendarFileIntent,
  buildIcs,
  calendarFileQuery,
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

const isAndroid = () => /Android/i.test(navigator.userAgent);
const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalledApp = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Puts the visit in the phone's own calendar. There is one way to do it, and the phone decides the app:
 * on Android the browser is asked to open the .ics as a calendar file, so the phone lists the calendar apps (when no
 * app takes it, the file is downloaded and Android asks when it is opened); on an iPhone the file opens as "Add to Calendar".
 * Must run straight from the tap: a browser only allows opening another app as a direct reaction to it.
 */
export const addToCalendar = (summary: BookingSummary) => {
  const { event } = toCalendarEvent(summary);
  const fileUrl = `${CALENDAR_FILE_PATH}?${calendarFileQuery(event)}`;

  if (isAndroid()) {
    window.location.href = androidCalendarFileIntent(new URL(fileUrl, window.location.origin).href);
  } else if (isIos()) {
    // Inside the installed app a normal navigation would leave it, so the file opens in a new view.
    if (isInstalledApp()) window.open(fileUrl, "_blank");
    else window.location.assign(fileUrl);
  } else {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = "wizyta-bnb.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
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
