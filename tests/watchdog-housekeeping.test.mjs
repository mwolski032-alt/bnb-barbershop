import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BACKUP_MAX_AGE_MS,
  QUEUE_STALL_MS,
  REMINDER_AFTER_MS,
  alertMessage,
  checkBackup,
  checkQueue,
  checkSite,
  decideAlert,
} from "../shared/watchdog.mjs";
import {
  DEVICE_MAX_IDLE_MS,
  TRIAL_MS,
  isTrial,
  planHousekeeping,
  reportText,
} from "../shared/housekeeping.mjs";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const now = 1_800_000_000_000;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a backup older than a day and a half, or none at all, is a problem", () => {
  assert.equal(checkBackup({ index: { a: { createdAt: now - 3 * HOUR } }, now }).problem, "");
  assert.match(checkBackup({ index: { a: { createdAt: now - BACKUP_MAX_AGE_MS - HOUR } }, now }).problem, /godz/);
  assert.match(checkBackup({ index: {}, now }).problem, /Nie ma żadnej kopii/);
});

test("only notifications stuck past their time count, not delivered, finished or freshly leased ones", () => {
  const late = now - QUEUE_STALL_MS - 1000;
  const jobs = {
    stuck: { status: "retry", nextAttemptAt: late },
    delivered: { status: "delivered", nextAttemptAt: late },
    exhausted: { status: "exhausted", nextAttemptAt: late },
    leased: { status: "processing", nextAttemptAt: late, leaseUntil: now + 60_000 },
    fresh: { status: "retry", nextAttemptAt: now - 1000 },
  };
  assert.match(checkQueue({ jobs, now }).problem, /^1 powiadomień/);
  assert.equal(checkQueue({ jobs: {}, now }).problem, "");
});

test("a site check lists what does not answer", () => {
  assert.equal(checkSite({ results: [{ name: "strona", ok: true }] }).problem, "");
  assert.match(checkSite({ results: [{ name: "strona", ok: true }, { name: "rezerwacje", ok: false, detail: "HTTP 500" }] }).problem, /rezerwacje \(HTTP 500\)/);
});

test("a problem is announced once, repeated after a day, and a recovery is announced once", () => {
  const broken = { id: "backup", problem: "x" };
  const first = decideAlert({ previous: undefined, check: broken, now });
  assert.equal(first.alert, "new");
  assert.equal(decideAlert({ previous: first.state, check: broken, now: now + 5 * HOUR }).alert, "");
  const again = decideAlert({ previous: first.state, check: broken, now: now + REMINDER_AFTER_MS + 1 });
  assert.equal(again.alert, "reminder");
  assert.equal(decideAlert({ previous: again.state, check: broken, now: now + REMINDER_AFTER_MS + HOUR }).alert, "");
  const fixed = decideAlert({ previous: again.state, check: { id: "backup", problem: "" }, now: now + 2 * DAY });
  assert.equal(fixed.alert, "recovered");
  assert.equal(decideAlert({ previous: fixed.state, check: { id: "backup", problem: "" }, now: now + 3 * DAY }).alert, "");
  assert.match(alertMessage({ kind: "new", check: broken, state: first.state }).subject, /Kopia zapasowa nie działa/);
});

test("housekeeping removes devices idle for 180 days, old marks and logs, and keeps everything else", () => {
  const plan = planHousekeeping({
    now,
    tokens: {
      u1: { old: { lastSeenAt: now - DEVICE_MAX_IDLE_MS - DAY }, fresh: { lastSeenAt: now - DAY } },
      u2: { undated: { token: "t" } },
      u3: { stale: { lastSeenAt: now - 400 * DAY, updatedAt: now - 2 * DAY } },
    },
    requestLimits: { u1: { booking: now - 3 * DAY, broadcast: now - HOUR } },
    rebookNudges: { a: { sentAt: now - 500 * DAY }, b: { sentAt: now - 30 * DAY } },
    broadcastLog: { x: { sentAt: now - 400 * DAY }, y: { sentAt: now - 2 * DAY } },
  });
  assert.deepEqual(plan.removals.map((removal) => removal.path).sort(), [
    "broadcastLog/x",
    "notificationTokens/u1/old",
    "rebookNudges/a",
    "requestLimits/u1/booking",
  ]);
  assert.equal(plan.total, 4);
});

test("the first week only reports; the removal starts after it", () => {
  assert.equal(isTrial({ startedAt: undefined, now }), true);
  assert.equal(isTrial({ startedAt: now - 3 * DAY, now }), true);
  assert.equal(isTrial({ startedAt: now - TRIAL_MS - 1, now }), false);
  assert.match(reportText({ counts: { device: 2 }, total: 2, trial: true }), /nic jeszcze nie usunięto/);
  assert.match(reportText({ counts: {}, total: 0, trial: false }), /nic do usunięcia/);
});

test("the scheduled functions are wired: weekly cleanup only deletes outside the trial, the watchdog runs hourly", () => {
  const housekeeping = read("netlify/functions/housekeeping.mjs");
  assert.match(housekeeping, /schedule: "0 3 \* \* 0"/);
  assert.match(housekeeping, /if \(!trial\) for \(const \{ path \} of plan\.removals\) updates\[path\] = null/);
  const watchdog = read("netlify/functions/watchdog.mjs");
  assert.match(watchdog, /schedule: "17 \* \* \* \*"/);
  assert.match(watchdog, /if \(mail\.ok\) updates\[`watchdogState\/\$\{check\.id\}`\] = state/);
});
