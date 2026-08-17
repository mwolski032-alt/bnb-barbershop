import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("FIXED IN STAGE 4: a future appointment cannot be settled", async () => {
  fixture.reset();
  const response = await request(tokens.mateusz, "POST", {
    action: "settle_admin",
    appointmentId: "mateusz-upcoming",
    amount: 50,
  });

  assert.equal(response.status, 409);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].status, "confirmed");
});

test("FIXED IN STAGE 4: completed and cancelled appointments reject later state changes", async () => {
  fixture.reset();
  fixture.database.appointments["mateusz-upcoming"].status = "completed";

  const cancelCompleted = await request(tokens.mateusz, "POST", {
    action: "cancel_admin",
    appointmentId: "mateusz-upcoming",
  });
  assert.equal(cancelCompleted.status, 409);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].status, "completed");

  fixture.reset();
  fixture.database.appointments["mateusz-upcoming"].status = "cancelled";
  const rescheduleCancelled = await request(tokens.mateusz, "POST", {
    action: "reschedule_admin",
    appointmentId: "mateusz-upcoming",
    dateKey: "2099-01-10",
    startTime: "16:00",
  });
  assert.equal(rescheduleCancelled.status, 409);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].status, "cancelled");
});

test("FIXED IN STAGE 3: disabling schedule access blocks appointment mutations in the backend", async () => {
  fixture.reset();
  fixture.database.team.barbers.mateusz.access.schedule = false;

  const response = await request(tokens.mateusz, "POST", {
    action: "cancel_admin",
    appointmentId: "mateusz-upcoming",
  });

  assert.equal(response.status, 403);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].status, "confirmed");
});

test("FIXED IN STAGE 4: client booking rolls back when the atomic root write fails", async () => {
  fixture.reset();
  fixture.failPut("");
  const appointment = createClientAppointment({ id: "partial-client-booking", startTime: "12:00" });

  const response = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
    client: { firstName: "Klient", lastName: "A", phone: "500600700" },
  });

  assert.equal(response.status, 500);
  assert.equal(fixture.database.appointments[appointment.id], undefined);
});

test("FIXED IN STAGE 4: a signed-in client is merged with a manual card sharing the same email", async () => {
  fixture.reset();
  fixture.database.clients["manual-client"] = {
    id: "manual-client",
    firstName: "Klient",
    lastName: "A",
    email: "client-a@example.com",
    phone: "500600700",
    barberIds: { mateusz: true },
  };
  const appointment = createClientAppointment({ id: "duplicate-client-booking", startTime: "12:00" });

  const response = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
    client: { firstName: "Klient", lastName: "A", phone: "500600700" },
  });
  assert.equal(response.status, 200, await response.text());

  const matchingRecords = Object.values(fixture.database.clients).filter(
    (client) => client.email === "client-a@example.com",
  );
  assert.equal(matchingRecords.length, 1);
});

test("FIXED: authenticated family members sharing a phone can book independently", async () => {
  fixture.reset();
  fixture.database.clients[clientBUid].phone = "500600700";
  const appointment = createClientAppointment({
    id: "shared-family-phone-booking",
    startTime: "12:00",
  });

  const response = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
    client: { firstName: "Klient", lastName: "A", phone: "500600700" },
  });

  assert.equal(response.status, 200, await response.text());
  assert.equal(fixture.database.appointments[appointment.id].userId, clientAUid);
  assert.equal(fixture.database.clients[clientAUid].userId, clientAUid);
  assert.equal(fixture.database.clients[clientBUid].userId, clientBUid);
});

test("FIXED IN STAGE 4: successful appointment mutation creates a durable notification job", async () => {
  fixture.reset();
  const appointment = createClientAppointment({ id: "notification-outbox-booking", startTime: "12:00" });
  const operationId = "notification-outbox-operation";

  const response = await request(tokens.clientA, "POST", {
    action: "create_client",
    appointment,
    operationId,
  });
  assert.equal(response.status, 200, await response.text());
  assert.equal(fixture.database.notificationOutbox?.[operationId]?.event, "new_booking");
});

test("FIXED IN STAGE 5: every mutation applies the synchronized API snapshot", async () => {
  const source = await readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8");
  const reschedule = source.slice(
    source.indexOf("const saveAdminAppointmentEdit = async"),
    source.indexOf("const moveAdminAppointment = async"),
  );
  const cancellation = source.slice(
    source.indexOf("const declineAdminAppointment = async"),
    source.indexOf("const footerLabel"),
  );
  const settlement = source.slice(
    source.indexOf("const settleAdminAppointment = async"),
    source.indexOf("const selectSmsTemplate"),
  );

  assert.match(reschedule, /runAppointmentOperation/);
  assert.match(cancellation, /runAppointmentOperation/);
  assert.match(settlement, /runAppointmentOperation/);
  assert.doesNotMatch(source, /applyAdminAppointmentToState/);
});

test("FIXED IN STAGE 4: manual client and appointment creation use one backend operation", async () => {
  const source = await readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8");
  const workflow = source.slice(
    source.indexOf("const handleSaveClientFromDialog = async"),
    source.indexOf("const removeClientFromDirectory = async"),
  );

  assert.doesNotMatch(workflow, /await update\(ref\(realtimeDb\), updates\)/);
  assert.doesNotMatch(workflow, /mutateAppointment<AdminAppointment>\("create_admin"/);
  assert.match(workflow, /runAppointmentOperation\([\s\S]*"upsert_admin_client"[\s\S]*appointment:/);
});
