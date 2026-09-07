import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, set, update } from "firebase/database";

const projectId = "demo-bnb-stage3";
const ownerUid = "owner-uid";
const mateuszUid = "mateusz-uid";
const kacperUid = "kacper-uid";
const clientUid = "client-uid";

const fullAccess = {
  schedule: true,
  clients: true,
  analytics: true,
  work: true,
  services: true,
  profile: true,
};

let environment;

const databaseFor = (uid) => environment.authenticatedContext(uid).database();

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: await readFile(new URL("../../database.rules.json", import.meta.url), "utf8"),
    },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database()), {
      team: {
        owner: { userId: ownerUid, active: true },
        barbers: {
          mateusz: {
            id: "mateusz",
            userId: mateuszUid,
            active: true,
            access: fullAccess,
          },
          kacper: {
            id: "kacper",
            userId: kacperUid,
            active: true,
            access: fullAccess,
          },
        },
      },
      barbers: {
        mateusz: {
          profile: { displayName: "Mateusz" },
          services: {
            cut: {
              id: "cut",
              barberId: "mateusz",
              name: "Strzyzenie",
              durationMinutes: 60,
            },
          },
          workSettings: { availability: {} },
        },
        kacper: {
          profile: { displayName: "Kacper" },
          services: {
            cut: {
              id: "cut",
              barberId: "kacper",
              name: "Strzyzenie",
              durationMinutes: 60,
            },
          },
          workSettings: { availability: {} },
        },
      },
      appointments: {
        "mateusz-appointment": {
          id: "mateusz-appointment",
          barberId: "mateusz",
          userId: clientUid,
          status: "confirmed",
        },
        "kacper-appointment": {
          id: "kacper-appointment",
          barberId: "kacper",
          userId: "other-client",
          status: "confirmed",
        },
      },
      appointmentSync: {
        revision: 1,
        users: {
          [clientUid]: { revision: 2, updatedAt: 2 },
          "other-client": { revision: 3, updatedAt: 3 },
        },
        barbers: { mateusz: { revision: 4, updatedAt: 4 } },
      },
      clients: {
        [clientUid]: { id: clientUid, barberIds: { mateusz: true } },
      },
    });
  });
});

after(async () => {
  await environment?.cleanup();
});

test("Firebase rules: owner can read all appointments and manage both barber records", async () => {
  const database = databaseFor(ownerUid);

  const appointments = await assertSucceeds(get(ref(database, "appointments")));
  assert.equal(appointments.size, 2);
  await assertSucceeds(update(ref(database, "team/barbers/kacper"), { active: false }));
  await assertSucceeds(update(ref(database, "team/barbers/kacper"), { active: true }));
});

test("Firebase rules: barber reads only own private assignment and cannot list the team", async () => {
  const database = databaseFor(mateuszUid);

  await assertSucceeds(get(ref(database, "team/barbers/mateusz")));
  await assertFails(get(ref(database, "team/barbers/kacper")));
  await assertFails(get(ref(database, "team/barbers")));
  await assertFails(get(ref(database, "team/owner")));
});

test("Firebase rules: client cannot read private team assignments, appointments or clients", async () => {
  const database = databaseFor(clientUid);

  await assertFails(get(ref(database, "team/barbers/mateusz")));
  await assertFails(get(ref(database, "appointments/mateusz-appointment")));
  await assertFails(get(ref(database, `clients/${clientUid}`)));
  await assertSucceeds(get(ref(database, "barbers/mateusz/services")));
  const revision = await assertSucceeds(get(ref(database, "appointmentSync/revision")));
  assert.equal(revision.val(), 1);
  const ownSignal = await assertSucceeds(
    get(ref(database, `appointmentSync/users/${clientUid}/revision`)),
  );
  assert.equal(ownSignal.val(), 2);
  await assertFails(get(ref(database, "appointmentSync/users/other-client/revision")));
  const barberSignal = await assertSucceeds(
    get(ref(database, "appointmentSync/barbers/mateusz/revision")),
  );
  assert.equal(barberSignal.val(), 4);
  await assertFails(set(ref(database, "appointmentSync/revision"), 2));
  await assertFails(set(ref(database, `appointmentSync/users/${clientUid}/revision`), 5));
});

