import assert from "node:assert/strict";
import test from "node:test";
import { clientAUid, clientBUid, createClientAppointment, installAppointmentsFixture,
  makeAppointmentRequest, tokens } from "./helpers/appointments-fixture.mjs";

const fixture = installAppointmentsFixture();
const { default: handler } = await import("../netlify/functions/appointments.mjs");
const request = (token, body) => makeAppointmentRequest(handler, token, "POST", body);
const book = (id, userId = clientAUid, startTime = "12:00", extra = {}) => request(
  userId === clientAUid ? tokens.clientA : tokens.clientB,
  { action: "create_client", appointment: createClientAppointment({ id, userId, startTime }), ...extra },
);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("a barber and a client racing for the same slot cannot both create a visit", async () => {
  fixture.reset();
  const results = await Promise.all([
    request(tokens.mateusz, { action: "create_admin", appointment: createClientAppointment({ id: "barber-race" }) }),
    book("client-race", clientBUid),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});

test("simultaneous clients cannot book overlapping times for one barber", async () => {
  fixture.reset();
  const results = await Promise.all([book("race-a"), book("race-b", clientBUid, "12:30")]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(Object.keys(fixture.database.appointments).filter(id => id.startsWith("race-")).length, 1);
});

test("an in-flight patch arriving after lease takeover cannot overwrite the winning booking", async () => {
  fixture.reset();
  const reached = deferred();
  const resume = deferred();
  let paused = false;
  fixture.onRequest(async ({ method, path, searchParams }) => {
    if (method !== "PATCH" || path !== "" || paused) return;
    paused = true;
    assert.ok(searchParams.has("auth_variable_override"), "commit must be fenced by database rules");
    reached.resolve();
    await resume.promise;
  });
  const slow = book("slow-booking", clientAUid, "12:00", { operationId: "slow-operation" });
  await reached.promise;
  fixture.database.systemLocks.appointments.expiresAt = Date.now() - 1;
  try {
    const winner = await book("winning-booking", clientBUid);
    assert.equal(winner.status, 200, await winner.text());
  } finally { resume.resolve(); }
  const rejected = await slow;
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json()).code, "write_lease_expired");
  assert.equal(fixture.database.appointments["slow-booking"], undefined);
  assert.equal(fixture.database.appointmentOperations["slow-operation"], undefined);
  assert.equal(fixture.database.notificationOutbox["slow-operation"], undefined);
  assert.ok(fixture.database.appointments["winning-booking"]);
  assert.equal(fixture.database.clients[clientBUid].barberIds.mateusz, true);
});

test("lease expiry at commit rejects the whole write even without another booking", async () => {
  fixture.reset();
  fixture.onRequest(({ method, path }) => {
    if (method === "PATCH" && path === "") fixture.database.systemLocks.appointments.expiresAt = Date.now() - 1;
  });
  const response = await book("expired-write");
  assert.equal(response.status, 409);
  assert.equal(fixture.database.appointments["expired-write"], undefined);
  assert.equal(fixture.database.appointmentOperations, undefined);
  assert.equal(fixture.database.notificationOutbox, undefined);
});

test("an expired owner cannot release the lease held by the next request", async () => {
  fixture.reset();
  const oldReached = deferred();
  const newReached = deferred();
  const resumeOld = deferred();
  const resumeNew = deferred();
  let patchNumber = 0;
  fixture.onRequest(async ({ method }) => {
    if (method !== "PATCH") return;
    if (++patchNumber === 1) { oldReached.resolve(); await resumeOld.promise; }
    else { newReached.resolve(); await resumeNew.promise; }
  });
  const oldRequest = book("old-owner");
  await oldReached.promise;
  fixture.database.systemLocks.appointments.expiresAt = Date.now() - 1;
  const newRequest = book("new-owner", clientBUid);
  await newReached.promise;
  const liveOwner = fixture.database.systemLocks.appointments.owner;
  try {
    resumeOld.resolve();
    assert.equal((await oldRequest).status, 409);
    assert.equal(fixture.database.systemLocks.appointments.owner, liveOwner);
  } finally { resumeNew.resolve(); }
  assert.equal((await newRequest).status, 200);
});

test("an abandoned expired lease does not permanently block reservations", async () => {
  fixture.reset();
  fixture.database.systemLocks = { appointments: { owner: "interrupted-process", expiresAt: Date.now() - 1 } };
  assert.equal((await book("after-interruption")).status, 200);
});

test("a request that expires while calculating cannot renew or submit its stale snapshot", async () => {
  fixture.reset();
  let commits = 0;
  fixture.onRequest(({ method, path }) => {
    if (method === "GET" && path === "team") {
      fixture.database.systemLocks.appointments.expiresAt = Date.now() - 1;
    }
    if (method === "PATCH") commits++;
  });
  const response = await book("expired-calculation");
  assert.equal(response.status, 409);
  assert.equal(commits, 0);
  assert.equal(fixture.database.appointments["expired-calculation"], undefined);
});

test("retry after a committed write loses its response returns the same booking and notification", async () => {
  fixture.reset();
  const originalFetch = globalThis.fetch;
  let loseResponse = true;
  globalThis.fetch = async (url, options) => {
    const response = await originalFetch(url, options);
    if (options?.method === "PATCH" && loseResponse && response.ok) {
      loseResponse = false;
      throw new Error("Simulated connection loss after commit");
    }
    return response;
  };
  try {
    const body = { operationId: "retry-operation" };
    assert.equal((await book("retry-booking", clientAUid, "12:00", body)).status, 500);
    const repeated = await book("retry-booking", clientAUid, "12:00", body);
    assert.equal(repeated.status, 200, await repeated.text());
    assert.equal(Object.keys(fixture.database.appointments).filter(id => id === "retry-booking").length, 1);
    assert.deepEqual(Object.keys(fixture.database.notificationOutbox), ["retry-operation"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("rescheduling cannot move into a slot concurrently booked by another client", async () => {
  fixture.reset();
  const results = await Promise.all([
    request(tokens.clientA, { action: "reschedule_client", appointmentId: "mateusz-upcoming", dateKey: "2099-01-10", startTime: "12:00" }),
    book("competing-booking", clientBUid),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(Object.values(fixture.database.appointments).filter(a => a.barberId === "mateusz" && a.startTime === "12:00").length, 1);
});

test("adjacent visits and the same time at different barbers remain bookable", async () => {
  fixture.reset();
  assert.equal((await book("adjacent", clientAUid, "10:00")).status, 200);
  const response = await request(tokens.clientA, { action: "create_client",
    appointment: createClientAppointment({ id: "other-barber", barberId: "kacper", startTime: "09:00" }) });
  assert.equal(response.status, 200, await response.text());
});

for (const amount of [0, 20, 35.5]) {
  for (const action of ["reschedule_client", "reschedule_admin", "update_admin"]) {
    test(`${action} keeps the agreed ${amount} PLN, discount metadata and notification price`, async () => {
      fixture.reset();
      const current = fixture.database.appointments["mateusz-upcoming"];
      Object.assign(current, { price: `${amount} zł`, priceAmount: amount, originalPriceAmount: 50,
        priceAdjustedAt: 12345, priceAdjustedBy: "admin" });
      fixture.database.barbers.mateusz.services.cut.price = "90 zł";
      const response = await request(action === "reschedule_client" ? tokens.clientA : tokens.mateusz, {
        action, appointmentId: current.id, dateKey: current.dateKey, startTime: "13:00", priceAmount: amount,
        operationId: "price-preserved",
      });
      assert.equal(response.status, 200, await response.text());
      const saved = fixture.database.appointments[current.id];
      for (const field of ["price", "priceAmount", "originalPriceAmount", "priceAdjustedAt", "priceAdjustedBy"]) {
        assert.equal(saved[field], current[field], field);
      }
      assert.equal(saved.startTime, "13:00");
      const job = fixture.database.notificationOutbox["price-preserved"];
      const operation = fixture.database.appointmentOperations[job.operationId];
      assert.equal((operation.notificationPayload ?? operation.appointment).priceAmount, amount);
    });
  }
}

test("a client cannot inject a free price when rescheduling, while new bookings use the current tariff", async () => {
  fixture.reset();
  const response = await request(tokens.clientA, { action: "reschedule_client", appointmentId: "mateusz-upcoming",
    dateKey: "2099-01-10", startTime: "13:00", priceAmount: 0, price: "0 zł" });
  assert.equal(response.status, 200, await response.text());
  assert.equal(fixture.database.appointments["mateusz-upcoming"].price, "50 zl");
  fixture.database.barbers.mateusz.services.cut.price = "90 zł";
  const created = await request(tokens.clientA, { action: "create_client", appointment: {
    ...createClientAppointment({ id: "tampered-price", startTime: "15:00" }),
    priceAmount: 0, price: "0 zł", originalPriceAmount: 100, priceAdjustedBy: "admin",
  } });
  assert.equal(created.status, 200, await created.text());
  const saved = fixture.database.appointments["tampered-price"];
  assert.equal(saved.priceAmount, 90);
  assert.equal(saved.originalPriceAmount, undefined);
  assert.equal(saved.priceAdjustedBy, undefined);
});

for (const amount of [0, 20]) {
  test(`discount ${amount} PLN survives rescheduling, confirmation and final settlement`, async () => {
    fixture.reset();
    const id = "mateusz-upcoming";
    const edited = await request(tokens.mateusz, { action: "update_admin", appointmentId: id,
      dateKey: "2099-01-10", startTime: "09:00", priceAmount: amount });
    assert.equal(edited.status, 200, await edited.text());
    const moved = await request(tokens.clientA, { action: "reschedule_client", appointmentId: id,
      dateKey: "2099-01-10", startTime: "12:00", expectedVersion: 2 });
    assert.equal(moved.status, 200, await moved.text());
    const confirmed = await request(tokens.mateusz, { action: "confirm_admin", appointmentId: id, expectedVersion: 3 });
    assert.equal(confirmed.status, 200, await confirmed.text());
    // Move the test clock past the visit so settlement is a real API operation.
    const savedNow = Date.now;
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ["2099-01-11T12:00:00Z"])); }
      static now() { return new RealDate("2099-01-11T12:00:00Z").getTime(); }
    };
    try {
      const settled = await request(tokens.mateusz, { action: "settle_admin", appointmentId: id, expectedVersion: 4, amount: 999 });
      assert.equal(settled.status, 200, await settled.text());
      assert.equal(fixture.database.appointments[id].settlement.amount, amount);
    } finally { globalThis.Date = RealDate; Date.now = savedNow; }
  });
}

test("rejected move preserves the original slot, zero price and discount metadata", async () => {
  fixture.reset();
  Object.assign(fixture.database.appointments["mateusz-upcoming"], { price: "0 zł", priceAmount: 0, originalPriceAmount: 50 });
  assert.equal((await book("occupied-destination", clientBUid)).status, 200);
  const before = structuredClone(fixture.database.appointments["mateusz-upcoming"]);
  const response = await request(tokens.clientA, { action: "reschedule_client", appointmentId: before.id,
    dateKey: before.dateKey, startTime: "12:00" });
  assert.equal(response.status, 409);
  assert.deepEqual(fixture.database.appointments[before.id], before);
});
