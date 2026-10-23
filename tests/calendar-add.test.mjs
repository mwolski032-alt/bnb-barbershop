import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  androidCalendarIntent,
  buildIcs,
  calendarFileQuery,
  escapeIcsText,
  eventFromCalendarQuery,
  foldIcsLine,
  googleCalendarUrl,
  outlookCalendarUrl,
  GOOGLE_CALENDAR_PACKAGE,
  SAMSUNG_CALENDAR_PACKAGE,
} from "../shared/calendar-ics.mjs";
import handler from "../netlify/functions/calendar.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const event = {
  uid: "bnb-2026-10-12-1530@bnb-barbershop",
  title: "BNB Barbershop - Strzyżenie + broda",
  description: "Barber: Mateusz\nUsługa: Strzyżenie, broda; fade",
  location: "ul. Przykładowa 1, Włodawa",
  startLocal: "20261012T153000",
  endLocal: "20261012T170000",
};

test("the .ics has every field a calendar needs and a reminder an hour before", () => {
  const ics = buildIcs(event, new Date("2026-10-10T08:00:00Z"));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  for (const line of ["DTSTART:20261012T153000", "DTEND:20261012T170000", "DTSTAMP:20261010T080000Z", "TRIGGER:-PT1H"]) assert.ok(ics.includes(line), line);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("DESCRIPTION:Barber: Mateusz\\nUsługa: Strzyżenie\\, broda\\; fade"));
  assert.ok(unfolded.includes("LOCATION:ul. Przykładowa 1\\, Włodawa"));
  assert.ok(!buildIcs({ ...event, location: "" }).includes("LOCATION"));
});

