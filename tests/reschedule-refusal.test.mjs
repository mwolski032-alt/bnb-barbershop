import assert from "node:assert/strict";
import test from "node:test";

import {
  canRefuseClientReschedule,
  refuseClientReschedule,
  withPreviousSchedule,
  withoutPreviousSchedule,
  withoutRefusalNote,
} from "../shared/reschedule-refusal.mjs";

const now = Date.parse("2099-01-01T08:00:00Z");
const visit = (overrides = {}) => ({
  id: "visit",
  barberId: "mateusz",
  userId: "client",
  dateKey: "2099-01-10",
  startTime: "10:00",
  durationMinutes: 60,
  status: "confirmed",
  ...overrides,
});

test("moving a visit remembers the term it had; moving it again keeps the first term", () => {
  const first = withPreviousSchedule(visit(), visit({ startTime: "15:00", status: "rescheduled" }));
  assert.equal(first.previousDateKey, "2099-01-10");
  assert.equal(first.previousStartTime, "10:00");

  const again = withPreviousSchedule(
    { ...first, status: "rescheduled", rescheduledBy: "client" },
    { ...first, startTime: "16:00" },
  );
  assert.equal(again.previousStartTime, "10:00");
  assert.equal(again.startTime, "16:00");

  const answered = withoutPreviousSchedule(again);
  assert.equal(answered.previousDateKey, undefined);
  assert.equal(answered.previousStartTime, undefined);
});

test("only a move by the client with a remembered term can be refused", () => {
  const moved = visit({ status: "rescheduled", rescheduledBy: "client", startTime: "15:00", previousDateKey: "2099-01-10", previousStartTime: "10:00" });
  assert.equal(canRefuseClientReschedule(moved), true);
  assert.equal(canRefuseClientReschedule({ ...moved, rescheduledBy: "admin" }), false);
  assert.equal(canRefuseClientReschedule({ ...moved, status: "confirmed" }), false);
  assert.equal(canRefuseClientReschedule({ ...moved, previousDateKey: undefined }), false);
});

test("refusing restores the old term, confirms the visit and notes what was refused", () => {
  const moved = visit({ status: "rescheduled", rescheduledBy: "client", startTime: "15:00", previousDateKey: "2099-01-10", previousStartTime: "10:00" });
  const { appointment, error } = refuseClientReschedule({ visit: moved }, moved, { now });
  assert.equal(error, undefined);
  assert.equal(appointment.status, "confirmed");
  assert.equal(appointment.startTime, "10:00");
  assert.equal(appointment.dateKey, "2099-01-10");
  assert.equal(appointment.previousStartTime, undefined);
  assert.deepEqual(appointment.rescheduleRefusedFrom, { dateKey: "2099-01-10", startTime: "15:00" });
  assert.equal(appointment.rescheduleRefusedAt, now);
  assert.equal(withoutRefusalNote(appointment).rescheduleRefusedFrom, undefined);
});

test("refusing fails when the old term is taken, held for someone, past, or not remembered", () => {
  const moved = visit({ status: "rescheduled", rescheduledBy: "client", startTime: "15:00", previousDateKey: "2099-01-10", previousStartTime: "10:00" });
  const other = visit({ id: "other", startTime: "10:30" });
  assert.match(refuseClientReschedule({ visit: moved, other }, moved, { now }).error, /zajęty/);
  // Another barber's visit at the same time is no obstacle; a cancelled one is none either.
  assert.equal(refuseClientReschedule({ visit: moved, other: { ...other, barberId: "kacper" } }, moved, { now }).error, undefined);
  assert.equal(refuseClientReschedule({ visit: moved, other: { ...other, status: "cancelled" } }, moved, { now }).error, undefined);
  assert.match(refuseClientReschedule({ visit: moved }, moved, { now, isHeld: () => true }).error, /zajęty/);
  assert.match(refuseClientReschedule({ visit: moved }, moved, { now: Date.parse("2099-01-10T12:00:00Z") }).error, /minął/);
  assert.match(refuseClientReschedule({ visit: moved }, { ...moved, previousDateKey: undefined }, { now }).error, /poprzedniego terminu/);
});
