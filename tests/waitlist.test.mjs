import assert from "node:assert/strict";
import test from "node:test";

import {
  WAITLIST_OFFER_DURATION_MS,
  advanceExpiredWaitlistOffers,
  consumeMatchingWaitlistEntry,
  hasBlockingWaitlistOffer,
  offerWaitlistSlot,
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
