import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  androidCalendarFileIntent,
  androidCalendarIntent,
  buildIcs,
  calendarFileQuery,
  escapeIcsText,
  eventFromCalendarQuery,
  foldIcsLine,
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

test("Android gets the system 'add event' intent, filled in, with the .ics file as the fallback", () => {
  const start = Date.parse("2026-10-12T13:30:00Z");
  const fallback = "https://bnb.example/api/calendar.ics?s=20261012T153000";
  const intent = androidCalendarIntent(event, start, start + 5_400_000, fallback);
  assert.ok(intent.startsWith("intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/event;"));
  assert.ok(intent.endsWith(";end"));
  assert.ok(intent.includes(`l.beginTime=${start};`) && intent.includes(`l.endTime=${start + 5_400_000};`));
  // Semicolons inside the text are encoded, so they cannot end an extra early.
  assert.ok(intent.includes("S.title=BNB%20Barbershop%20-%20Strzy%C5%BCenie%20%2B%20broda;"));
  assert.ok(intent.includes("Strzy%C5%BCenie%2C%20broda%3B%20fade"));
  assert.ok(intent.includes("S.eventLocation="));
  assert.ok(!androidCalendarIntent({ ...event, location: "" }, start, start + 1, fallback).includes("eventLocation"));
  // No app is named, so the phone lists every calendar and asks. Nothing sends the user to Google's website.
  assert.ok(!intent.includes("package="));
  assert.ok(intent.includes(`S.browser_fallback_url=${encodeURIComponent(fallback)};end`));
  assert.ok(!/calendar.google.com/.test(intent));
});

test("Android is asked to open the site's .ics as a calendar file, with the plain address as the fallback", () => {
  const address = "https://bnb.example/api/calendar.ics?t=BNB&s=20261012T153000&e=20261012T170000";
  const intent = androidCalendarFileIntent(address);
  assert.ok(intent.startsWith("intent://bnb.example/api/calendar.ics?t=BNB&s=20261012T153000&e=20261012T170000#Intent;"));
  for (const part of ["scheme=https", "action=android.intent.action.VIEW", "type=text/calendar"]) assert.ok(intent.includes(`;${part};`), part);
  assert.ok(intent.endsWith(`;S.browser_fallback_url=${encodeURIComponent(address)};end`));
  assert.ok(!/package=|calendar\.google\.com/.test(intent));
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

test("there is one way to add a visit to the calendar and the phone picks the app", () => {
  const lib = read("app/lib/calendar-export.ts");
  const button = read("app/components/calendar-button.tsx");
  // No list of calendars, no remembered choice, no Google, Outlook or file option.
  for (const gone of ["getCalendarChoices", "saveCalendarChoice", "googleCalendarUrl", "outlookCalendarUrl", "SAMSUNG_CALENDAR_PACKAGE", "android-choose"]) {
    assert.ok(!lib.includes(gone) && !button.includes(gone), gone);
  }
  assert.doesNotMatch(button, /SalonDialog|Zapamiętaj|Zmień kalendarz/);
  // Android: the system intent, whose fallback is the site's own .ics address (absolute, as Chrome needs).
  assert.ok(lib.includes("androidCalendarFileIntent(new URL(fileUrl, window.location.origin).href)"));
  // iPhone: the .ics opens as "Add to Calendar".
  assert.ok(lib.includes("window.location.assign(fileUrl)"));
  // The calendar opens straight from the tap.
  assert.ok(button.includes("onClick={() => { if (summary) addToCalendar(summary); }}"));
});
