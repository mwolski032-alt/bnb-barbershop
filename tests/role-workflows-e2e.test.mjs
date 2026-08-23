import assert from "node:assert/strict";
import test from "node:test";

import {
  clientAUid,
  clientBUid,
  createClientAppointment,
  installAppointmentsFixture,
  makeAppointmentRequest,
  tokens,
} from "./helpers/appointments-fixture.mjs";

const fixture = installAppointmentsFixture();
const { default: appointmentsHandler } = await import("../netlify/functions/appointments.mjs");
const request = (token, method, body) =>
  makeAppointmentRequest(appointmentsHandler, token, method, body);

test("E2E roles: client, Mateusz, Kacper and owner see only their API calendars", async () => {
  fixture.reset();

  const [clientResponse, mateuszResponse, kacperResponse, ownerResponse] = await Promise.all([
    request(tokens.clientA, "GET"),
    request(tokens.mateusz, "GET"),
    request(tokens.kacper, "GET"),
    request(tokens.owner, "GET"),
  ]);
  const [client, mateusz, kacper, owner] = await Promise.all([
    clientResponse.json(),
    mateuszResponse.json(),
    kacperResponse.json(),
    ownerResponse.json(),
  ]);

  assert.deepEqual(client.clientAppointments.map(({ id }) => id), ["mateusz-upcoming"]);
  assert.deepEqual(mateusz.adminAppointments.map(({ id }) => id), ["mateusz-upcoming"]);
  assert.deepEqual(
    kacper.adminAppointments.map(({ id }) => id).sort(),
    ["kacper-past", "kacper-upcoming"],
  );
  assert.deepEqual(
    owner.adminAppointments.map(({ id }) => id).sort(),
    ["kacper-past", "kacper-upcoming", "mateusz-upcoming"],
  );
  assert.deepEqual(
    [client.context.role, mateusz.context.role, kacper.context.role, owner.context.role],
    ["client", "barber", "barber", "owner"],
  );
  assert.equal(mateusz.context.barberId, "mateusz");
  assert.equal(kacper.context.barberId, "kacper");
  assert.equal(client.teamMembers.some((member) => "userId" in member || "access" in member), false);
  assert.equal(owner.teamMembers.every((member) => "userId" in member && "access" in member), true);
  assert.equal("clientName" in client.occupancy[0], false);
  assert.equal(JSON.stringify(client.occupancy).includes("client-b@example.com"), false);
});

test("E2E Google identity: login links manual visits and routes later notifications to the client", async () => {
  fixture.reset();
  fixture.database.clients["manual-google-client"] = {
    id: "manual-google-client",
    firstName: "Klient",
    lastName: "A",
    email: "CLIENT-A@example.com",
    phone: "511222333",
    barberIds: { mateusz: true },
  };
  fixture.database.appointments["manual-google-visit"] = {
    id: "manual-google-visit",
    barberId: "mateusz",
    clientId: "manual-google-client",
    serviceId: "cut",
    clientName: "Klient A",
    clientEmail: "client-a@example.com",
    phone: "511222333",
    serviceName: "Strzyzenie",
    price: "50 zl",
    dateKey: "2099-01-10",
    startTime: "12:00",
    durationMinutes: 60,
    color: "blue",
    status: "confirmed",
    version: 1,
  };

  const loginResponse = await request(tokens.clientA, "GET");
  const loginResult = await loginResponse.json();

  assert.equal(loginResponse.status, 200, JSON.stringify(loginResult));
  assert.deepEqual(
    loginResult.clientAppointments.map(({ id }) => id).sort(),
    ["manual-google-visit", "mateusz-upcoming"],
  );
  assert.equal(fixture.database.clients["manual-google-client"], undefined);
  assert.equal(fixture.database.clients[clientAUid].userId, clientAUid);
  assert.equal(fixture.database.appointments["manual-google-visit"].clientId, clientAUid);
  assert.equal(fixture.database.appointments["manual-google-visit"].userId, clientAUid);
  assert.equal(fixture.database.appointments["manual-google-visit"].version, 2);

  const operationId = "admin-reschedule-linked-google-client";
  const rescheduleResponse = await request(tokens.mateusz, "POST", {
    action: "reschedule_admin",
    operationId,
    expectedVersion: 2,
    appointmentId: "manual-google-visit",
    dateKey: "2099-01-10",
    startTime: "14:00",
  });

  assert.equal(rescheduleResponse.status, 200, await rescheduleResponse.text());
  assert.equal(fixture.database.appointmentOperations[operationId].appointment.userId, clientAUid);
  assert.equal(fixture.database.notificationOutbox[operationId].userId, clientAUid);
});

