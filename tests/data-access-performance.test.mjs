import assert from "node:assert/strict";
import test from "node:test";
import { installAppointmentsFixture, makeAppointmentRequest, tokens, createClientAppointment, clientAUid, ownerUid } from "./helpers/appointments-fixture.mjs";
const fixture = installAppointmentsFixture();
const { default: handler } = await import("../netlify/functions/appointments.mjs");
const request = (token, body) => makeAppointmentRequest(handler, token, body ? "POST" : "GET", body);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const edit = (barber, amount = 20) => request(tokens[barber], { action: "update_admin", appointmentId: `${barber}-upcoming`, dateKey: "2099-01-10", startTime: barber === "mateusz" ? "09:00" : "10:00", priceAmount: amount });

test("refresh is read-only and deduplicates identical barber queries", async () => {
  fixture.reset();
  const calls = [];
  fixture.onRequest(({ path, method, searchParams }) => calls.push({ path, method, query: searchParams.toString() }));
  const result = await request(tokens.mateusz);
  assert.equal(result.status, 200, await result.text());
  assert.equal(calls.some(c => c.method !== "GET"), false);
  assert.equal(calls.some(c => c.path.startsWith("systemLocks") || c.query.includes("clientEmail")), false);
  for (const path of ["appointments", "waitlistEntries"]) {
    const barberReads = calls.filter(c => c.path === path && c.query.includes("barberId"));
    assert.equal(barberReads.length, 1);
  }
  assert.ok(calls.length <= 12, `refresh used ${calls.length} reads`);
});

test("standard booking does not read whole appointment, client, operation or outbox collections", async () => {
  fixture.reset();
  for (let i = 0; i < 2000; i++) {
    fixture.database.appointments[`unrelated-${i}`] = { ...fixture.database.appointments["kacper-upcoming"], id: `unrelated-${i}` };
  }
  const calls = [];
  fixture.onRequest(({ path, method, searchParams }) => calls.push({ path, method, query: searchParams.toString() }));
  const result = await request(tokens.clientA, { action: "create_client", appointment: createClientAppointment({ id: "bounded-booking" }) });
  assert.equal(result.status, 200, await result.text());
  const forbidden = calls.filter(c => c.method === "GET" && ["appointments", "clients", "appointmentOperations", "notificationOutbox"].includes(c.path) && !c.query);
  assert.deepEqual(forbidden, []);
  assert.equal(Object.keys(fixture.database.appointments).length, 2004);
});

test("editing one barber's price does not wait for another barber's in-flight edit", async () => {
  fixture.reset();
  fixture.database.systemLocks = { appointments: { epoch: 1 } };
  const reached = deferred(), resume = deferred();
  let paused = false;
  fixture.onRequest(async ({ method, searchParams }) => {
    const auth = JSON.parse(searchParams.get("auth_variable_override") ?? "null");
    if (method === "PATCH" && !paused && auth?.token?.lockScope === "barber_mateusz") {
      paused = true; reached.resolve(); await resume.promise;
    }
  });
  const first = edit("mateusz");
  await reached.promise;
  try { assert.equal((await edit("kacper")).status, 200); }
  finally { resume.resolve(); }
  assert.equal((await first).status, 200);
  assert.equal(fixture.database.appointments["mateusz-upcoming"].priceAmount, 20);
  assert.equal(fixture.database.appointments["kacper-upcoming"].priceAmount, 20);
  assert.equal(fixture.database.appointmentSync.users[ownerUid].revision, 3, "concurrent signals must not overwrite each other");
});

test("a global booking invalidates an older isolated move even after the global lock is released", async () => {
  fixture.reset();
  fixture.database.systemLocks = { appointments: { epoch: 1 } };
  const reached = deferred(), resume = deferred();
  let paused = false;
  fixture.onRequest(async ({ method, searchParams }) => {
    if (method !== "PATCH" || paused) return;
    const auth = JSON.parse(searchParams.get("auth_variable_override") ?? "null");
    if (auth?.token?.lockScope === "barber_mateusz") { paused = true; reached.resolve(); await resume.promise; }
  });
  const move = request(tokens.clientA, { action: "reschedule_client", appointmentId: "mateusz-upcoming", dateKey: "2099-01-10", startTime: "12:00" });
  await reached.promise;
  try {
    const booked = await request(tokens.clientA, { action: "create_client", appointment: createClientAppointment({ id: "epoch-winner" }) });
    assert.equal(booked.status, 200, await booked.text());
  } finally { resume.resolve(); }
  const rejected = await move;
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, "write_lease_expired");
  assert.equal(fixture.database.appointments["mateusz-upcoming"].startTime, "09:00");
  assert.equal(fixture.database.appointments["epoch-winner"].startTime, "12:00");
});

test("a failed isolated write cannot roll back a completed global cancellation", async () => {
  fixture.reset();
  fixture.database.systemLocks = { appointments: { epoch: 1 } };
  const reached = deferred(), resume = deferred();
  let paused = false;
  fixture.onRequest(async ({ method }) => { if (method === "PATCH" && !paused) { paused = true; reached.resolve(); await resume.promise; } });
  const first = edit("mateusz");
  await reached.promise;
  try {
    const cancelled = await request(tokens.clientA, { action: "cancel_client", appointmentId: "mateusz-upcoming" });
    assert.equal(cancelled.status, 200, await cancelled.text());
  } finally { resume.resolve(); }
  assert.equal((await first).status, 409);
  assert.equal(fixture.database.appointments["mateusz-upcoming"], undefined);
});

test("cancelling one barber's visit preserves a shared client's other barber history", async () => {
  fixture.reset();
  fixture.database.appointments["other-history"] = { ...fixture.database.appointments["kacper-upcoming"],
    id: "other-history", userId: clientAUid, clientId: clientAUid };
  const result = await request(tokens.clientA, { action: "cancel_client", appointmentId: "mateusz-upcoming" });
  assert.equal(result.status, 200, await result.text());
  assert.ok(fixture.database.clients[clientAUid]);
  assert.ok(fixture.database.appointments["other-history"]);
});

test("idempotent replay returns a complete fresh scoped calendar, not the partial write dataset", async () => {
  fixture.reset();
  const body = { action: "create_client", appointment: createClientAppointment({ id: "replayed" }), operationId: "repeat-id" };
  assert.equal((await request(tokens.clientA, body)).status, 200);
  const response = await request(tokens.clientA, body);
  const data = await response.json();
  assert.equal(data.clientAppointments.length, 2);
  assert.equal(data.sync.uid, clientAUid);
  assert.equal(data.sync.barberId, "mateusz");
});
