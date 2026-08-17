import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveActiveBarberId,
  shouldApplyAppointmentSnapshot,
} from "../shared/appointment-sync.mjs";
import {
  createClientAppointment,
  installAppointmentsFixture,
  kacperUid,
  makeAppointmentRequest,
  mateuszUid,
  tokens,
} from "./helpers/appointments-fixture.mjs";

const fixture = installAppointmentsFixture();
const { default: appointmentsHandler } = await import("../netlify/functions/appointments.mjs");
const request = (token, method, body) =>
  makeAppointmentRequest(appointmentsHandler, token, method, body);

test("duplicate operationId creates one appointment, revision and notification job", async () => {
  fixture.reset();
  const operationId = "duplicate-booking-operation";
  const appointment = createClientAppointment({ id: "duplicate-booking", startTime: "12:00" });
  const body = {
    action: "create_client",
    operationId,
    expectedVersion: 0,
    appointment,
    client: { firstName: "Klient", lastName: "A", phone: "500600700" },
  };

  const responses = await Promise.all([
    request(tokens.clientA, "POST", body),
    request(tokens.clientA, "POST", body),
  ]);
  const results = await Promise.all(responses.map((response) => response.json()));

  assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  assert.equal(results.filter(({ idempotent }) => idempotent).length, 1);
  assert.equal(fixture.database.appointments[appointment.id].version, 1);
  assert.equal(fixture.database.appointments[appointment.id].lastOperationId, operationId);
  assert.equal(fixture.database.appointmentSync.revision, 2);
  assert.deepEqual(Object.keys(fixture.database.appointmentOperations), [operationId]);
  assert.deepEqual(Object.keys(fixture.database.notificationOutbox), [operationId]);
});

test("two roles cannot update the same appointment version", async () => {
  fixture.reset();
  const responses = await Promise.all([
    request(tokens.mateusz, "POST", {
      action: "reschedule_admin",
      operationId: "mateusz-concurrent-update",
      expectedVersion: 1,
      appointmentId: "mateusz-upcoming",
      dateKey: "2099-01-10",
      startTime: "12:00",
    }),
    request(tokens.owner, "POST", {
      action: "reschedule_admin",
      operationId: "owner-concurrent-update",
      expectedVersion: 1,
      appointmentId: "mateusz-upcoming",
      dateKey: "2099-01-10",
      startTime: "13:00",
    }),
  ]);
  const results = await Promise.all(responses.map((response) => response.json()));

  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(results.find(({ code }) => code === "stale_version")?.currentAppointment.version, 2);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].version, 2);
  assert.equal(fixture.database.appointmentSync.revision, 2);
});

test("two client sessions cannot reserve one barber slot", async () => {
  fixture.reset();
  const create = (token, id, userId) =>
    request(token, "POST", {
      action: "create_client",
      operationId: `slot-race-${id}`,
      expectedVersion: 0,
      appointment: createClientAppointment({ id, userId, startTime: "12:00" }),
    });

  const responses = await Promise.all([
    create(tokens.clientA, "slot-race-a", "client-a-uid"),
    create(tokens.clientB, "slot-race-b", "client-b-uid"),
  ]);

  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(
    Object.values(fixture.database.appointments).filter(
      ({ barberId, dateKey, startTime }) =>
        barberId === "mateusz" && dateKey === "2099-01-10" && startTime === "12:00",
    ).length,
    1,
  );
});

test("a deactivated barber cannot replay an earlier successful operation", async () => {
  fixture.reset();
  const body = {
    action: "cancel_admin",
    operationId: "deactivated-replay",
    expectedVersion: 1,
    appointmentId: "mateusz-upcoming",
  };
  const first = await request(tokens.mateusz, "POST", body);
  assert.equal(first.status, 200, await first.text());

  fixture.database.team.barbers.mateusz.active = false;
  const replay = await request(tokens.mateusz, "POST", body);
  const replayResult = await replay.json();

  assert.equal(replay.status, 403);
  assert.equal("appointment" in replayResult, false);
});

