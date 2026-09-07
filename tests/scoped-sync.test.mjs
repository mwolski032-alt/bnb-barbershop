import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotGate, createScopedRefreshQueue } from "../shared/scoped-sync.mjs";

const sync = (barberId, userRevision, barberRevision, uid = "client") => ({ uid, barberId, userRevision, barberRevision });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("initial realtime signals already covered by the snapshot do not cause a second read", async () => {
  const gate = createSnapshotGate(), queue = createScopedRefreshQueue(), reached = deferred(), resume = deferred();
  const token = gate.activate("client", "mateusz");
  let reads = 0;
  const load = async () => { reads++; reached.resolve(); await resume.promise; gate.accept(sync("mateusz", 4, 8), token); return 1; };
  const first = queue.run("scope", load);
  await reached.promise;
  queue.run("scope", load, () => gate.needsRefresh("user", 4));
  queue.run("scope", load, () => gate.needsRefresh("barber", 8));
  resume.resolve();
  await first;
  assert.equal(reads, 1);
});

test("a newer signal during loading still causes a trailing read", async () => {
  const gate = createSnapshotGate(), queue = createScopedRefreshQueue(), reached = deferred(), resume = deferred();
  const token = gate.activate("client", "mateusz");
  let reads = 0;
  const load = async () => { reads++; reached.resolve(); await resume.promise; gate.accept(sync("mateusz", 4, reads === 1 ? 8 : 9), token); return reads; };
  const first = queue.run("scope", load);
  await reached.promise;
  queue.run("scope", load, () => gate.needsRefresh("barber", 9));
  resume.resolve();
  await first;
  assert.equal(reads, 2);
});

test("switching barber accepts lower unrelated revision and rejects the old response", () => {
  const gate = createSnapshotGate();
  const first = gate.activate("client", "mateusz");
  assert.equal(gate.accept(sync("mateusz", 3, 900), first), true);
  const second = gate.activate("client", "kacper");
  assert.equal(gate.accept(sync("kacper", 3, 2), second), true);
  assert.equal(gate.accept(sync("mateusz", 3, 901), first), false);
  assert.equal(gate.needsRefresh("barber", 3), true);
});

test("private and barber signals are independent, not collapsed into their maximum", () => {
  const gate = createSnapshotGate();
  const token = gate.activate("client", "mateusz");
  assert.equal(gate.accept(sync("mateusz", 1000, 2), token), true);
  assert.equal(gate.needsRefresh("barber", 3), true);
  assert.equal(gate.accept(sync("mateusz", 999, 3), token), false);
  assert.equal(gate.accept(sync("mateusz", 1000, 3), token), true);
});

test("rapid A-B-A switching and logout reject data from earlier generations", () => {
  const gate = createSnapshotGate();
  const old = gate.activate("client", "mateusz");
  gate.activate("client", "kacper");
  const current = gate.activate("client", "mateusz");
  assert.equal(gate.accept(sync("mateusz", 9, 9), old), false);
  assert.equal(gate.accept(sync("mateusz", 1, 1), current), true);
  gate.activate("", "");
  assert.equal(gate.accept(sync("mateusz", 10, 10), current), false);
  const other = gate.activate("other-client", "mateusz");
  assert.equal(gate.accept(sync("mateusz", 10, 10), other), false);
});

test("one barber's in-flight request does not block loading another barber", async () => {
  const queue = createScopedRefreshQueue();
  const slow = deferred();
  const first = queue.run("mateusz", () => slow.promise);
  assert.equal(await queue.run("kacper", () => "kacper-data"), "kacper-data");
  slow.resolve("mateusz-data");
  assert.equal(await first, "mateusz-data");
});

test("duplicate reads are coalesced, but a signal during the fetch queues one fresh read", async () => {
  const queue = createScopedRefreshQueue();
  const slow = deferred();
  let reads = 0;
  const load = () => ++reads === 1 ? slow.promise : "fresh";
  const first = queue.run("client:barber", load);
  await Promise.resolve();
  assert.equal(queue.run("client:barber", load), first);
  assert.equal(queue.run("client:barber", load, true), first);
  queue.run("client:barber", load, true);
  slow.resolve("stale");
  assert.equal(await first, "fresh");
  assert.equal(reads, 2);
});

test("a failed read releases its queue slot so retry can succeed", async () => {
  const queue = createScopedRefreshQueue();
  await assert.rejects(queue.run("key", () => { throw new Error("offline"); }));
  assert.equal(await queue.run("key", () => "online"), "online");
});
