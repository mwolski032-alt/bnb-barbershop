import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_QUEUE_AGE_MS,
  MAX_QUEUE_LENGTH,
  applyQueuedActions,
  classifyReplayResult,
  describeDropped,
  enqueueOfflineAction,
  isQueueableAction,
  removeQueuedAction,
  sanitizeQueue,
} from "../shared/offline-queue.mjs";

const item = (overrides) => ({
  action: "attend_client",
  operationId: "op-1",
  appointmentId: "visit-1",
  expectedVersion: 1,
  queuedAt: 1_000,
  ...overrides,
});

test("only answers to a visit can wait offline; booking and moving cannot", () => {
  assert.equal(isQueueableAction("attend_client"), true);
  assert.equal(isQueueableAction("cancel_client"), true);
  for (const action of ["create_client", "reschedule_client", "confirm_client", "join_waitlist", "settle_admin"]) {
    assert.equal(isQueueableAction(action), false, action);
  }
});

test("a cancellation replaces a queued confirmation and nothing follows it", () => {
  let queue = enqueueOfflineAction([], item());
  queue = enqueueOfflineAction(queue, item({ action: "cancel_client", operationId: "op-2" }));
  assert.deepEqual(queue.map((entry) => entry.action), ["cancel_client"]);
  assert.equal(enqueueOfflineAction(queue, item({ operationId: "op-3" })), queue);
});

test("repeating an answer, or a malformed one, does not grow the queue", () => {
  const queue = enqueueOfflineAction([], item());
  assert.equal(enqueueOfflineAction(queue, item({ operationId: "op-2" })), queue);
  assert.equal(enqueueOfflineAction(queue, item({ action: "create_client" })), queue);
  assert.equal(enqueueOfflineAction(queue, item({ appointmentId: "" })), queue);
});

test("answers for different visits queue independently and the queue is capped", () => {
  const queue = enqueueOfflineAction(enqueueOfflineAction([], item()), item({ appointmentId: "visit-2", operationId: "op-2" }));
  assert.equal(queue.length, 2);
  let full = [];
  for (let index = 0; index < MAX_QUEUE_LENGTH + 5; index += 1) {
    full = enqueueOfflineAction(full, item({ appointmentId: `visit-${index}`, operationId: `op-${index}` }));
  }
  assert.equal(full.length, MAX_QUEUE_LENGTH);
});

test("stored data is checked: bad or stale items are dropped", () => {
  const now = 10 * MAX_QUEUE_AGE_MS;
  const stored = [
    item({ queuedAt: now - 1000 }),
    item({ queuedAt: now - MAX_QUEUE_AGE_MS - 1, operationId: "old" }),
    { action: "attend_client" },
    "garbage",
    null,
  ];
  assert.deepEqual(sanitizeQueue(stored, now).map((entry) => entry.operationId), ["op-1"]);
  assert.deepEqual(sanitizeQueue("not a list", now), []);
});

test("a sent answer leaves the queue", () => {
  const queue = [item(), item({ operationId: "op-2", appointmentId: "visit-2" })];
  assert.deepEqual(removeQueuedAction(queue, "op-1").map((entry) => entry.operationId), ["op-2"]);
});

test("the server's answer decides whether a queued item is sent, retried or dropped", () => {
  assert.equal(classifyReplayResult({ ok: true, status: 200 }), "sent");
  for (const status of [0, 408, 429, 500, 503]) {
    assert.equal(classifyReplayResult({ ok: false, status }), "retry", String(status));
  }
  for (const status of [400, 403, 404, 409]) {
    assert.equal(classifyReplayResult({ ok: false, status }), "dropped", String(status));
  }
  assert.equal(classifyReplayResult({ ok: false, status: undefined }), "retry");
});

test("the saved list shows queued cancellations as gone and queued confirmations as given", () => {
  const visits = [{ id: "visit-1" }, { id: "visit-2" }, { id: "visit-3", attendanceConfirmedAt: 5 }];
  const shown = applyQueuedActions(visits, [
    item({ action: "cancel_client", appointmentId: "visit-1" }),
    item({ appointmentId: "visit-2", queuedAt: 77 }),
    item({ appointmentId: "visit-3", queuedAt: 99 }),
  ]);
  assert.deepEqual(shown, [
    { id: "visit-2", attendanceConfirmedAt: 77 },
    { id: "visit-3", attendanceConfirmedAt: 5 },
  ]);
});

test("the user is told how many answers could not be sent", () => {
  assert.equal(describeDropped([]), "");
  assert.match(describeDropped([item()]), /Jedna odpowiedź/);
  assert.match(describeDropped([item(), item()]), /2 odpowiedzi/);
});