test("E2E identity safety: an unverified email cannot claim a manual client card", async () => {
  fixture.reset();
  fixture.database.clients["unverified-manual-client"] = {
    id: "unverified-manual-client",
    firstName: "Niezweryfikowany",
    lastName: "Klient",
    email: "unverified@example.com",
    phone: "511222333",
    barberIds: { mateusz: true },
  };
  fixture.database.appointments["unverified-manual-visit"] = {
    id: "unverified-manual-visit",
    barberId: "mateusz",
    clientId: "unverified-manual-client",
    serviceId: "cut",
    clientName: "Niezweryfikowany Klient",
    clientEmail: "unverified@example.com",
    phone: "511222333",
    serviceName: "Strzyzenie",
    price: "50 zl",
    dateKey: "2099-01-10",
    startTime: "12:00",
    durationMinutes: 60,
    color: "blue",
    status: "confirmed",
    version: 1,
  };

  const response = await request(tokens.unverifiedClient, "GET");
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.clientAppointments, []);
  assert.equal(fixture.database.clients["unverified-manual-client"].userId, undefined);
  assert.equal(fixture.database.appointments["unverified-manual-visit"].userId, undefined);
});

test("E2E client directory: each barber receives only assigned clients while owner sees both", async () => {
  fixture.reset();

  const [mateuszResponse, kacperResponse, ownerResponse] = await Promise.all([
    request(tokens.mateusz, "GET"),
    request(tokens.kacper, "GET"),
    request(tokens.owner, "GET"),
  ]);
  const [mateusz, kacper, owner] = await Promise.all([
    mateuszResponse.json(),
    kacperResponse.json(),
    ownerResponse.json(),
  ]);

  assert.deepEqual(mateusz.adminClients.map(({ id }) => id), [clientAUid]);
  assert.deepEqual(kacper.adminClients.map(({ id }) => id), [clientBUid]);
  assert.deepEqual(owner.adminClients.map(({ id }) => id).sort(), [clientAUid, clientBUid]);
});

test("E2E waitlist: clients see only their entries and barbers see only their own queue", async () => {
  fixture.reset();
  const join = await request(tokens.clientB, "POST", {
    action: "join_waitlist",
    waitlistEntry: {
      id: "waitlist-client-b",
      barberId: "mateusz",
      serviceId: "cut",
      clientName: "Klient B",
      phone: "600700800",
      dateFrom: "2099-01-10",
      dateTo: "2099-01-20",
      timePreference: "morning",
    },
  });
  assert.equal(join.status, 200, await join.text());

  const [clientAResponse, clientBResponse, mateuszResponse, kacperResponse] = await Promise.all([
    request(tokens.clientA, "GET"),
    request(tokens.clientB, "GET"),
    request(tokens.mateusz, "GET"),
    request(tokens.kacper, "GET"),
  ]);
  const [clientA, clientB, mateusz, kacper] = await Promise.all([
    clientAResponse.json(),
    clientBResponse.json(),
    mateuszResponse.json(),
    kacperResponse.json(),
  ]);

  assert.deepEqual(clientA.clientWaitlist, []);
  assert.deepEqual(clientB.clientWaitlist.map(({ id }) => id), ["waitlist-client-b"]);
  assert.deepEqual(mateusz.adminWaitlist.map(({ id }) => id), ["waitlist-client-b"]);
  assert.deepEqual(kacper.adminWaitlist, []);
});

