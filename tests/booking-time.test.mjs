import assert from "node:assert/strict";
import test from "node:test";

import { getZonedDateTime, isBookableStartTime } from "../shared/booking-time.mjs";

const noonInWarsaw = new Date("2026-08-22T10:00:00.000Z");

test("recognizes the current date and time in the barbershop time zone", () => {
  assert.deepEqual(getZonedDateTime(noonInWarsaw), {
    dateKey: "2026-08-22",
    minutes: 12 * 60,
  });
});

test("hides elapsed and current slots while keeping future slots", () => {
  assert.equal(isBookableStartTime("2026-08-21", "18:00", noonInWarsaw), false);
  assert.equal(isBookableStartTime("2026-08-22", "10:00", noonInWarsaw), false);
  assert.equal(isBookableStartTime("2026-08-22", "12:00", noonInWarsaw), false);
  assert.equal(isBookableStartTime("2026-08-22", "12:15", noonInWarsaw), true);
  assert.equal(isBookableStartTime("2026-08-23", "08:00", noonInWarsaw), true);
});

test("handles Warsaw daylight-saving time without relying on the device time zone", () => {
  const winterNoonInWarsaw = new Date("2026-01-10T11:00:00.000Z");
  assert.equal(isBookableStartTime("2026-01-10", "11:45", winterNoonInWarsaw), false);
  assert.equal(isBookableStartTime("2026-01-10", "12:15", winterNoonInWarsaw), true);
});
