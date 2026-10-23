import assert from "node:assert/strict";
import test from "node:test";

import {
  WAITLIST_OFFER_DURATION_MS,
  WAITLIST_REOFFER_COOLDOWN_MS,
  advanceExpiredWaitlistOffers,
  consumeMatchingWaitlistEntry,
  hasBlockingWaitlistOffer,
  notifyNewWaitlistDays,
  offerWaitlistSlot,
  waitlistCoversDate,
  waitlistEntryMatchesSlot,
} from "../shared/waitlist.mjs";

const now = new Date("2026-08-23T08:00:00.000Z").getTime();
const slot = {
  id: "cancelled-slot",
  barberId: "mateusz",
  serviceId: "cut",
  serviceName: "Strzyżenie",
  price: "70 zł",
  dateKey: "2026-08-24",
  startTime: "15:00",
  durationMinutes: 60,
};

const entry = (id, overrides = {}) => ({
  id,
  userId: `user-${id}`,
  clientName: `Klient ${id}`,
  clientEmail: `${id}@example.com`,
  phone: "500600700",
  barberId: "mateusz",
  serviceId: "cut",
  serviceName: "Strzyżenie",
  durationMinutes: 60,
  dateFrom: "2026-08-24",
  dateTo: "2026-08-30",
  timePreference: "afternoon",
  status: "waiting",
  version: 1,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

test("waitlist matches barber, service, date range and preferred time", () => {
  assert.equal(waitlistEntryMatchesSlot(entry("a"), slot), true);
  assert.equal(waitlistEntryMatchesSlot(entry("b", { barberId: "kacper" }), slot), false);
  assert.equal(waitlistEntryMatchesSlot(entry("c", { serviceId: "beard" }), slot), false);
  assert.equal(waitlistEntryMatchesSlot(entry("d", { timePreference: "morning" }), slot), false);
});

test("oldest matching client receives a ten-minute offer and blocks everyone else", () => {
  const database = {
    appointmentSync: { revision: 3 },
    waitlistEntries: {
      newer: entry("newer", { createdAt: now + 1_000 }),
      oldest: entry("oldest", { createdAt: now - 1_000 }),
    },
  };
  const result = offerWaitlistSlot(database, slot, {
    sourceOperationId: "cancel-operation",
    actorUid: "cancelled-client",
    now,
  });

  assert.equal(result.entry.id, "oldest");
  assert.equal(result.entry.status, "offered");
  assert.equal(result.entry.offer.expiresAt, now + WAITLIST_OFFER_DURATION_MS);
  assert.equal(database.notificationOutbox[result.operationId].event, "waitlist_slot_open");
  assert.equal(hasBlockingWaitlistOffer(database, slot, "someone-else", now), true);
  assert.equal(hasBlockingWaitlistOffer(database, slot, result.entry.userId, now), false);
});

test("expired offer advances to the next person without losing the first waitlist entry", () => {
  const database = {
    appointmentSync: { revision: 1 },
    waitlistEntries: {
      first: entry("first", {
        status: "offered",
        version: 2,
        offer: { ...slot, offeredAt: now - WAITLIST_OFFER_DURATION_MS, expiresAt: now },
      }),
      second: entry("second", { createdAt: now + 1_000 }),
    },
  };
  const result = advanceExpiredWaitlistOffers(database, now + 1);

  assert.equal(result.changed, true);
  assert.equal(database.waitlistEntries.first.status, "waiting");
  assert.equal(
    database.waitlistEntries.first.nextOfferAt,
    now + 1 + WAITLIST_REOFFER_COOLDOWN_MS,
  );
  assert.equal(database.waitlistEntries.second.status, "offered");
  assert.equal(result.notificationOperationIds.length, 1);
});

test("booking the offered slot consumes the matching waitlist entry", () => {
  const database = {
    waitlistEntries: {
      offered: entry("offered", {
        status: "offered",
        offer: { ...slot, offeredAt: now, expiresAt: now + WAITLIST_OFFER_DURATION_MS },
      }),
    },
  };
  const removed = consumeMatchingWaitlistEntry(database, slot, "user-offered");

  assert.deepEqual(removed, ["offered"]);
  assert.equal(database.waitlistEntries.offered, undefined);
});

const teamWithCut = (availability = {}) => ({
  team: { barbers: { mateusz: { userId: "barber-user", active: true } } },
  barbers: {
    mateusz: {
      services: {
        cut: { id: "cut", barberId: "mateusz", name: "Strzyżenie", price: "70 zł", durationMinutes: 60 },
      },
      workSettings: { availability },
    },
  },
  appointments: {},
});
const window = (dateKey, startTime = "12:00", endTime = "17:00") => ({
  id: dateKey, barberId: "mateusz", dateKey, startTime, endTime,
});

test("chosen days narrow the wishes; an old entry with only a range still covers all its days", () => {
  const picked = entry("picked", { dates: ["2026-08-25", "2026-08-27"] });
  assert.equal(waitlistCoversDate(picked, "2026-08-25"), true);
  assert.equal(waitlistCoversDate(picked, "2026-08-26"), false);
  assert.equal(waitlistCoversDate(entry("range"), "2026-08-26"), true);
  assert.equal(waitlistEntryMatchesSlot(picked, { ...slot, dateKey: "2026-08-26" }), false);
  assert.equal(waitlistEntryMatchesSlot(picked, { ...slot, dateKey: "2026-08-27" }), true);
  const database = { waitlistEntries: { picked } };
  assert.deepEqual(consumeMatchingWaitlistEntry(database, { ...slot, dateKey: "2026-08-26" }, "user-picked"), []);
  assert.deepEqual(consumeMatchingWaitlistEntry(database, { ...slot, dateKey: "2026-08-27" }, "user-picked"), ["picked"]);
});

test("a day the barber adds is announced once, to the waiting client, and nothing is held", () => {
  const database = {
    ...teamWithCut(),
    waitlistEntries: { waiting: entry("waiting") },
  };
  // First pass: nothing is free, so there is nothing to record or announce.
  assert.equal(notifyNewWaitlistDays(database, { now }).notifiedCount, 0);
  assert.deepEqual(database.waitlistEntries.waiting.notifiedDates, []);

  database.barbers.mateusz.workSettings.availability["2026-08-24"] = window("2026-08-24");
  const result = notifyNewWaitlistDays(database, { now });

  assert.equal(result.notifiedCount, 1);
  const stored = database.waitlistEntries.waiting;
  assert.equal(stored.status, "waiting");
  assert.equal(stored.offer, undefined);
  assert.equal(stored.version, 1);
  assert.deepEqual(stored.notifiedDates, ["2026-08-24"]);
  const job = database.notificationOutbox[result.notificationOperationIds[0]];
  assert.equal(job.event, "waitlist_day_open");
  const operation = database.appointmentOperations[result.notificationOperationIds[0]];
  assert.equal(operation.action, "notify_waitlist_day");
  assert.deepEqual(operation.appointment.newDates, ["2026-08-24"]);
  assert.equal(operation.appointment.offerExpiresAt, undefined);
  // Nobody else is blocked from booking it.
  assert.equal(hasBlockingWaitlistOffer(database, { ...slot, startTime: "13:00" }, "someone-else", now), false);
  // The same day is not announced again.
  assert.equal(notifyNewWaitlistDays(database, { now }).notifiedCount, 0);
});

test("days that are free when the client signs up are recorded silently, not announced", () => {
  const database = {
    ...teamWithCut({ "2026-08-24": window("2026-08-24") }),
    waitlistEntries: { fresh: entry("fresh") },
  };
  const first = notifyNewWaitlistDays(database, { now });
  assert.equal(first.notifiedCount, 0);
  assert.equal(first.changed, true);
  assert.deepEqual(database.waitlistEntries.fresh.notifiedDates, ["2026-08-24"]);
  database.barbers.mateusz.workSettings.availability["2026-08-26"] = window("2026-08-26");
  assert.equal(notifyNewWaitlistDays(database, { now }).notifiedCount, 1);
});

test("several new days make one notification, and a day that filled up and reopens counts as new", () => {
  const database = {
    ...teamWithCut({ "2026-08-24": window("2026-08-24", "12:00", "13:00") }),
    waitlistEntries: { waiting: entry("waiting", { dates: ["2026-08-24", "2026-08-25", "2026-08-26"], timePreference: "any" }) },
  };
  notifyNewWaitlistDays(database, { now });
  database.barbers.mateusz.workSettings.availability["2026-08-25"] = window("2026-08-25");
  database.barbers.mateusz.workSettings.availability["2026-08-26"] = window("2026-08-26");
  const result = notifyNewWaitlistDays(database, { now });
  assert.equal(result.notifiedCount, 1);
  assert.deepEqual(
    database.appointmentOperations[result.notificationOperationIds[0]].appointment.newDates,
    ["2026-08-25", "2026-08-26"],
  );

  // The 25th fills up completely, then the barber widens the window: it is new again.
  database.appointments.full = { ...slot, dateKey: "2026-08-25", startTime: "12:00", durationMinutes: 300, status: "confirmed" };
  assert.equal(notifyNewWaitlistDays(database, { now }).notifiedCount, 0);
  assert.deepEqual(database.waitlistEntries.waiting.notifiedDates, ["2026-08-24", "2026-08-26"]);
  database.barbers.mateusz.workSettings.availability["2026-08-25"] = window("2026-08-25", "12:00", "20:00");
  assert.equal(notifyNewWaitlistDays(database, { now }).notifiedCount, 1);
});

test("an entry that already holds an offer, or cools down after one, is left alone", () => {
  const database = {
    ...teamWithCut({ "2026-08-24": window("2026-08-24") }),
    waitlistEntries: {
      offered: entry("offered", { status: "offered", offer: { ...slot, offeredAt: now, expiresAt: now + 1000 } }),
      cooling: entry("cooling", { nextOfferAt: now + 60_000 }),
    },
  };
  const result = notifyNewWaitlistDays(database, { now });
  assert.equal(result.notifiedCount, 0);
  assert.equal(result.changed, false);
});