test("E2E waitlist: cancellation offers and holds the slot for the oldest matching client", async () => {
  fixture.reset();
  const join = await request(tokens.clientB, "POST", {
    action: "join_waitlist",
    waitlistEntry: {
      id: "waitlist-held-slot",
      barberId: "mateusz",
      serviceId: "cut",
      clientName: "Klient B",
      phone: "600700800",
      dateFrom: "2099-01-10",
      dateTo: "2099-01-10",
      timePreference: "morning",
    },
  });
  assert.equal(join.status, 200, await join.text());

  const cancel = await request(tokens.clientA, "POST", {
    action: "cancel_client",
    appointmentId: "mateusz-upcoming",
  });
  assert.equal(cancel.status, 200, await cancel.text());
  const offered = fixture.database.waitlistEntries["waitlist-held-slot"];
  assert.equal(offered.status, "offered");
  assert.equal(offered.offer.startTime, "09:00");
  const waitlistJob = Object.values(fixture.database.notificationOutbox).find(
    (job) => job.event === "waitlist_slot_open",
  );
  assert.equal(waitlistJob.userId, clientBUid);

  const blockedAppointment = createClientAppointment({
    id: "blocked-by-waitlist",
    userId: clientAUid,
    startTime: "09:00",
  });
  const blocked = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment: blockedAppointment,
    client: { firstName: "Klient", lastName: "A", phone: "500600700" },
  });
  assert.equal(blocked.status, 409);

  const acceptedAppointment = createClientAppointment({
    id: "accepted-waitlist-slot",
    userId: clientBUid,
    startTime: "09:00",
  });
  const accepted = await request(tokens.clientB, "POST", {
    action: "create_client",
    appointment: acceptedAppointment,
    client: { firstName: "Klient", lastName: "B", phone: "600700800" },
  });
  assert.equal(accepted.status, 200, await accepted.text());
  assert.equal(fixture.database.waitlistEntries["waitlist-held-slot"], undefined);
  assert.equal(fixture.database.appointments[acceptedAppointment.id].userId, clientBUid);
});

test("E2E client flow: booking, client reschedule, barber confirmation and cancellation", async () => {
  fixture.reset();
  const appointment = createClientAppointment({ id: "client-lifecycle" });

  const createResponse = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
    client: { firstName: "Klient", lastName: "A", phone: "500600700" },
  });
  assert.equal(createResponse.status, 200, await createResponse.text());

  const rescheduleResponse = await request(tokens.clientA, "POST", {
    action: "reschedule_client",
    appointmentId: appointment.id,
    dateKey: "2099-01-10",
    startTime: "13:30",
  });
  assert.equal(rescheduleResponse.status, 200, await rescheduleResponse.text());
  assert.equal(fixture.database.appointments[appointment.id].rescheduledBy, "client");

  const confirmResponse = await request(tokens.mateusz, "POST", {
    action: "confirm_admin",
    appointmentId: appointment.id,
    expectedVersion: 2,
  });
  assert.equal(confirmResponse.status, 200, await confirmResponse.text());
  assert.equal(fixture.database.appointments[appointment.id].confirmedBy, "admin");

  const cancelResponse = await request(tokens.clientA, "POST", {
    action: "cancel_client",
    appointmentId: appointment.id,
    expectedVersion: 3,
  });
  assert.equal(cancelResponse.status, 200, await cancelResponse.text());
  assert.equal(fixture.database.appointments[appointment.id], undefined);
});

