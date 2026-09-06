import assert from "node:assert/strict";
import test from "node:test";
import {
  clientAUid, clientBUid, createClientAppointment, installAppointmentsFixture,
  makeAppointmentRequest, tokens,
} from "./helpers/appointments-fixture.mjs";

const fixture = installAppointmentsFixture();
const { default: handler } = await import("../netlify/functions/appointments.mjs");
const request = (token, method, body) => makeAppointmentRequest(handler, token, method, body);
const seed = () => {
  fixture.reset();
  fixture.database.clients.manual = {
    id: "manual", firstName: "Jan", lastName: "Ręczny", email: "", phone: "500600700",
    barberIds: { mateusz: true }, createdAt: 1,
  };
  for (const [id, price] of [["manual-paid", 20], ["manual-free", 0]]) {
    fixture.database.appointments[id] = {
      ...createClientAppointment({ id }), clientId: "manual", userId: "",
      clientName: "Jan Ręczny", clientEmail: "", dateKey: "2026-08-01", status: "completed",
      price: `${price} zł`, priceAmount: price, version: 1,
      settlement: { barberId: "mateusz", settledAt: 1, amount: price },
    };
  }
};
const previewResponse = (token = tokens.mateusz, source = "manual", target = clientAUid) => handler(new Request(
  `https://bnb.example/.netlify/functions/appointments?${new URLSearchParams({ mergeSourceId: source, mergeTargetId: target })}`,
  { headers: { Authorization: `Bearer ${token}` } },
));
const preview = async (token = tokens.mateusz, source = "manual", target = clientAUid) => {
  const response = await previewResponse(token, source, target);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.mergePreview;
};
const submit = (value, fields = {}, token = tokens.mateusz) => request(token, "POST", {
  action: "merge_admin_clients", expectedVersion: 0, confirmed: true,
  sourceClientId: value.source.id, targetClientId: value.target.id, previewToken: value.token,
  ...fields,
});

test("approved merge moves exact history, preserves zero and paid settlements, and stores a private recovery log", async () => {
  seed();
  fixture.database.clients.unselected = { ...fixture.database.clients.manual, id: "unselected" };
  const original = structuredClone(fixture.database.appointments["manual-paid"]);
  const value = await preview();
  assert.equal(value.appointmentCount, 2);
  assert.equal(value.samePhone, true);
  assert.ok(fixture.database.clients.manual, "preview must not merge anything");
  const response = await submit(value, { operationId: "approved-merge" });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.notificationQueued, false);
  assert.equal(result.clientMergeAudit, undefined);
  assert.equal(fixture.database.clients.manual, undefined);
  assert.ok(fixture.database.clients.unselected, "only the selected source may be removed");
  for (const [id, amount] of [["manual-paid", 20], ["manual-free", 0]]) {
    const record = fixture.database.appointments[id];
    assert.equal(record.clientId, clientAUid);
    assert.equal(record.userId, clientAUid);
    assert.equal(record.clientEmail, "client-a@example.com");
    assert.equal(record.version, 2);
    assert.equal(record.settlement.amount, amount);
    assert.equal(record.priceAmount, amount);
    assert.equal(record.status, "completed");
  }
  const audit = fixture.database.appointmentOperations["approved-merge"].clientMergeAudit;
  assert.deepEqual(audit.appointmentsBefore["manual-paid"], original);
  assert.equal(audit.source.id, "manual");
  const history = await (await request(tokens.clientA, "GET")).json();
  assert.equal(history.clientAppointments.filter(a => a.id.startsWith("manual-")).length, 2);
  const foreignHistory = await (await request(tokens.clientB, "GET")).json();
  assert.equal(foreignHistory.clientAppointments.some(a => a.id.startsWith("manual-")), false);
});

test("merge requires preview and explicit confirmation", async () => {
  seed();
  const value = await preview();
  assert.equal((await submit(value, { confirmed: false })).status, 400);
  assert.equal((await submit(value, { previewToken: "" })).status, 409);
  assert.ok(fixture.database.clients.manual);
});

test("stale previews reject changes to identity or newly added history", async () => {
  for (const change of [
    () => { fixture.database.clients[clientAUid].email = "changed@example.com"; },
    () => { fixture.database.appointments["new-manual"] = { ...fixture.database.appointments["manual-paid"], id: "new-manual" }; },
    () => { fixture.database.appointments["manual-paid"].settlement.amount = 55; },
  ]) {
    seed();
    const value = await preview();
    change();
    assert.equal((await submit(value)).status, 409);
    assert.ok(fixture.database.clients.manual);
  }
});

