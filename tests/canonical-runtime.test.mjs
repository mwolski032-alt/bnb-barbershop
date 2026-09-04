import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime reads services and availability only from barber-scoped paths", async () => {
  const [frontend, backend, rules] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../database.rules.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.doesNotMatch(frontend, /ref\(realtimeDb, "(?:services|workSettings)"\)/);
  assert.doesNotMatch(frontend, /shouldRunDataMigration|migrationUpdates|legacyServices|legacyWorkSettings/);
  assert.doesNotMatch(backend, /readDatabase\("(?:services|workSettings)"/);
  assert.doesNotMatch(backend, /fallbackServices|legacyServices|legacySettings/);
  assert.equal(rules.rules.services, undefined);
  assert.equal(rules.rules.workSettings, undefined);
});

test("runtime settlement uses only the canonical nested record", async () => {
  const [frontend, backend] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(frontend, /settledAmount\?:|settledAt\?:/);
  assert.doesNotMatch(backend, /next\.settledAmount|next\.settledAt/);
  assert.match(backend, /next\.settlement = \{[\s\S]*barberId: next\.barberId[\s\S]*amount:/);
});
