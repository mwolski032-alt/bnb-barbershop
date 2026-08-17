import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rules = JSON.parse(
  await readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
).rules;

test("barber appointment reads are scoped instead of granting root collection access", () => {
  assert.match(rules.appointments[".read"], /team\/owner\/userId/);
  assert.doesNotMatch(rules.appointments[".read"], /team\/barbers/);
});

test("changing barberId cannot grant write access to an existing foreign appointment", () => {
  const writeRule = rules.appointments.$appointmentId[".write"];

  assert.match(writeRule, /data\.child\('barberId'\)/);
  assert.match(writeRule, /newData\.child\('barberId'\)/);
});

test("client directory rules do not grant every active barber collection-wide access", () => {
  assert.equal(rules.clients[".read"], false);
  assert.equal(rules.clients.$clientId?.[".read"], undefined);
});

test("team account assignments are private to the owner and assigned active barber", () => {
  assert.match(rules.team.barbers[".read"], /team\/owner\/userId/);
  assert.match(rules.team.barbers.$barberId[".read"], /data\.child\('userId'\)/);
  assert.match(rules.team.barbers.$barberId[".read"], /data\.child\('active'\)/);
});

test("legacy shared services and work settings no longer have access rules", () => {
  assert.equal(rules.services, undefined);
  assert.equal(rules.workSettings, undefined);
  assert.match(rules.barbers.$barberId.services[".write"], /team\/barbers/);
  assert.match(rules.barbers.$barberId.workSettings[".write"], /team\/barbers/);
});
