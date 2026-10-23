import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectEndOfDay,
  decideEndOfDay,
  formatDailySummary,
  formatUnsettledReminder,
  getEndOfDayMinutes,
  getWarsawParts,
  shiftDateKey,
} from "../shared/daily-summary.mjs";
import {
  GIVE_UP_AFTER_DAYS,
  findRebookCandidates,
  formatRebookNudge,
  getClientInterval,
} from "../shared/rebook.mjs";
import {
  buildPublicReviews,
  normalizeReviewInput,
  publicAuthorName,
} from "../shared/reviews.mjs";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const day = { dateKey: "2026-10-10", minutes: 20 * 60 };
const visit = (overrides) => ({
  dateKey: "2026-10-10",
  startTime: "10:00",
  durationMinutes: 30,
  status: "completed",
  settlement: { amount: 60 },
  ...overrides,
});

test("end of day counts today's settled visits and sums the settled amounts", () => {
  const counts = collectEndOfDay({
    a: visit({ settlement: { amount: 60 } }),
    b: visit({ startTime: "11:00", settlement: { amount: 45.5 } }),
    yesterday: visit({ dateKey: "2026-10-09", settlement: { amount: 999 } }),
    cancelled: visit({ status: "cancelled" }),
  }, day);
  assert.deepEqual(counts, { completed: 2, revenue: 105.5, unsettled: 0 });
});

test("a finished visit that is neither settled nor cancelled counts as unsettled", () => {
  const counts = collectEndOfDay({
    done: visit({}),
    forgotten: visit({ status: "confirmed", startTime: "17:00", settlement: undefined }),
    pendingMove: visit({ status: "rescheduled", startTime: "12:00", settlement: undefined }),
    later: visit({ status: "confirmed", startTime: "21:00", settlement: undefined }),
    noShow: visit({ status: "no_show" }),
    cancelled: visit({ status: "cancelled" }),
  }, day);
  assert.equal(counts.unsettled, 2);
});

test("unsettled visits from earlier days count for two weeks and then stop nagging", () => {
  const counts = collectEndOfDay({
    yesterday: visit({ dateKey: "2026-10-09", status: "confirmed" }),
    lastWeek: visit({ dateKey: "2026-10-03", status: "confirmed" }),
    ancient: visit({ dateKey: "2026-08-01", status: "confirmed" }),
    future: visit({ dateKey: "2026-10-11", status: "confirmed" }),
  }, day);
  assert.equal(counts.unsettled, 2);
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
});

test("the end-of-day push never goes per client: reminder only when something is open, summary only when all is closed", () => {
  assert.equal(decideEndOfDay({ completed: 0, unsettled: 0 }), null);
  assert.equal(decideEndOfDay({ completed: 5, unsettled: 0 }), "summary");
  assert.equal(decideEndOfDay({ completed: 5, unsettled: 2 }), "reminder");
  assert.equal(decideEndOfDay({ completed: 0, unsettled: 1 }), "reminder");
  assert.equal(decideEndOfDay({ completed: 5, unsettled: 2 }, { reminder: true }), null);
  assert.equal(decideEndOfDay({ completed: 5, unsettled: 0 }, { reminder: true }), "summary");
  assert.equal(decideEndOfDay({ completed: 5, unsettled: 0 }, { reminder: true, summary: true }), null);
});

test("the reminder comes an hour after the working hours or the last visit, never after 23:00", () => {
  assert.equal(getEndOfDayMinutes({}, { dateKey: "2026-10-10", workEnd: "18:00" }), 19 * 60);
  // A visit that ran past the working hours moves the moment later.
  assert.equal(getEndOfDayMinutes({ a: visit({ startTime: "18:30", durationMinutes: 45 }) }, { dateKey: "2026-10-10", workEnd: "18:00" }), 19 * 60 + 15 + 60);
  // Other days and cancelled visits do not count.
  assert.equal(getEndOfDayMinutes({ a: visit({ dateKey: "2026-10-09", startTime: "22:00" }), b: visit({ status: "cancelled", startTime: "21:00" }) }, { dateKey: "2026-10-10", workEnd: "17:00" }), 18 * 60);
  assert.equal(getEndOfDayMinutes({}, { dateKey: "2026-10-10", workEnd: "23:30" }), 23 * 60);
  assert.equal(getEndOfDayMinutes({}, { dateKey: "2026-10-10", workEnd: "" }), 21 * 60);
});