test("E2E barber flow: admin reschedule, client confirmation, cancellation and settlement", async () => {
  fixture.reset();

  const rescheduleResponse = await request(tokens.kacper, "POST", {
    action: "reschedule_admin",
    appointmentId: "kacper-upcoming",
    dateKey: "2099-01-10",
    startTime: "11:30",
  });
  assert.equal(rescheduleResponse.status, 200, await rescheduleResponse.text());
  assert.equal(fixture.database.appointments["kacper-upcoming"].rescheduledBy, "admin");

  const confirmResponse = await request(tokens.clientB, "POST", {
    action: "confirm_client",
    appointmentId: "kacper-upcoming",
    expectedVersion: 2,
  });
  assert.equal(confirmResponse.status, 200, await confirmResponse.text());
  assert.equal(fixture.database.appointments["kacper-upcoming"].confirmedBy, "client");

  const cancelResponse = await request(tokens.kacper, "POST", {
    action: "cancel_admin",
    appointmentId: "kacper-upcoming",
    expectedVersion: 3,
  });
  assert.equal(cancelResponse.status, 200, await cancelResponse.text());
  assert.equal(fixture.database.appointments["kacper-upcoming"], undefined);

  const settleResponse = await request(tokens.kacper, "POST", {
    action: "settle_admin",
    appointmentId: "kacper-past",
    amount: 50,
  });
  assert.equal(settleResponse.status, 200, await settleResponse.text());
  assert.deepEqual(
    {
      status: fixture.database.appointments["kacper-past"].status,
      barberId: fixture.database.appointments["kacper-past"].settlement.barberId,
      amount: fixture.database.appointments["kacper-past"].settlement.amount,
    },
    { status: "completed", barberId: "kacper", amount: 50 },
  );
  assert.equal("settledAt" in fixture.database.appointments["kacper-past"], false);
  assert.equal("settledAmount" in fixture.database.appointments["kacper-past"], false);
});

test("E2E calendar flow: barber can mark an ended visit as a no-show but not a future visit", async () => {
  fixture.reset();

  const noShowResponse = await request(tokens.kacper, "POST", {
    action: "mark_no_show_admin",
    appointmentId: "kacper-past",
  });
  const noShowResult = await noShowResponse.json();
  assert.equal(noShowResponse.status, 200, JSON.stringify(noShowResult));
  assert.equal(noShowResult.appointment.status, "no_show");
  assert.equal(noShowResult.appointment.noShowBy, "admin");
  assert.equal(typeof noShowResult.appointment.noShowAt, "number");
  assert.equal(fixture.database.appointments["kacper-past"], undefined);

  const closedVisitResponse = await request(tokens.kacper, "POST", {
    action: "settle_admin",
    appointmentId: "kacper-past",
    expectedVersion: 2,
    amount: 50,
  });
  assert.equal(closedVisitResponse.status, 404);
  assert.equal(fixture.database.appointments["kacper-past"], undefined);

  const futureNoShowResponse = await request(tokens.kacper, "POST", {
    action: "mark_no_show_admin",
    appointmentId: "kacper-upcoming",
  });
  assert.equal(futureNoShowResponse.status, 409);
  assert.equal(fixture.database.appointments["kacper-upcoming"].status, "confirmed");
});

test("E2E calendar permissions: barber cannot mark another barber's visit as a no-show", async () => {
  fixture.reset();

  const denied = await request(tokens.mateusz, "POST", {
    action: "mark_no_show_admin",
    appointmentId: "kacper-past",
  });

  assert.equal(denied.status, 403);
  assert.equal(fixture.database.appointments["kacper-past"].status, "confirmed");
});

test("E2E permissions: barber cannot mutate another barber calendar while owner can", async () => {
  fixture.reset();

  const denied = await request(tokens.mateusz, "POST", {
    action: "cancel_admin",
    appointmentId: "kacper-upcoming",
  });
  assert.equal(denied.status, 403);
  assert.equal(fixture.database.appointments["kacper-upcoming"].status, "confirmed");

  const ownerUpdate = await request(tokens.owner, "POST", {
    action: "reschedule_admin",
    appointmentId: "kacper-upcoming",
    dateKey: "2099-01-10",
    startTime: "14:00",
  });
  assert.equal(ownerUpdate.status, 200, await ownerUpdate.text());
  assert.equal(fixture.database.appointments["kacper-upcoming"].startTime, "14:00");
});

