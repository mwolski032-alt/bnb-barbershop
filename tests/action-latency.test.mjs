import assert from "node:assert/strict";
import test from "node:test";
import { installAppointmentsFixture, makeAppointmentRequest, tokens } from "./helpers/appointments-fixture.mjs";
const fixture = installAppointmentsFixture();
const { default: handler } = await import("../netlify/functions/appointments.mjs");
const cancel = (responseMode, extra = {}) => makeAppointmentRequest(handler, tokens.clientA, "POST", {
  action: "cancel_client", appointmentId: "mateusz-upcoming", responseMode, ...extra,
});

test("minimal acknowledgement removes post-commit snapshot reads without changing the committed data", async (t) => {
  const run = async mode => {
    fixture.reset();
    let committed = false;
    const reads = [];
    fixture.onRequest(({ path, method }) => {
      if (method === "PATCH") committed = true;
      if (committed && method === "GET" && !path.startsWith("systemLocks/")) reads.push(path);
    });
    const response = await cancel(mode);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(fixture.database.appointments["mateusz-upcoming"], undefined);
    assert.ok(result.notificationOperationIds.length > 0);
    return { result, reads };
  };
  const full = await run(undefined);
  const minimal = await run("minimal");
  assert.ok(full.reads.length >= 5);
  assert.deepEqual(minimal.reads, []);
  assert.equal(minimal.result.refreshRequired, true);
  assert.equal(minimal.result.clientAppointments, undefined);
  assert.equal(minimal.result.appointment.status, full.result.appointment.status);
  t.diagnostic(`Post-commit data reads before acknowledgement: full=${full.reads.length}, minimal=${minimal.reads.length}`);
});

test("failure of a later refresh cannot turn a successful minimal write into an error", async () => {
  fixture.reset();
  let committed = false;
  fixture.onRequest(({ path, method }) => {
    if (method === "PATCH") committed = true;
    if (committed && path === "team/barbers") throw new Error("simulated snapshot outage");
  });
  assert.equal((await cancel("minimal")).status, 200);
  assert.equal(fixture.database.appointments["mateusz-upcoming"], undefined);
});

test("minimal acknowledgement preserves idempotency and conflict responses", async () => {
  fixture.reset();
  const body = { operationId: "minimal-retry" };
  assert.equal((await cancel("minimal", body)).status, 200);
  const replay = await (await cancel("minimal", body)).json();
  assert.equal(replay.idempotent, true);
  assert.equal(replay.refreshRequired, true);
  assert.equal((await cancel("minimal", { operationId: "stale-minimal" })).status, 404);
});

test("quick writes do not renew a lease that still has enough time", async () => {
  fixture.reset();
  let lockWrites = 0;
  fixture.onRequest(({ path, method }) => { if (path === "systemLocks/appointments" && method === "PUT") lockWrites++; });
  assert.equal((await cancel("minimal")).status, 200);
  assert.equal(lockWrites, 2, "one acquisition and one guarded release, no unnecessary renewal");
});

test("slow work still renews a live lease before the guarded commit", async () => {
  fixture.reset();
  let lockWrites = 0;
  fixture.onRequest(({ path, method }) => {
    if (path === "team" && method === "GET") fixture.database.systemLocks.appointments.expiresAt = Date.now() + 1000;
    if (path === "systemLocks/appointments" && method === "PUT") lockWrites++;
  });
  const response = await cancel("minimal");
  assert.equal(response.status, 200);
  assert.equal(lockWrites, 3);
  assert.match(response.headers.get("Server-Timing"), /auth;dur=[\d.]+.*permissions;dur=[\d.]+.*total;dur=[\d.]+/);
});
