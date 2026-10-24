import assert from "node:assert/strict";
import test from "node:test";

import { orderTeamEntries } from "../shared/team-order.mjs";

test("the founder is first, then barbers in the order they joined, not alphabetically", () => {
  const entries = [
    ["anna", { createdAt: 300 }],
    ["kasper", { createdAt: 200 }],
    ["mateusz", {}],
    ["zbyszek", { invitedAt: 250 }],
  ];
  assert.deepEqual(orderTeamEntries(entries).map(([id]) => id), ["mateusz", "kasper", "zbyszek", "anna"]);
});

test("barbers without a join date keep a stable order and the input is not changed", () => {
  const entries = [["b", {}], ["a", {}], ["mateusz", {}]];
  assert.deepEqual(orderTeamEntries(entries).map(([id]) => id), ["mateusz", "a", "b"]);
  assert.deepEqual(entries.map(([id]) => id), ["b", "a", "mateusz"]);
});
