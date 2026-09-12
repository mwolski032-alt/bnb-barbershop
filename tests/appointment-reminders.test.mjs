import assert from "node:assert/strict";
import test from "node:test";

import {
  APPOINTMENT_REMINDER_LEAD_MS,
  appointmentReminderOperationId,
  appointmentTimestamp,
  enqueueAppointmentReminders,
} from "../shared/appointment-reminders.mjs";

const appointment = (overrides = {}) => ({
  id: "visit-1",
  barberId: "mateusz",
  userId: "client-1",
  clientName: "Jan Kowalski",
  serviceId: "cut",
  serviceName: "Strzyżenie męskie",
  dateKey: "2026-09-13",
  startTime: "12:00",
  durationMinutes: 60,
  status: "confirmed",
  version: 1,
  ...overrides,
});

test("maps the Warsaw appointment time to a stable timestamp", () => {
  assert.equal(
    appointmentTimestamp("2026-09-13", "12:00"),
    Date.parse("2026-09-13T10:00:00.000Z"),
  );
  assert.equal(
    appointmentTimestamp("2026-12-13", "12:00"),
    Date.parse("2026-12-13T11:00:00.000Z"),
  );
});

test("queues one durable reminder in advance for exactly 24 hours and never duplicates it", () => {
  const visit = appointment();
  const startsAt = appointmentTimestamp(visit.dateKey, visit.startTime);
  const reminderAt = startsAt - APPOINTMENT_REMINDER_LEAD_MS;
  const now = reminderAt - 2 * 24 * 60 * 60 * 1000;
  const database = {
    appointments: { [visit.id]: visit },
    appointmentOperations: {},
    notificationOutbox: {},
  };

  const first = enqueueAppointmentReminders(database, now);
  const second = enqueueAppointmentReminders(database, now + 30_000);
  const operationId = appointmentReminderOperationId(visit);

  assert.equal(first.queuedCount, 1);
  assert.deepEqual(first.notificationOperationIds, [operationId]);
  assert.equal(second.queuedCount, 0);
  assert.equal(database.appointmentOperations[operationId].action, "appointment_reminder");
  assert.equal(database.notificationOutbox[operationId].event, "appointment_reminder");
  assert.equal(database.notificationOutbox[operationId].nextAttemptAt, reminderAt);
});

test("does not queue late, closed, past or anonymous appointment reminders", () => {
  const dueVisit = appointment();
  const startsAt = appointmentTimestamp(dueVisit.dateKey, dueVisit.startTime);
  const database = {
    appointments: {
      late: appointment({ id: "late", startTime: "12:00" }),
      cancelled: appointment({ id: "cancelled", status: "cancelled" }),
      completed: appointment({ id: "completed", status: "completed" }),
      anonymous: appointment({ id: "anonymous", userId: "" }),
      past: appointment({ id: "past", dateKey: "2026-09-11" }),
    },
  };

  const result = enqueueAppointmentReminders(
    database,
    startsAt - APPOINTMENT_REMINDER_LEAD_MS + 1,
  );
  assert.equal(result.queuedCount, 0);
});