test("E2E permissions: client cannot mutate another client's appointment", async () => {
  fixture.reset();

  const response = await request(tokens.clientB, "POST", {
    action: "cancel_client",
    appointmentId: "mateusz-upcoming",
  });

  assert.equal(response.status, 403);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].status, "confirmed");
});

test("E2E data integrity: a new appointment requires an explicit barber assignment", async () => {
  fixture.reset();
  const appointment = createClientAppointment({ id: "missing-barber" });
  delete appointment.barberId;

  const response = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
  });

  assert.equal(response.status, 400);
  assert.equal(fixture.database.appointments[appointment.id], undefined);
});

test("E2E data integrity: booking rejects a service outside the selected barber catalog", async () => {
  fixture.reset();
  const appointment = createClientAppointment({ id: "invalid-service" });
  appointment.serviceId = "missing-service";

  const response = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
  });

  assert.equal(response.status, 409);
  assert.equal(fixture.database.appointments[appointment.id], undefined);
});

test("E2E permissions: client directory mutations are scoped to the signed-in barber", async () => {
  fixture.reset();

  const deniedClient = await request(tokens.clientA, "POST", {
    action: "upsert_admin_client",
    barberId: "mateusz",
    client: { id: "manual-client", firstName: "Nowy", lastName: "Klient" },
  });
  assert.equal(deniedClient.status, 403);

  const kacperWrite = await request(tokens.kacper, "POST", {
    action: "upsert_admin_client",
    barberId: "mateusz",
    client: {
      id: "kacper-manual-client",
      firstName: "Nowy",
      lastName: "Klient",
      email: "nowy@example.com",
      phone: "500500500",
    },
  });
  assert.equal(kacperWrite.status, 200, await kacperWrite.text());
  assert.deepEqual(fixture.database.clients["kacper-manual-client"].barberIds, { kacper: true });
  assert.equal(fixture.database.clients["kacper-manual-client"].barberIds.mateusz, undefined);

  const hideResponse = await request(tokens.kacper, "POST", {
    action: "hide_admin_client",
    barberId: "mateusz",
    clientId: clientBUid,
  });
  assert.equal(hideResponse.status, 200, await hideResponse.text());
  assert.equal(fixture.database.clients[clientBUid].hiddenFor.kacper, true);
  assert.equal(fixture.database.clients[clientBUid].hiddenFor.mateusz, undefined);

  const deleteResponse = await request(tokens.kacper, "POST", {
    action: "delete_admin_client",
    clientId: "kacper-manual-client",
  });
  assert.equal(deleteResponse.status, 200, await deleteResponse.text());
  assert.equal(fixture.database.clients["kacper-manual-client"], undefined);
});

test("E2E owner deletion permanently removes a client and every linked appointment", async () => {
  fixture.reset();

  const response = await request(tokens.owner, "POST", {
    action: "delete_admin_client",
    barberId: "mateusz",
    clientId: clientAUid,
  });

  assert.equal(response.status, 200, await response.text());
  assert.equal(fixture.database.clients[clientAUid], undefined);
  assert.equal(fixture.database.appointments["mateusz-upcoming"], undefined);
  assert.equal(fixture.database.appointments["kacper-upcoming"]?.clientId, clientBUid);
});