test("client, foreign barber and barber without schedule permission cannot preview or approve a merge", async () => {
  seed();
  const value = await preview();
  for (const token of [tokens.clientA, tokens.kacper]) {
    assert.equal((await previewResponse(token)).status, 403);
    assert.equal((await submit(value, {}, token)).status, 403);
  }
  fixture.database.team.barbers.mateusz.access.schedule = false;
  assert.equal((await previewResponse()).status, 403);
  assert.equal((await submit(value)).status, 403);
  assert.ok(fixture.database.clients.manual);
});

test("only owner may merge a manual card whose history spans multiple barbers", async () => {
  seed();
  fixture.database.clients.manual.barberIds.kacper = true;
  fixture.database.appointments["manual-free"].barberId = "kacper";
  assert.equal((await previewResponse()).status, 403);
  const value = await preview(tokens.owner);
  assert.equal((await submit(value, {}, tokens.owner)).status, 200);
  assert.equal(fixture.database.clients[clientAUid].barberIds.kacper, true);
  assert.equal(fixture.database.appointments["manual-free"].barberId, "kacper");
});

test("two authenticated accounts cannot be combined and a manual card cannot be the target", async () => {
  seed();
  assert.equal((await previewResponse(tokens.owner, clientAUid, clientBUid)).status, 409);
  fixture.database.clients.otherManual = { ...fixture.database.clients.manual, id: "otherManual" };
  assert.equal((await previewResponse(tokens.owner, "manual", "otherManual")).status, 409);
  fixture.database.appointments["manual-paid"].userId = clientBUid;
  assert.equal((await previewResponse(tokens.owner)).status, 409);
});

test("different phones require deliberate selection but do not prevent an approved merge", async () => {
  seed();
  fixture.database.clients.manual.phone = "511222333";
  const value = await preview();
  assert.equal(value.samePhone, false);
  assert.equal((await submit(value)).status, 200);
  assert.equal(fixture.database.clients[clientAUid].phone, "500600700");
});

test("retrying a committed merge is idempotent, but cannot target a different pair", async () => {
  seed();
  const value = await preview();
  const first = await submit(value, { operationId: "retry-merge" });
  assert.equal(first.status, 200);
  const second = await submit(value, { operationId: "retry-merge" });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
  assert.equal(fixture.database.appointments["manual-paid"].version, 2);
  assert.equal((await submit(value, { operationId: "retry-merge", targetClientId: clientBUid })).status, 409);
});

test("failed atomic save keeps both client cards and original history", async () => {
  seed();
  const value = await preview();
  const clients = structuredClone(fixture.database.clients);
  const appointments = structuredClone(fixture.database.appointments);
  fixture.failPatch("");
  assert.equal((await submit(value)).status, 500);
  assert.deepEqual(fixture.database.clients, clients);
  assert.deepEqual(fixture.database.appointments, appointments);
});

test("profile editing cannot bypass approval by setting userId or attaching another card's visits", async () => {
  seed();
  assert.equal((await request(tokens.mateusz, "POST", {
    action: "upsert_admin_client", barberId: "mateusz",
    client: { ...fixture.database.clients.manual, userId: clientAUid },
  })).status, 403);
  assert.equal((await request(tokens.mateusz, "POST", {
    action: "upsert_admin_client", barberId: "mateusz",
    client: fixture.database.clients[clientAUid], appointmentIds: ["manual-paid"],
  })).status, 403);
  assert.equal(fixture.database.appointments["manual-paid"].clientId, "manual");
});

test("a manual waitlist relation follows only its approved target", async () => {
  seed();
  fixture.database.waitlistEntries = { manualWait: {
    id: "manualWait", clientId: "manual", userId: "", barberId: "mateusz", version: 1,
    status: "waiting", dateFrom: "2099-01-10", dateTo: "2099-01-11",
  } };
  const value = await preview();
  assert.equal(value.waitlistCount, 1);
  assert.equal((await submit(value)).status, 200);
  assert.equal(fixture.database.waitlistEntries.manualWait.userId, clientAUid);
  assert.equal(fixture.database.waitlistEntries.manualWait.version, 2);
});

test("unverified e-mail cannot take over a manual card through booking", async () => {
  seed();
  fixture.database.clients.manual.email = "unverified@example.com";
  const response = await request(tokens.unverifiedClient, "POST", {
    action: "create_client",
    appointment: { ...createClientAppointment({id: "unverified-booking"}), userId: "unverified-client-uid" },
  });
  assert.equal(response.status, 200, await response.text());
  const history = await (await request(tokens.unverifiedClient, "GET")).json();
  assert.equal(history.clientAppointments.some(a => a.id === "manual-paid"), false);
  assert.ok(fixture.database.clients.manual);
});
