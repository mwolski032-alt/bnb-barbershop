import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MIN_NOTICE_MS,
  REMINDER_LEAD_MS,
  findDueReminders,
  findExpiredReminderIds,
  formatReminder,
  getReminderSendAt,
  reminderRecord,
  warsawTimeToEpoch,
} from "../shared/reminders.mjs";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const HOUR = 3_600_000;

const visit = (overrides) => ({
  userId: "client",
  status: "confirmed",
  dateKey: "2026-10-14",
  startTime: "15:30",
  serviceName: "Strzyżenie",
  createdAt: Date.parse("2026-10-01T10:00:00Z"),
  ...overrides,
});

test("a Warsaw wall-clock time becomes the right instant in summer and in winter time", () => {
  assert.equal(warsawTimeToEpoch("2026-07-01", "12:00"), Date.parse("2026-07-01T10:00:00Z"));
  assert.equal(warsawTimeToEpoch("2026-12-01", "12:00"), Date.parse("2026-12-01T11:00:00Z"));
  // The night the clocks go back (2026-10-25, 03:00 -> 02:00) and forward (2026-03-29, 02:00 -> 03:00).
  assert.equal(warsawTimeToEpoch("2026-10-25", "12:00"), Date.parse("2026-10-25T11:00:00Z"));
  assert.equal(warsawTimeToEpoch("2026-03-29", "12:00"), Date.parse("2026-03-29T10:00:00Z"));
});

test("the reminder goes out a day ahead when that falls in the daytime", () => {
  const start = warsawTimeToEpoch("2026-10-14", "15:30");
  assert.equal(getReminderSendAt(start), start - REMINDER_LEAD_MS);
});

test("a morning visit is reminded at 20:00 the evening before the day-before, never at night", () => {
  const start = warsawTimeToEpoch("2026-10-14", "07:00");
  assert.equal(getReminderSendAt(start), warsawTimeToEpoch("2026-10-12", "20:00"));
  const earlyAfternoonStart = warsawTimeToEpoch("2026-10-14", "08:00");
  assert.equal(getReminderSendAt(earlyAfternoonStart), earlyAfternoonStart - REMINDER_LEAD_MS);
});

test("a visit whose day-before slot falls late in the evening is reminded at 20:00 that day", () => {
  const start = warsawTimeToEpoch("2026-10-14", "21:30");
  assert.equal(getReminderSendAt(start), warsawTimeToEpoch("2026-10-13", "20:00"));
});

test("only booked visits whose reminder time has come are due", () => {
  const start = warsawTimeToEpoch("2026-10-14", "15:30");
  const appointments = { a: visit() };
  assert.equal(findDueReminders(appointments, {}, { now: start - REMINDER_LEAD_MS - 1000 }).length, 0);
  assert.deepEqual(
    findDueReminders(appointments, {}, { now: start - REMINDER_LEAD_MS + 1000 }).map((due) => due.id),
    ["a"],
  );
});

test("cancelled, completed, awaiting-confirmation and already confirmed visits are not reminded", () => {
  const now = warsawTimeToEpoch("2026-10-13", "16:00");
  const due = findDueReminders({
    cancelled: visit({ status: "cancelled" }),
    completed: visit({ status: "completed" }),
    moved: visit({ status: "rescheduled" }),
    vouched: visit({ attendanceConfirmedAt: now - 1 }),
    guest: visit({ userId: "" }),
    ok: visit(),
  }, {}, { now });
  assert.deepEqual(due.map((item) => item.id), ["ok"]);
});

test("a visit is reminded once per date and time, and again if it moves", () => {
  const now = warsawTimeToEpoch("2026-10-13", "16:00");
  const appointments = { a: visit() };
  const sent = { a: reminderRecord(visit(), now - HOUR, true) };
  assert.equal(findDueReminders(appointments, sent, { now }).length, 0);
  assert.equal(findDueReminders({ a: visit({ startTime: "16:00" }) }, sent, { now }).length, 1);
});

test("no reminder for a visit booked, moved or confirmed after the reminder time, or about to start", () => {
  const start = warsawTimeToEpoch("2026-10-14", "15:30");
  const sendAt = start - REMINDER_LEAD_MS;
  const now = sendAt + HOUR;
  assert.equal(findDueReminders({ a: visit({ createdAt: sendAt + 1000 }) }, {}, { now }).length, 0);
  assert.equal(findDueReminders({ a: visit({ rescheduledAt: sendAt + 1000 }) }, {}, { now }).length, 0);
  assert.equal(findDueReminders({ a: visit({ confirmedAt: sendAt + 1000 }) }, {}, { now }).length, 0);
  assert.equal(findDueReminders({ a: visit() }, {}, { now: start - MIN_NOTICE_MS + 1000 }).length, 0);
});

test("the nearest visits come first", () => {
  const now = warsawTimeToEpoch("2026-10-13", "20:30");
  const due = findDueReminders({
    late: visit({ startTime: "17:00" }),
    early: visit({ startTime: "10:00" }),
  }, {}, { now });
  assert.deepEqual(due.map((item) => item.id), ["early", "late"]);
});

test("old reminder records are cleaned up", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.deepEqual(findExpiredReminderIds({
    old: { sentAt: now - 20 * 24 * HOUR },
    fresh: { sentAt: now - HOUR },
  }, now), ["old"]);
});

test("the reminder says when the visit is and asks for an answer", () => {
  const now = new Date(warsawTimeToEpoch("2026-10-13", "16:00"));
  const copy = formatReminder(visit(), { barberName: "Mateusz", now });
  assert.equal(copy.title, "Jutro Twoja wizyta ✂️");
  assert.match(copy.body, /Strzyżenie u Mateusz: jutro o 15:30/);
  assert.match(copy.body, /Potwierdź/);
  const later = formatReminder(visit({ dateKey: "2026-10-16" }), { now });
  assert.match(later.body, /piątek 16\.10 o 15:30/);
});

test("the scheduled function sends the reminder with answer buttons and keeps a record", async () => {
  const source = await read("netlify/functions/appointment-reminder.mjs");
  assert.match(source, /schedule: "\*\/15 \* \* \* \*"/);
  assert.match(source, /event: "reminder"/);
  assert.match(source, /data: \{ actions: "attend" \}/);
  assert.match(source, /appointmentReminders/);
});

test("the service worker shows both answers and passes the chosen one to the app", async () => {
  const worker = await read("public/sw.js");
  assert.match(worker, /data\.actions === "attend"/);
  assert.match(worker, /action: "confirm", title: "Potwierdzam"/);
  assert.match(worker, /action: "cancel", title: "Odwołuję"/);
  assert.match(worker, /searchParams\.set\("reminder", event\.action\)/);
});