test("E2E permissions: client access alone cannot create an appointment through the directory", async () => {
  fixture.reset();
  fixture.database.team.barbers.mateusz.access.schedule = false;

  const appointment = createClientAppointment({
    id: "clients-only-booking",
    dateKey: "2099-01-10",
    startTime: "15:00",
  });
  const response = await request(tokens.mateusz, "POST", {
    action: "upsert_admin_client",
    barberId: "mateusz",
    client: {
      id: clientAUid,
      firstName: "Klient",
      lastName: "A",
      email: "client-a@example.com",
      phone: "500600700",
    },
    appointment,
  });

  assert.equal(response.status, 403);
  assert.equal(fixture.database.appointments[appointment.id], undefined);
  assert.equal(fixture.database.clients[clientAUid].phone, "500600700");
});

test("E2E permissions: disabled section access removes its data and mutation capability", async () => {
  fixture.reset();
  fixture.database.team.barbers.mateusz.access.clients = false;

  const readResponse = await request(tokens.mateusz, "GET");
  const result = await readResponse.json();
  assert.equal("adminClients" in result, true);
  assert.deepEqual(result.adminClients, []);

  const writeResponse = await request(tokens.mateusz, "POST", {
    action: "hide_admin_client",
    clientId: clientAUid,
  });
  assert.equal(writeResponse.status, 403);

  const appointment = createClientAppointment({
    id: "schedule-only-booking",
    dateKey: "2099-01-10",
    startTime: "15:00",
  });
  const scheduleWriteResponse = await request(tokens.mateusz, "POST", {
    action: "create_admin",
    appointment,
  });
  assert.equal(scheduleWriteResponse.status, 200, await scheduleWriteResponse.text());
  assert.equal(fixture.database.appointments[appointment.id].clientId, clientAUid);
});

test("E2E deactivation: inactive Kacper loses admin data and mutation access", async () => {
  fixture.reset();
  fixture.database.team.barbers.kacper.active = false;

  const readResponse = await request(tokens.kacper, "GET");
  const readResult = await readResponse.json();
  assert.equal(readResponse.status, 200);
  assert.equal("adminAppointments" in readResult, false);
  assert.deepEqual(readResult.clientAppointments, []);

  const mutationResponse = await request(tokens.kacper, "POST", {
    action: "cancel_admin",
    appointmentId: "kacper-upcoming",
  });
  assert.equal(mutationResponse.status, 403);

  const directoryResponse = await request(tokens.kacper, "POST", {
    action: "upsert_admin_client",
    client: { id: "inactive-write", firstName: "Brak", lastName: "Dostepu" },
  });
  assert.equal(directoryResponse.status, 403);

  const clientBooking = createClientAppointment({
    id: "inactive-barber-booking",
    barberId: "kacper",
    userId: clientAUid,
    startTime: "15:00",
  });
  const clientResponse = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment: clientBooking,
  });
  assert.equal(clientResponse.status, 409);

  const ownerResponse = await request(tokens.owner, "GET");
  const ownerResult = await ownerResponse.json();
  assert.equal(ownerResult.adminAppointments.some(({ barberId }) => barberId === "kacper"), true);
});

test("E2E role integrity: a duplicated account assignment is denied admin access", async () => {
  fixture.reset();
  fixture.database.team.barbers.kacper.userId = fixture.database.team.barbers.mateusz.userId;

  const response = await request(tokens.mateusz, "GET");
  const result = await response.json();

  assert.equal(result.context.role, "client");
  assert.equal(result.context.active, false);
  assert.equal(result.context.roleError, "conflicting_barber_assignment");
  assert.equal("adminAppointments" in result, false);
});

test("E2E client identity: calendar records expose stable IDs for directory counters", async () => {
  fixture.reset();

  const mateuszResponse = await request(tokens.mateusz, "GET");
  const kacperResponse = await request(tokens.kacper, "GET");
  const mateusz = await mateuszResponse.json();
  const kacper = await kacperResponse.json();

  assert.deepEqual(new Set(mateusz.adminAppointments.map(({ clientId }) => clientId)), new Set([clientAUid]));
  assert.deepEqual(new Set(kacper.adminAppointments.map(({ clientId }) => clientId)), new Set([clientBUid]));
});