test("end-of-day copy uses correct Polish plurals and money format", () => {
  const body = (completed) => formatDailySummary({ completed, revenue: 1240, unsettled: 0 }, "Kacper").body;
  assert.match(body(1), /^Dziś 1 wizyta, razem 1 240 zł\./);
  assert.match(body(2), /^Dziś 2 wizyty,/);
  assert.match(body(5), /^Dziś 5 wizyt,/);
  assert.match(body(12), /^Dziś 12 wizyt,/);
  assert.match(body(22), /^Dziś 22 wizyty,/);
  assert.equal(formatDailySummary({ completed: 1, revenue: 0 }, "Kacper Nowak").title, "Podsumowanie dnia, Kacper");
  assert.match(formatUnsettledReminder(1).body, /^1 wizyta czeka na rozliczenie/);
  assert.match(formatUnsettledReminder(3).body, /^3 wizyty czekają na rozliczenie/);
  assert.match(formatUnsettledReminder(7).body, /^7 wizyt czeka na rozliczenie/);
});

test("Warsaw time follows daylight saving", () => {
  assert.deepEqual(getWarsawParts(new Date("2026-07-01T18:30:00Z")), { dateKey: "2026-07-01", hour: 20, minutes: 1230 });
  assert.deepEqual(getWarsawParts(new Date("2026-12-01T19:00:00Z")), { dateKey: "2026-12-01", hour: 20, minutes: 1200 });
  assert.equal(getWarsawParts(new Date("2026-12-01T23:30:00Z")).dateKey, "2026-12-02");
});

test("a client is nudged by their own rhythm, once per visit cycle, and never while a visit is booked", () => {
  const completed = (userId, dateKey, extra = {}) => ({ userId, dateKey, status: "completed", barberId: "mateusz", ...extra });
  const today = { todayKey: "2026-10-10" };
  assert.equal(getClientInterval(["2026-01-01"]), 28);
  assert.equal(getClientInterval(["2026-01-01", "2026-01-15", "2026-01-29"]), 14);
  assert.equal(getClientInterval(["2026-01-01", "2026-06-01"]), 56);

  const due = findRebookCandidates({ a: completed("u1", "2026-09-01") }, {}, today);
  assert.deepEqual(due.map((candidate) => candidate.uid), ["u1"]);
  // Not due yet.
  assert.equal(findRebookCandidates({ a: completed("u1", "2026-09-25") }, {}, today).length, 0);
  // Weekly regular: not nudged a week after the last visit, due after two weeks (the shortest interval).
  const regular = { a: completed("u2", "2026-09-19"), b: completed("u2", "2026-09-26"), c: completed("u2", "2026-10-03") };
  assert.equal(findRebookCandidates(regular, {}, today).length, 0);
  assert.equal(findRebookCandidates(regular, {}, { todayKey: "2026-10-17" }).length, 1);
  // Already booked.
  assert.equal(findRebookCandidates({ a: completed("u1", "2026-09-01"), b: { userId: "u1", dateKey: "2026-10-20", status: "confirmed", barberId: "mateusz" } }, {}, today).length, 0);
  // Nudged after the last visit: not again. Nudged before it: new cycle.
  assert.equal(findRebookCandidates({ a: completed("u1", "2026-09-01") }, { u1: { sentAt: Date.parse("2026-09-29T10:00:00Z") } }, today).length, 0);
  assert.equal(findRebookCandidates({ a: completed("u1", "2026-09-01") }, { u1: { sentAt: Date.parse("2026-08-01T10:00:00Z") } }, today).length, 1);
  // Cancelled visits and clients without an account are ignored; long gone clients are left alone.
  assert.equal(findRebookCandidates({ a: completed("", "2026-09-01"), b: { userId: "u3", dateKey: "2026-09-01", status: "cancelled" } }, {}, today).length, 0);
  assert.equal(findRebookCandidates({ a: completed("u1", `2025-01-01`) }, {}, today).length, 0);
  assert.ok(GIVE_UP_AFTER_DAYS > 56);
});

