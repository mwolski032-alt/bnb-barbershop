import assert from "node:assert/strict";
import test from "node:test";

import {
  formatNearestAppointmentLabel,
  selectNearestAppointments,
} from "../shared/appointment-label.mjs";

const nowTimestamp = new Date("2026-08-22T10:00:00.000Z").getTime();

test("shows how many minutes remain until today's nearest appointment", () => {
  assert.equal(
    formatNearestAppointmentLabel({
      distanceLabel: "Dzisiaj",
      startTime: "12:25",
      startTimestamp: nowTimestamp + 25 * 60000,
      nowTimestamp,
    }),
    "Najbliższa wizyta · dzisiaj za 25 minut",
  );
});

test("shows how many minutes ago the nearest appointment started", () => {
  assert.equal(
    formatNearestAppointmentLabel({
      distanceLabel: "Dzisiaj",
      startTime: "11:50",
      startTimestamp: nowTimestamp - 10 * 60000,
      nowTimestamp,
    }),
    "Najbliższa wizyta · rozpoczęła się 10 minut temu",
  );
});

test("keeps a concise day and time label for appointments from following days", () => {
  assert.equal(
    formatNearestAppointmentLabel({
      distanceLabel: "Jutro",
      startTime: "10:30",
      startTimestamp: nowTimestamp + 24 * 60 * 60000,
      nowTimestamp,
    }),
    "Najbliższa wizyta · jutro o 10:30",
  );
});

test("uses correct Polish singular and few-minute forms", () => {
  assert.equal(
    formatNearestAppointmentLabel({
      distanceLabel: "Dzisiaj",
      startTime: "12:01",
      startTimestamp: nowTimestamp + 60000,
      nowTimestamp,
    }),
    "Najbliższa wizyta · dzisiaj za 1 minutę",
  );
  assert.equal(
    formatNearestAppointmentLabel({
      distanceLabel: "Dzisiaj",
      startTime: "12:02",
      startTimestamp: nowTimestamp + 2 * 60000,
      nowTimestamp,
    }),
    "Najbliższa wizyta · dzisiaj za 2 minuty",
  );
});

test("selects exactly four nearest appointments even when they span different days", () => {
  const appointments = [
    { id: "fifth", dateKey: "2026-08-27", startTime: "09:00" },
    { id: "third", dateKey: "2026-08-25", startTime: "14:30" },
    { id: "first", dateKey: "2026-08-23", startTime: "12:10" },
    { id: "fourth", dateKey: "2026-08-26", startTime: "08:00" },
    { id: "second", dateKey: "2026-08-24", startTime: "10:00" },
  ];

  assert.deepEqual(
    selectNearestAppointments(appointments).map(({ id }) => id),
    ["first", "second", "third", "fourth"],
  );
  assert.deepEqual(selectNearestAppointments([], 4), []);
});
