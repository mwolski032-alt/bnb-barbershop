import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  appendAppointmentAudit,
  publicAppointmentAudit,
} from "../shared/appointment-audit.mjs";
import {
  backupDateKey,
  buildBusinessBackup,
  expiredBackupKeys,
} from "../shared/business-backup.mjs";

const visit = (overrides = {}) => ({
  id: "visit-1",
  barberId: "mateusz",
  userId: "client-private-uid",
  clientId: "client-card",
  clientName: "Jan Testowy",
  clientEmail: "jan@example.com",
  phone: "500600700",
  serviceName: "Strzyżenie",
  dateKey: "2026-09-20",
  startTime: "10:00",
  status: "confirmed",
  price: "50 zł",
  version: 1,
  ...overrides,
});

test("appointment audit atomically preserves before and after states with the actor", () => {
  const before = {
    team: {
      owner: { userId: "owner", active: true },
      barbers: { mateusz: { userId: "barber-user", active: true, displayName: "Mateusz" } },
    },
    appointments: { "visit-1": visit() },
    appointmentOperations: {},
  };
  const database = structuredClone(before);
  database.appointments["visit-1"] = visit({ dateKey: "2026-09-21", startTime: "12:30", version: 2 });
  database.appointmentOperations["move-1"] = {
    operationId: "move-1",
    action: "reschedule_admin",
    actorUid: "barber-user",
  };

  const record = appendAppointmentAudit(database, before, { operationId: "move-1" }, "barber-user", 1234);
  assert.equal(record.actorRole, "barber");
  assert.equal(record.actorLabel, "Mateusz");
  assert.equal(record.appointments["visit-1"].before.startTime, "10:00");
  assert.equal(record.appointments["visit-1"].after.startTime, "12:30");
  assert.equal(record.createdAt, 1234);
  assert.equal(appendAppointmentAudit(database, before, { operationId: "move-1" }, "barber-user", 9999), null);
  assert.equal(database.appointmentAudit["move-1"].createdAt, 1234);
});

test("owner history projection never sends contact details or account identifiers", () => {
  const database = {
    team: { owner: { userId: "owner", active: true }, barbers: {} },
    appointments: { "visit-1": visit({ status: "cancelled", version: 2 }) },
    appointmentOperations: { cancel: { action: "cancel_admin", actorUid: "owner" } },
  };
  const before = { ...database, appointments: { "visit-1": visit() }, appointmentOperations: {} };
  const record = appendAppointmentAudit(database, before, { operationId: "cancel" }, "owner", 2000);
  const projection = publicAppointmentAudit(record);
  assert.equal(projection.actorRole, "owner");
  assert.equal(projection.changes[0].after.status, "cancelled");
  assert.doesNotMatch(JSON.stringify(projection), /jan@example|500600700|client-private-uid|client-card/);
});

test("daily backup covers business data, has an integrity checksum and keeps fourteen days", () => {
  const backup = buildBusinessBackup({
    appointments: { one: visit() },
    clients: { one: { id: "one" } },
    waitlistEntries: { one: { id: "one" } },
    barbers: { mateusz: {} },
    team: { owner: {} },
    shopfrontSettings: { address: "Test" },
  }, { createdAt: 1000, source: "manual" });
  assert.deepEqual(backup.metadata.counts, { appointments: 1, clients: 1, waitlistEntries: 1, barbers: 1 });
  assert.match(backup.metadata.checksum, /^[a-f0-9]{64}$/);
  assert.equal(backup.data.appointments.one.clientName, "Jan Testowy");
  assert.equal(backupDateKey(new Date("2026-09-09T12:00:00Z")), "2026-09-09");
  const index = Object.fromEntries(Array.from({ length: 16 }, (_, indexValue) => [
    `day-${indexValue}`,
    { createdAt: indexValue + 1 },
  ]));
  assert.deepEqual(expiredBackupKeys(index), ["day-1", "day-0"]);
});

test("backup and history endpoints remain owner-only and backups are scheduled", async () => {
  const [history, backup, worker, scoped, bookingHome] = await Promise.all([
    readFile(new URL("../netlify/functions/appointment-history.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/data-backup.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/backup-worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_scoped-database.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(history, /context\.isOwner/);
  assert.match(backup, /context\.isOwner && context\.active/);
  assert.match(worker, /schedule: "30 2 \* \* \*"/);
  assert.match(scoped, /appendAppointmentAudit\(database, before, result, actorUid\)/);
  assert.match(scoped, /database\.appointmentAudit \?\?= \{\}/);
  assert.match(bookingHome, /ownerPanelTab === "history"/);
  assert.match(bookingHome, />\s*Historia\s*</);
});
