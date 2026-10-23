// "Add to calendar" for any phone. One event description feeds every route the user can pick:
//   Android -> the system "add event" intent, for one named app (Samsung, Google) or for any app, in which
//              case Android itself asks "Just once / Always";
//   iPhone  -> an .ics served by the site itself, which iOS opens as "Add to Calendar";
//   web     -> Google Calendar's or Outlook's prefilled "new event" page.
// Times are "floating" local times (YYYYMMDDTHHMMSS), so the event lands at the same wall-clock time
// wherever the phone is set to Warsaw time, with no time zone tables to ship.

export const SAMSUNG_CALENDAR_PACKAGE = "com.samsung.android.calendar";
export const GOOGLE_CALENDAR_PACKAGE = "com.google.android.calendar";
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

export const googleCalendarUrl = (event) => {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${event.startLocal}/${event.endLocal}`,
    ctz: "Europe/Warsaw",
    details: event.description,
  });
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

/** Outlook.com's prefilled "new event" page. Unlike Google's it wants real instants, not wall-clock times. */
export const outlookCalendarUrl = (event, startMs, endMs) => {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: new Date(startMs).toISOString(),
    enddt: new Date(endMs).toISOString(),
    body: event.description,
  });
  if (event.location) params.set("location", event.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};

/**
 * Android "insert event" intent. With `packageName` that one app opens its editor with everything filled
 * in; without it Android lists every calendar app and asks "Just once / Always". `fallbackUrl` is
 * followed when the app is not installed.
 */
export const androidCalendarIntent = (event, startMs, endMs, { packageName = "", fallbackUrl = googleCalendarUrl(event) } = {}) => {
  const enc = encodeURIComponent;
  return [
    "intent:#Intent",
    "action=android.intent.action.INSERT",
    "type=vnd.android.cursor.dir/event",
    ...(packageName ? [`package=${packageName}`] : []),
    `S.title=${enc(event.title)}`,
    `S.description=${enc(event.description)}`,
    ...(event.location ? [`S.eventLocation=${enc(event.location)}`] : []),
    `l.beginTime=${Math.round(startMs)}`,
    `l.endTime=${Math.round(endMs)}`,
    `S.browser_fallback_url=${enc(fallbackUrl)}`,
    "end",
  ].join(";");
};
