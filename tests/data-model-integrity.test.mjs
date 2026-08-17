import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildCanonicalMigration,
  upsertCanonicalClient,
  validateCanonicalDatabase,
} from "../shared/data-model.mjs";

const fullAccess = {
  schedule: true,
  clients: true,
  analytics: true,
  work: true,
  services: true,
  profile: true,
};

const canonicalBase = () => ({
  team: {
    owner: { userId: "owner-uid", active: true },
    barbers: {
      mateusz: {
        id: "mateusz",
        userId: "mateusz-uid",
        active: true,
        access: { ...fullAccess },
      },
      kacper: {
        id: "kacper",
        userId: "kacper-uid",
        active: true,
        access: { ...fullAccess },
      },
    },
  },
  barbers: {
    mateusz: {
      services: {
        cut: {
          id: "cut",
          barberId: "mateusz",
          name: "Strzyzenie",
          price: "50 zl",
          durationMinutes: 60,
          order: 0,
        },
      },
      workSettings: { availability: {} },
    },
    kacper: {
      services: {
        cut: {
          id: "cut",
          barberId: "kacper",
          name: "Strzyzenie",
          price: "50 zl",
          durationMinutes: 60,
          order: 0,
        },
      },
      workSettings: { availability: {} },
    },
  },
  appointments: {},
  clients: {},
});

test("data migration moves legacy paths and canonicalizes settlement and relations", () => {
  const source = canonicalBase();
  delete source.barbers.mateusz.services;
  source.services = {
    cut: { id: "old-cut", name: "Strzyzenie", price: "50 zl", durationMinutes: 60 },
  };
  source.workSettings = {
    availability: {
      "2099-01-10": { startTime: "08:00", endTime: "16:00" },
    },
  };
  source.clients = {
    manual: {
      id: "manual",
      firstName: "Jan",
      lastName: "Kowalski",
      email: "JAN@example.com",
      phone: "500 600 700",
      barberIds: { mateusz: true },
    },
  };
  source.appointments = {
    visit: {
      id: "old-visit-id",
      clientId: "manual",
      userId: "client-uid",
      clientName: "Jan Kowalski",
      clientEmail: "jan@example.com",
      phone: "500600700",
      serviceName: "Strzyzenie",
      price: "50 zl",
      dateKey: "2099-01-10",
      startTime: "10:00",
      durationMinutes: 60,
      status: "completed",
      settledAt: 123456,
      settledAmount: 50,
    },
  };

  const original = structuredClone(source);
  const { data, report } = buildCanonicalMigration(source, { legacyBarberId: "mateusz" });

  assert.equal(report.canApply, true, JSON.stringify(report.errors));
  assert.deepEqual(source, original, "dry-run must not mutate its input");
  assert.equal(data.services, undefined);
  assert.equal(data.workSettings, undefined);
  assert.equal(data.barbers.mateusz.services.cut.id, "cut");
  assert.equal(data.barbers.mateusz.services.cut.barberId, "mateusz");
  assert.equal(data.barbers.mateusz.workSettings.availability["2099-01-10"].barberId, "mateusz");
  assert.equal(data.appointments.visit.id, "visit");
  assert.equal(data.appointments.visit.barberId, "mateusz");
  assert.equal(data.appointments.visit.serviceId, "cut");
  assert.deepEqual(data.appointments.visit.settlement, {
    barberId: "mateusz",
    settledAt: 123456,
    amount: 50,
  });
  assert.equal("settledAt" in data.appointments.visit, false);
  assert.equal("settledAmount" in data.appointments.visit, false);
});

test("data migration merges duplicate clients and relinks their appointments", () => {
  const source = canonicalBase();
  source.clients = {
    manual: {
      id: "manual",
      firstName: "Jan",
      lastName: "Kowalski",
      email: "jan@example.com",
      phone: "500600700",
      barberIds: { mateusz: true },
    },
    "client-uid": {
      id: "client-uid",
      firstName: "Jan",
      lastName: "Kowalski",
      email: "JAN@example.com",
      phone: "500 600 700",
      userId: "client-uid",
      barberIds: { kacper: true },
    },
  };
  source.appointments.visit = {
    id: "visit",
    barberId: "mateusz",
    clientId: "manual",
    userId: "client-uid",
    clientName: "Jan Kowalski",
    clientEmail: "jan@example.com",
    phone: "500600700",
    serviceId: "cut",
    serviceName: "Strzyzenie",
    price: "50 zl",
    dateKey: "2099-01-10",
    startTime: "10:00",
    durationMinutes: 60,
    status: "confirmed",
  };

  const { data, report } = buildCanonicalMigration(source);

  assert.equal(report.canApply, true, JSON.stringify(report.errors));
  assert.deepEqual(Object.keys(data.clients), ["client-uid"]);
  assert.equal(data.appointments.visit.clientId, "client-uid");
  assert.deepEqual(data.clients["client-uid"].barberIds, { mateusz: true, kacper: true });
  assert.equal(report.changeCounts.merge, 1);
});