test("no line of the .ics is longer than 75 bytes, even with Polish letters", () => {
  const long = buildIcs({ ...event, description: "Zażółć gęślą jaźń ".repeat(40) });
  for (const line of long.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(foldIcsLine("abc"), "abc");
});

test("text cannot break out of its line and add calendar fields", () => {
  assert.equal(escapeIcsText("a\r\nEND:VEVENT\rb\nc"), "a\\nEND:VEVENT\\nb\\nc");
  const ics = buildIcs({ ...event, title: "x\r\nATTENDEE:mailto:evil@example.com" });
  assert.ok(!/^ATTENDEE/m.test(ics.replace(/\r\n /g, "")));
});

test("the event survives the trip through the site's own .ics address", () => {
  const params = new URLSearchParams(calendarFileQuery(event));
  assert.deepEqual(eventFromCalendarQuery(params), event);
});

test("the .ics address rejects malformed or oversized input", () => {
  const valid = Object.fromEntries(new URLSearchParams(calendarFileQuery(event)));
  const parse = (change) => eventFromCalendarQuery(new URLSearchParams({ ...valid, ...change }));
  assert.equal(parse({ s: "tomorrow" }), null);
  assert.equal(parse({ e: "20261012T150000" }), null);
  assert.equal(parse({ u: "has space" }), null);
  assert.equal(parse({ t: "" }), null);
  assert.equal(parse({ d: "x".repeat(5000) }).description.length, 800);
});

test("the .ics endpoint answers inline as a calendar so iPhones open 'Add to Calendar'", async () => {
  const ok = await handler(new Request(`https://bnb.example/api/calendar.ics?${calendarFileQuery(event)}`));
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type"), /^text\/calendar/);
  assert.match(ok.headers.get("content-disposition"), /^inline/);
  assert.match(await ok.text(), /SUMMARY:BNB Barbershop - Strzyżenie \+ broda/);
  assert.equal((await handler(new Request("https://bnb.example/api/calendar.ics?s=bad"))).status, 400);
  assert.equal((await handler(new Request("https://bnb.example/api/calendar.ics", { method: "POST" }))).status, 405);
});

test("Android gets the system 'add event' intent, filled in and with a Google Calendar fallback", () => {
  const start = Date.parse("2026-10-12T13:30:00Z");
  const intent = androidCalendarIntent(event, start, start + 5_400_000);
  assert.ok(intent.startsWith("intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/event;"));
  assert.ok(intent.endsWith(";end"));
  assert.ok(intent.includes(`l.beginTime=${start};`) && intent.includes(`l.endTime=${start + 5_400_000};`));
  // Semicolons inside the text are encoded, so they cannot end an extra early.
  assert.ok(intent.includes("S.title=BNB%20Barbershop%20-%20Strzy%C5%BCenie%20%2B%20broda;"));
  assert.ok(intent.includes("Strzy%C5%BCenie%2C%20broda%3B%20fade"));
  assert.ok(intent.includes("S.eventLocation="));
  assert.ok(intent.includes("S.browser_fallback_url=https%3A%2F%2Fcalendar.google.com%2Fcalendar%2Frender"));
  assert.ok(!androidCalendarIntent({ ...event, location: "" }, start, start + 1).includes("eventLocation"));
});

test("each Android calendar can be named, or left open so Android asks \"Just once / Always\"", () => {
  const start = Date.parse("2026-10-12T13:30:00Z");
  const samsung = androidCalendarIntent(event, start, start + 1, { packageName: SAMSUNG_CALENDAR_PACKAGE });
  assert.ok(samsung.includes(`type=vnd.android.cursor.dir/event;package=${SAMSUNG_CALENDAR_PACKAGE};S.title=`));
  const google = androidCalendarIntent(event, start, start + 1, { packageName: GOOGLE_CALENDAR_PACKAGE });
  assert.ok(google.includes(`package=${GOOGLE_CALENDAR_PACKAGE};`));
  // No package: nothing names an app, so the phone lists every calendar and asks.
  assert.ok(!androidCalendarIntent(event, start, start + 1).includes("package="));
  // The fallback used when the app is missing can be replaced.
  const custom = androidCalendarIntent(event, start, start + 1, { packageName: SAMSUNG_CALENDAR_PACKAGE, fallbackUrl: "https://bnb.example/x.ics" });
  assert.ok(custom.includes("S.browser_fallback_url=https%3A%2F%2Fbnb.example%2Fx.ics;end"));
});

test("Outlook opens prefilled with real instants", () => {
  const start = Date.parse("2026-10-12T13:30:00Z");
  const url = new URL(outlookCalendarUrl(event, start, start + 5_400_000));
  assert.equal(url.origin + url.pathname, "https://outlook.live.com/calendar/0/deeplink/compose");
  assert.equal(url.searchParams.get("startdt"), "2026-10-12T13:30:00.000Z");
  assert.equal(url.searchParams.get("enddt"), "2026-10-12T15:00:00.000Z");
  assert.equal(url.searchParams.get("subject"), event.title);
  assert.equal(url.searchParams.get("location"), event.location);
});

test("Google Calendar opens prefilled with the right time zone", () => {
  const url = new URL(googleCalendarUrl(event));
  assert.equal(url.origin + url.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("dates"), "20261012T153000/20261012T170000");
  assert.equal(url.searchParams.get("ctz"), "Europe/Warsaw");
  assert.equal(url.searchParams.get("text"), event.title);
});

test("the booking summary and the visit sheet both carry the calendar button, and the old file download is gone", () => {
  assert.match(read("app/components/screens/success-screen.tsx"), /<CalendarButton summary=\{summary\} \/>/);
  const home = read("app/booking-home.tsx");
  assert.match(home, /<CalendarButton summary=\{appointmentToBookingSummary\(selectedClientAppointment, selectedClientAppointmentBarber\?\.name\)\} \/>/);
  assert.doesNotMatch(home, /navigator\.share|createObjectURL|downloadCalendarFile/);
  const css = ["app/globals.css", "app/paper-components.css", "app/client-modern.css"].map(read).join("\n");
  assert.doesNotMatch(css, /calendar-save-button|modal-calendar-button/);
  assert.match(css, /\.calendar-add-button/);
  // The salon address is fetched before the tap, never during it.
  assert.match(read("app/components/calendar-button.tsx"), /warmSalonAddress\(\)/);
});

test("the calendar chooser lists the right apps per device and can remember the choice", () => {
  const lib = read("app/lib/calendar-export.ts");
  // Samsung phones get their own calendar first; other Androids do not see it.
  assert.match(lib, /\/SAMSUNG\|SM-\[A-Z0-9\]\+\/i\.test\(ua\)/);
  assert.match(lib, /\.\.\.\(samsung \? \[\{ id: "samsung" as const/);
  assert.match(lib, /id: "android-choose", label: "Inna aplikacja"/);
  // The saved choice is only used when this device still offers it, and storage failures are harmless.
  assert.match(lib, /getCalendarChoices\(\)\.some\(\(choice\) => choice\.id === saved\)/);
  const button = read("app/components/calendar-button.tsx");
  assert.match(button, /saved \? run\(saved, true\) : setOpen\(true\)/);
  assert.match(button, /Zapamiętaj mój wybór/);
  assert.match(button, /Zmień kalendarz/);
  // The calendar opens straight from the tap, before the sheet closes.
  assert.match(button, /run\(choice, remember\); close\(\);/);
});
