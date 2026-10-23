import assert from "node:assert/strict";
import test from "node:test";

process.env.NOTIFICATION_ACTION_SECRET = "test-only-notification-action-secret";

const {
  createNotificationActionToken,
  verifyNotificationActionToken,
} = await import("../netlify/functions/lib/notification-action-token.mjs");

const now = Date.UTC(2026, 8, 12, 10, 0, 0);
const appointment = {
  id: "appointment-action-1",
  userId: "client-action-1",
  dateKey: "2026-09-20",
  startTime: "14:30",
  version: 4,
  lastOperationId: "reschedule-operation-1",
};

test("notification action token preserves only the signed appointment version", () => {
  const token = createNotificationActionToken(appointment, now);
  const claims = verifyNotificationActionToken(token, now + 1000);

  assert.equal(claims.appointmentId, appointment.id);
  assert.equal(claims.userId, appointment.userId);
  assert.equal(claims.dateKey, appointment.dateKey);
  assert.equal(claims.startTime, appointment.startTime);
  assert.equal(claims.appointmentVersion, appointment.version);
  assert.equal(claims.scheduleOperationId, appointment.lastOperationId);
  assert.equal(claims.action, "confirm_reschedule");
});

test("notification action token rejects tampering and expiry", () => {
  const token = createNotificationActionToken(appointment, now);
  const [payload, signature] = token.split(".");

  assert.equal(verifyNotificationActionToken(`${payload}x.${signature}`, now), null);
  assert.equal(verifyNotificationActionToken(token, now + 8 * 24 * 60 * 60 * 1000), null);
});