test("Firebase rules: even barber and owner must use the server for appointment identity changes", async () => {
  const database = databaseFor(mateuszUid);

  await assertFails(
    update(ref(database, "appointments/mateusz-appointment"), { status: "cancelled" }),
  );
  await assertFails(update(ref(database, "appointments/mateusz-appointment"), { userId: "other-client" }));
  await assertFails(update(ref(databaseFor(ownerUid), "appointments/mateusz-appointment"), { clientId: "other-client" }));
  await assertFails(
    update(ref(database, "appointments/kacper-appointment"), { barberId: "mateusz" }),
  );
  await assertFails(
    update(ref(database, "appointments/mateusz-appointment"), { barberId: "kacper" }),
  );
});

test("Firebase rules: section access and active status revoke direct barber writes", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await update(ref(context.database(), "team/barbers/mateusz"), {
      "access/schedule": false,
    });
  });
  await assertFails(
    update(ref(databaseFor(mateuszUid), "appointments/mateusz-appointment"), {
      status: "confirmed",
    }),
  );

  await environment.withSecurityRulesDisabled(async (context) => {
    await update(ref(context.database(), "team/barbers/mateusz"), {
      "access/schedule": true,
      active: false,
    });
  });
  await assertFails(get(ref(databaseFor(mateuszUid), "team/barbers/mateusz")));
  await assertFails(
    update(ref(databaseFor(mateuszUid), "barbers/mateusz/profile"), {
      displayName: "Bez dostepu",
    }),
  );
});

test("Firebase rules: client cannot write public barber configuration", async () => {
  await assertFails(
    update(ref(databaseFor(clientUid), "barbers/mateusz/profile"), {
      displayName: "Nieuprawniona zmiana",
    }),
  );
});

test("Firebase rules: users manage only their own device tokens and cannot read the outbox", async () => {
  const database = databaseFor(clientUid);
  await assertSucceeds(set(ref(database, `notificationTokens/${clientUid}/phone`), {
    token: "own-token",
    active: true,
  }));
  await assertSucceeds(get(ref(database, `notificationTokens/${clientUid}`)));
  await assertFails(set(ref(database, "notificationTokens/other-client/phone"), {
    token: "foreign-token",
    active: true,
  }));
  await assertFails(get(ref(database, "notificationTokens/other-client")));
  await assertFails(get(ref(database, "notificationOutbox")));
  await assertFails(get(ref(database, "appointmentOperations")));
});

test("Firebase rules: barber configuration enforces canonical barber relations", async () => {
  const database = databaseFor(kacperUid);
  await assertSucceeds(
    set(ref(database, "barbers/kacper/services/beard"), {
      id: "beard",
      barberId: "kacper",
      name: "Broda",
      durationMinutes: 30,
    }),
  );
  await assertFails(
    set(ref(database, "barbers/kacper/services/foreign"), {
      id: "foreign",
      barberId: "mateusz",
      name: "Błędna usługa",
      durationMinutes: 30,
    }),
  );
  await assertFails(
    set(ref(database, "barbers/kacper/workSettings/availability/2099-02-01"), {
      id: "2099-02-01",
      barberId: "mateusz",
      dateKey: "2099-02-01",
      startTime: "08:00",
      endTime: "16:00",
    }),
  );
});

// Exercise the actual REST transport used by the server, not just mocked claims.
const guardedRestPatch = async (owner, updates, { override = true, admin = true, claims = {} } = {}) => {
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  assert.ok(emulatorHost, "These tests must never contact production");
  const url = new URL(`http://${emulatorHost}/.json`);
  url.searchParams.set("ns", projectId);
  if (override) url.searchParams.set("auth_variable_override", JSON.stringify({
    uid: "bnb-schedule-writer", token: { bnbScheduleWriter: true, lockOwner: owner, ...claims },
  }));
  return fetch(url, { method: "PATCH", headers: {
    "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer owner" } : {}),
  }, body: JSON.stringify(updates) });
};
const setLease = (owner, expiresAt) => environment.withSecurityRulesDisabled(context =>
  set(ref(context.database(), "systemLocks/appointments"), { owner, expiresAt }));