test("the nudge speaks in weeks and names the barber", () => {
  assert.match(formatRebookNudge(28, "Mateusz").body, /^Minęło już 4 tygodnie od ostatniej wizyty u Mateusz\./);
  assert.match(formatRebookNudge(35).body, /^Minęło już 5 tygodni od ostatniej wizyty\./);
  assert.match(formatRebookNudge(7).body, /1 tydzień/);
});

test("review input needs a whole rating from 1 to 5 and trims the text", () => {
  for (const rating of [0, 6, 2.5, "x", undefined]) assert.ok(normalizeReviewInput({ rating }).error);
  assert.deepEqual(normalizeReviewInput({ rating: "5", text: "  Super  " }), { rating: 5, text: "Super" });
  assert.equal(normalizeReviewInput({ rating: 4, text: "a".repeat(900) }).text.length, 400);
});

test("reviews show only the first name and the last initial publicly", () => {
  assert.equal(publicAuthorName("Jan Kowalski"), "Jan K.");
  assert.equal(publicAuthorName("jan   kowalski-nowak"), "jan K.");
  assert.equal(publicAuthorName("Marek"), "Marek");
  assert.equal(publicAuthorName(""), "Klient");
});

test("public reviews are newest first, hide the author's account and give an average and spread per barber", () => {
  const { reviews, summary } = buildPublicReviews({
    one: { barberId: "mateusz", rating: 5, text: "ok", authorName: "Jan K.", createdAt: 1, userId: "secret" },
    two: { barberId: "mateusz", rating: 4, createdAt: 3, userId: "secret" },
    three: { barberId: "kacper", rating: 5, createdAt: 2 },
    broken: { barberId: "kacper", rating: 9, createdAt: 4 },
  });
  assert.deepEqual(reviews.map((review) => review.id), ["two", "three", "one"]);
  assert.ok(reviews.every((review) => !("userId" in review)));
  assert.equal(summary.count, 3);
  assert.equal(summary.average, 4.7);
  assert.deepEqual(summary.distribution, [0, 0, 0, 1, 2]);
  assert.deepEqual(summary.byBarber.mateusz, { count: 2, average: 4.5, distribution: [0, 0, 0, 1, 1] });
});

test("settling a visit queues a review request for the client", async () => {
  const { notificationEventByAction } = await import("../netlify/functions/_notification-service.mjs");
  assert.equal(notificationEventByAction.settle_admin, "visit_settled");
});

test("the keyboard stays open while typing in dialogs", async () => {
  // The dialog focus effect must depend on plain flags. Depending on the dialog's state object made it
  // return focus to the opener after every typed character, which closed the phone keyboard.
  const source = await read("app/booking-home.tsx");
  const effect = source.slice(source.indexOf("const hasSmsComposer = Boolean(smsComposer)"));
  const deps = effect.slice(effect.indexOf("  }, [\n    clientAppointmentsListOpen,"), effect.indexOf("]);", effect.indexOf("clientAppointmentsListOpen,")) + 3);
  assert.ok(deps.includes("hasSmsComposer"), "focus effect should depend on hasSmsComposer");
  assert.ok(!/\bsmsComposer\b/.test(deps), "focus effect must not depend on the smsComposer object");
  assert.ok(!/\bselectedAdminClient\b/.test(deps) && !/\bclientDialog\b/.test(deps));
});

test("the end-of-day window shows only when something is unsettled, once a day, and push links open it", async () => {
  const prompt = await read("app/hooks/use-end-of-day-prompt.tsx");
  assert.match(prompt, /!reached \|\| visits\.length === 0/);
  assert.match(prompt, /wasUnsettledPromptDismissed\(barberId, todayKey\)/);
  const links = await read("app/hooks/use-push-link-actions.ts");
  assert.match(links, /event === "unsettled"/);
  assert.match(links, /event === "rebook"/);
  const home = await read("app/booking-home.tsx");
  assert.match(home, /usePushLinkActions\(/);
  assert.match(home, /useEndOfDayPrompt\(/);
  const service = await read("netlify/functions/daily-summary.mjs");
  assert.match(service, /schedule: "\*\/15 10-21 \* \* \*"/);
  assert.match(service, /decideEndOfDay\(counts/);
});
