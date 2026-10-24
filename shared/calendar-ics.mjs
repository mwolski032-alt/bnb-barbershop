// "Add to calendar" for any phone, through one door: the visit as an .ics file served by the site itself.
//   Android -> an intent that opens the .ics as a calendar file, so the phone lists the calendar apps; the
//              "add event" intent is not accepted from a browser, and the plain .ics address is the fallback;
//   iPhone  -> the .ics opens as "Add to Calendar";
//   other   -> the .ics is downloaded.
// Times are "floating" local times (YYYYMMDDTHHMMSS), so the event lands at the same wall-clock time
// wherever the phone is set to Warsaw time, with no time zone tables to ship.

export const CALENDAR_FILE_PATH = "/api/calendar.ics";
export const CALENDAR_TIME_PATTERN = /^\d{8}T\d{6}$/;
export const CALENDAR_UID_PATTERN = /^[\w.@-]{1,80}$/;
export const CALENDAR_LIMITS = { title: 120, description: 800, location: 200 };

const clip = (value, max) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);

export const escapeIcsText = (value) =>
  String(value).replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

// RFC 5545: lines are at most 75 bytes; longer ones continue on the next line after a space.
export const foldIcsLine = (line) => {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > (parts.length === 0 ? 73 : 72)) { parts.push(current); current = ""; bytes = 0; }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
};

const utcStamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** `event`: { uid, title, description, location, startLocal, endLocal } with floating local times. */
export const buildIcs = (event, now = new Date()) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BNB Barbershop//Rezerwacje//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${event.startLocal}`,
    `DTEND:${event.endLocal}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    // A reminder an hour before, so the visit is not forgotten.
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Wizyta w BNB Barbershop",
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
};

/** Query string of the site's own .ics endpoint. */
export const calendarFileQuery = (event) =>
  new URLSearchParams({
    t: clip(event.title, CALENDAR_LIMITS.title),
    d: clip(event.description, CALENDAR_LIMITS.description),
    l: clip(event.location, CALENDAR_LIMITS.location),
    s: event.startLocal,
    e: event.endLocal,
    u: event.uid,
  }).toString();

/** Reads and validates that query string. Returns the event, or null when anything is malformed. */
export const eventFromCalendarQuery = (params) => {
  const startLocal = params.get("s") ?? "";
  const endLocal = params.get("e") ?? "";
  const uid = params.get("u") ?? "";
  const title = clip(params.get("t"), CALENDAR_LIMITS.title).trim();
  if (!CALENDAR_TIME_PATTERN.test(startLocal) || !CALENDAR_TIME_PATTERN.test(endLocal) || endLocal <= startLocal) return null;
  if (!CALENDAR_UID_PATTERN.test(uid) || !title) return null;
  return {
    uid,
    title,
    description: clip(params.get("d"), CALENDAR_LIMITS.description),
    location: clip(params.get("l"), CALENDAR_LIMITS.location),
    startLocal,
    endLocal,
  };
};

/**
 * Android "view this calendar file" intent for the site's own .ics address. Unlike the "insert event" intent
 * below, a calendar app can accept it from a browser, and then Android lists the calendar apps and asks which
 * to use. `fileUrl` is absolute and https. When no app takes it, the browser follows the same address as a
 * plain link, which downloads the file.
 */
export const androidCalendarFileIntent = (fileUrl) => {
  const url = new URL(fileUrl);
  return [
    `intent://${url.host}${url.pathname}${url.search}#Intent`,
    "scheme=https",
    "action=android.intent.action.VIEW",
    "type=text/calendar",
    `S.browser_fallback_url=${encodeURIComponent(url.href)}`,
    "end",
  ].join(";");
};

/**
 * Android "insert event" intent: the calendar's own editor opens with everything filled in. No app is named,
 * so Android lists every calendar and asks. `fallbackUrl` is followed when no app takes the intent.
 */
export const androidCalendarIntent = (event, startMs, endMs, fallbackUrl) => {
  const enc = encodeURIComponent;
  return [
    "intent:#Intent",
    "action=android.intent.action.INSERT",
    "type=vnd.android.cursor.dir/event",
    `S.title=${enc(event.title)}`,
    `S.description=${enc(event.description)}`,
    ...(event.location ? [`S.eventLocation=${enc(event.location)}`] : []),
    `l.beginTime=${Math.round(startMs)}`,
    `l.endTime=${Math.round(endMs)}`,
    `S.browser_fallback_url=${enc(fallbackUrl)}`,
    "end",
  ].join(";");
};