test("Firebase rules: isolated barber commits are fenced by global epoch and operation identity", async () => {
  const seed = (global, expiresAt = Date.now() + 60000) => environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), "systemLocks/appointments"), global);
    await set(ref(context.database(), "systemLocks/barber_mateusz"), { owner: "isolated", expiresAt });
  });
  const claims = { lockScope: "barber_mateusz", globalEpoch: 7, operationId: "isolated-op" };
  await seed({ epoch: 7 });
  const success = await guardedRestPatch("isolated", {
    "appointments/isolated-test": { id: "isolated-test", status: "confirmed" },
    "appointmentOperations/isolated-op": { id: "isolated-op" },
    "appointmentSync/users/isolated/revision": { ".sv": { increment: 1 } },
  }, { claims });
  assert.equal(success.status, 200, await success.text());
  const denied = async (token = claims) => {
    const result = await guardedRestPatch("isolated", {
      "appointments/isolated-test/status": "cancelled",
      "notificationOutbox/isolated-rejected": { id: "isolated-rejected" },
    }, { claims: token });
    assert.equal(result.status, 401, await result.text());
  };
  await denied(); // Duplicate operation cannot commit a second time.
  const fresh = { ...claims, operationId: "fresh-isolated-op" };
  await seed({ epoch: 8 });
  await denied(fresh); // A global mutation finished but still invalidates stale work.
  await seed({ epoch: 7, owner: "global-active", expiresAt: Date.now() + 60000 });
  await denied(fresh);
  await seed({ epoch: 7 }, Date.now() - 1);
  await denied(fresh);
  await environment.withSecurityRulesDisabled(async context => {
    assert.equal((await get(ref(context.database(), "appointments/isolated-test/status"))).val(), "confirmed");
    assert.equal((await get(ref(context.database(), "notificationOutbox/isolated-rejected"))).exists(), false);
  });
});

test("Firebase rules: scoped REST commit succeeds only with the live server lease", async () => {
  await setLease("live-lease", Date.now() + 60000);
  const updates = {
    "appointments/fenced-test": { id: "fenced-test", status: "confirmed" },
    "clients/fenced-client": { id: "fenced-client" },
    "waitlistEntries/fenced-waitlist": { id: "fenced-waitlist" },
    "appointmentOperations/fenced-operation": { id: "fenced-operation" },
    "notificationOutbox/fenced-notification": { id: "fenced-notification" },
    "appointmentSync/users/fenced-client": { revision: 1 },
  };
  const result = await guardedRestPatch("live-lease", updates);
  assert.equal(result.status, 200, await result.text());
  await environment.withSecurityRulesDisabled(async context => {
    for (const [path, value] of Object.entries(updates)) {
      assert.deepEqual((await get(ref(context.database(), path))).val(), value);
    }
  });
  await setLease("next-lease", Date.now() + 60000);
  const stale = await guardedRestPatch("live-lease", {
    "appointments/fenced-test/status": "rescheduled",
    "appointmentOperations/rejected-operation": { id: "rejected-operation" },
  });
  assert.equal(stale.status, 401, await stale.text());
  await environment.withSecurityRulesDisabled(async context => {
    assert.equal((await get(ref(context.database(), "appointments/fenced-test/status"))).val(), "confirmed");
    assert.equal((await get(ref(context.database(), "appointmentOperations/rejected-operation"))).exists(), false);
  });
});

test("Firebase rules: expired lease cannot commit or renew itself inside the patch", async () => {
  await setLease("expired-lease", Date.now() - 1);
  const expired = await guardedRestPatch("expired-lease", { "appointments/expired-test": { id: "expired-test" } });
  assert.equal(expired.status, 401, await expired.text());
  const selfRenewed = await guardedRestPatch("expired-lease", {
    "systemLocks/appointments/expiresAt": Date.now() + 60000,
    "appointments/expired-test": { id: "expired-test" },
  });
  assert.equal(selfRenewed.status, 401, await selfRenewed.text());
});

test("Firebase rules: knowing the lease ID does not grant clients writer privileges", async () => {
  await setLease("known-lease", Date.now() + 60000);
  const anonymous = await guardedRestPatch("known-lease", { "appointments/spoofed": { id: "spoofed" } }, { admin: false });
  assert.ok([400, 401, 403].includes(anonymous.status), await anonymous.text());
  await assertFails(update(ref(databaseFor("bnb-schedule-writer")), { "appointments/spoofed": { id: "spoofed" } }));
  await assertFails(set(ref(databaseFor(clientUid), "systemLocks/appointments"), { owner: "known-lease", expiresAt: Date.now() + 60000 }));
  await assertFails(get(ref(databaseFor(clientUid), "systemLocks/appointments")));
});

test("Firebase rules: even a valid writer cannot change team privileges, tokens or lock records", async () => {
  await setLease("restricted-lease", Date.now() + 60000);
  for (const path of ["team/owner/active", "notificationTokens/other-client/device", "systemLocks/appointments/owner"]) {
    const result = await guardedRestPatch("restricted-lease", { [path]: "forbidden" });
    assert.equal(result.status, 401, `${path}: ${await result.text()}`);
  }
});