test("client, Mateusz and owner receive the same committed version while Kacper stays scoped", async () => {
  fixture.reset();
  const update = await request(tokens.clientA, "POST", {
    action: "reschedule_client",
    operationId: "shared-state-update",
    expectedVersion: 1,
    appointmentId: "mateusz-upcoming",
    dateKey: "2099-01-10",
    startTime: "13:30",
  });
  assert.equal(update.status, 200, await update.text());

  const responses = await Promise.all([
    request(tokens.clientA, "GET"),
    request(tokens.mateusz, "GET"),
    request(tokens.kacper, "GET"),
    request(tokens.owner, "GET"),
  ]);
  const [client, mateusz, kacper, owner] = await Promise.all(
    responses.map((response) => response.json()),
  );
  const select = (items) => items.find(({ id }) => id === "mateusz-upcoming");

  assert.deepEqual(
    [select(client.clientAppointments), select(mateusz.adminAppointments), select(owner.adminAppointments)]
      .map(({ version, startTime }) => ({ version, startTime })),
    Array(3).fill({ version: 2, startTime: "13:30" }),
  );
  assert.equal(select(kacper.adminAppointments), undefined);
  assert.deepEqual(
    [client.syncRevision, mateusz.syncRevision, kacper.syncRevision, owner.syncRevision],
    [2, 2, 2, 2],
  );
});

test("Mateusz and Kacper can book with each other without crossing admin calendars", async () => {
  fixture.reset();
  fixture.database.appointments["mateusz-visits-kacper"] = {
    ...fixture.database.appointments["kacper-upcoming"],
    id: "mateusz-visits-kacper",
    userId: mateuszUid,
    clientId: mateuszUid,
    startTime: "12:00",
  };
  fixture.database.appointments["kacper-visits-mateusz"] = {
    ...fixture.database.appointments["mateusz-upcoming"],
    id: "kacper-visits-mateusz",
    userId: kacperUid,
    clientId: kacperUid,
    startTime: "13:00",
  };

  const [mateuszResponse, kacperResponse] = await Promise.all([
    request(tokens.mateusz, "GET"),
    request(tokens.kacper, "GET"),
  ]);
  const [mateusz, kacper] = await Promise.all([
    mateuszResponse.json(),
    kacperResponse.json(),
  ]);

  assert.equal(mateuszResponse.status, 200);
  assert.equal(kacperResponse.status, 200);
  assert.equal(mateusz.adminAppointments.every(({ barberId }) => barberId === "mateusz"), true);
  assert.equal(kacper.adminAppointments.every(({ barberId }) => barberId === "kacper"), true);
  assert.deepEqual(
    mateusz.clientAppointments.map(({ id }) => id),
    ["mateusz-visits-kacper"],
  );
  assert.deepEqual(
    kacper.clientAppointments.map(({ id }) => id),
    ["kacper-visits-mateusz"],
  );
  assert.equal(new Set(mateusz.occupancy.map(({ barberId }) => barberId)).size, 2);
  assert.equal(new Set(kacper.occupancy.map(({ barberId }) => barberId)).size, 2);
});

test("stale frontend responses are rejected by the shared revision guard", () => {
  assert.equal(shouldApplyAppointmentSnapshot(8, 7), false);
  assert.equal(shouldApplyAppointmentSnapshot(8, 8), true);
  assert.equal(shouldApplyAppointmentSnapshot(8, 9), true);
});

test("barbers can select each other only in the client booking context", () => {
  const activeBarberIds = ["mateusz", "kacper"];
  const resolve = (step, signedInBarberId, selectedBarberId) =>
    resolveActiveBarberId({ step, signedInBarberId, selectedBarberId, activeBarberIds });

  assert.equal(resolve("booking", "mateusz", "kacper"), "kacper");
  assert.equal(resolve("booking", "kacper", "mateusz"), "mateusz");
  assert.equal(resolve("admin", "mateusz", "kacper"), "mateusz");
  assert.equal(resolve("admin", "kacper", "mateusz"), "kacper");
});