test("data migration blocks ambiguous duplicates with different account owners", () => {
  const source = canonicalBase();
  source.clients = {
    first: {
      id: "first",
      email: "shared@example.com",
      phone: "500600700",
      userId: "first-user",
    },
    second: {
      id: "second",
      email: "shared@example.com",
      phone: "500600700",
      userId: "second-user",
    },
  };

  const { report } = buildCanonicalMigration(source);

  assert.equal(report.canApply, false);
  assert.equal(report.errors.some((error) => error.code === "ambiguous_duplicate"), true);
});

test("integrity validation rejects invalid barberId and missing service relations", () => {
  const database = canonicalBase();
  database.clients.client = {
    id: "client",
    firstName: "Jan",
    lastName: "Kowalski",
    email: "jan@example.com",
    phone: "500600700",
    barberIds: { mateusz: true },
    hiddenFor: { mateusz: false },
  };
  database.appointments.visit = {
    id: "visit",
    barberId: "ghost",
    clientId: "client",
    serviceId: "missing",
    clientName: "Jan Kowalski",
    dateKey: "2099-01-10",
    startTime: "10:00",
    durationMinutes: 60,
    status: "confirmed",
  };

  const validation = validateCanonicalDatabase(database);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.code === "invalid_appointment_barber"), true);
});

test("data migration creates a missing client relation from appointment identity", () => {
  const source = canonicalBase();
  source.appointments.visit = {
    id: "visit",
    barberId: "mateusz",
    userId: "client-uid",
    clientName: "Jan Kowalski",
    clientEmail: "jan@example.com",
    phone: "500600700",
    serviceId: "cut",
    serviceName: "Strzyzenie",
    price: "50 zl",
    dateKey: "2099-01-10",
    startTime: "10:00",
    durationMinutes: 60,
    status: "confirmed",
  };

  const { data, report } = buildCanonicalMigration(source);

  assert.equal(report.canApply, true, JSON.stringify(report.errors));
  assert.equal(data.appointments.visit.clientId, "client-uid");
  assert.equal(data.clients["client-uid"].barberIds.mateusz, true);
});

test("runtime client upsert merges a manual card into the authenticated client identity", () => {
  const result = upsertCanonicalClient(
    {
      manual: {
        id: "manual",
        firstName: "Jan",
        lastName: "Kowalski",
        email: "jan@example.com",
        phone: "500600700",
        barberIds: { mateusz: true },
      },
    },
    "client-uid",
    {
      firstName: "Jan",
      lastName: "Kowalski",
      email: "JAN@example.com",
      phone: "500 600 700",
      userId: "client-uid",
      barberIds: { kacper: true },
    },
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(Object.keys(result.clients), ["client-uid"]);
  assert.deepEqual(result.client.barberIds, { mateusz: true, kacper: true });
  assert.deepEqual(result.aliases, { manual: "client-uid", "client-uid": "client-uid" });
});

test("runtime client upsert keeps authenticated family members sharing a phone separate", () => {
  const result = upsertCanonicalClient(
    {
      "client-a": {
        id: "client-a",
        firstName: "Jan",
        lastName: "Kowalski",
        email: "jan@example.com",
        phone: "500600700",
        userId: "client-a",
        barberIds: { mateusz: true },
      },
    },
    "client-b",
    {
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.com",
      phone: "500600700",
      userId: "client-b",
      barberIds: { mateusz: true },
    },
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(Object.keys(result.clients).sort(), ["client-a", "client-b"]);
  assert.equal(result.canonicalId, "client-b");
  assert.equal(result.clients["client-a"].email, "jan@example.com");
  assert.equal(result.clients["client-b"].email, "anna@example.com");
});

test("integrity validation rejects duplicated account assignments and invalid availability ranges", () => {
  const database = canonicalBase();
  database.team.barbers.kacper.userId = database.team.barbers.mateusz.userId;
  database.barbers.mateusz.workSettings.availability["2099-01-10"] = {
    id: "2099-01-10",
    barberId: "mateusz",
    dateKey: "2099-01-10",
    startTime: "16:00",
    endTime: "08:00",
  };

  const validation = validateCanonicalDatabase(database);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some((error) => error.code === "duplicate_barber_user"), true);
  assert.equal(validation.errors.some((error) => error.code === "invalid_availability_range"), true);
});

test("migration CLI defaults to dry-run and writes backup, candidate and report", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bnb-data-migration-"));
  const input = path.join(directory, "input.json");
  const output = path.join(directory, "output");
  await writeFile(input, JSON.stringify(canonicalBase()), "utf8");

  const result = spawnSync(
    process.execPath,
    [
      path.resolve("scripts/migrate-data-model.mjs"),
      "--input",
      input,
      "--output-dir",
      output,
    ],
    { cwd: path.resolve("."), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry-run zakończony/);
  const report = JSON.parse(await readFile(path.join(output, "report.json"), "utf8"));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.canApply, true);
  assert.match(report.backupSha256, /^[a-f0-9]{64}$/);
  assert.match(report.candidateSha256, /^[a-f0-9]{64}$/);
  await Promise.all([
    readFile(path.join(output, "backup.json"), "utf8"),
    readFile(path.join(output, "candidate.json"), "utf8"),
  ]);

  await rm(directory, { recursive: true, force: true });
});
