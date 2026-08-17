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
      appointmentSync: { revision: 1 },
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
  await assertFails(set(ref(database, "appointmentSync/revision"), 2));
});

test("Firebase rules: barber can update own appointment but cannot take over a foreign one", async () => {
  const database = databaseFor(mateuszUid);

  await assertSucceeds(
    update(ref(database, "appointments/mateusz-appointment"), { status: "cancelled" }),
  );
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
