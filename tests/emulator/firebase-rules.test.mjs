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

test("gallery is public to read but only the active owner may add, reorder and delete", async () => {
  const path = "shopfront/gallery/0";
  const photo = { id: "qa-photo", imageUrl: "data:image/webp;base64,AAAA", alt: "Salon", order: 0 };
  const anonymous = environment.unauthenticatedContext().database();
  for (const db of [anonymous, databaseFor(clientUid), databaseFor(mateuszUid), databaseFor(kacperUid)]) {
    await assertSucceeds(get(ref(db, "shopfront/gallery")));
    await assertFails(set(ref(db, path), photo));
  }
  const owner = databaseFor(ownerUid);
  // The gallery holds up to 40 photos (records 0 to 39) and may credit the barber who did the haircut.
  await assertFails(set(ref(owner, "shopfront/gallery/40"), photo));
  await assertSucceeds(set(ref(owner, "shopfront/gallery/39"), { ...photo, order: 39, barberId: "mateusz" }));
  await assertFails(set(ref(owner, "shopfront/gallery/39"), { ...photo, order: 40 }));
  await assertFails(set(ref(owner, "shopfront/gallery/39"), { ...photo, order: 39, barberId: "not a key/../" }));
  await assertFails(set(ref(owner, "shopfront/gallery/39"), { ...photo, order: 39, barberId: 5 }));
  await assertSucceeds(set(ref(owner, "shopfront/gallery/39"), null));
  await assertSucceeds(set(ref(owner, path), photo));
  await assertSucceeds(set(ref(owner, `${path}/barberId`), "mateusz"));
  await assertFails(set(ref(owner, `${path}/barberId`), "unknown-barber"));
  await assertSucceeds(set(ref(owner, `${path}/barberId`), null));
  await assertSucceeds(set(ref(owner, `${path}/order`), 1));
  await assertFails(set(ref(owner, `${path}/imageUrl`), "javascript:alert(1)"));
  await assertFails(set(ref(owner, `${path}/privateEmail`), "private"));
  await assertFails(set(ref(databaseFor(mateuszUid), path), null));
  await assertFails(set(ref(databaseFor(clientUid), `${path}/order`), 2));
  await assertSucceeds(set(ref(owner, path), null));
});

test("a barber the owner switched Galeria on for adds and deletes only their own photos", async () => {
  const photo = { id: "qa-photo", imageUrl: "data:image/webp;base64,AAAA", alt: "Salon", order: 0 };
  const owner = databaseFor(ownerUid);
  const setGalleryAccess = (barberId, allowed) => environment.withSecurityRulesDisabled(context =>
    set(ref(context.database(), `team/barbers/${barberId}/access/gallery`), allowed));
  const mateusz = databaseFor(mateuszUid);
  const kacper = databaseFor(kacperUid);
  // Without the permission nobody but the owner can add.
  await assertFails(set(ref(mateusz, "shopfront/gallery/3"), { ...photo, barberId: "mateusz" }));
  await setGalleryAccess("mateusz", true);
  // With it the barber adds a photo credited to themselves, never to someone else or to nobody.
  await assertSucceeds(set(ref(mateusz, "shopfront/gallery/3"), { ...photo, barberId: "mateusz" }));
  await assertFails(set(ref(mateusz, "shopfront/gallery/4"), { ...photo, barberId: "kacper" }));
  await assertFails(set(ref(mateusz, "shopfront/gallery/4"), photo));
  await assertFails(set(ref(mateusz, "shopfront/gallery/40"), { ...photo, barberId: "mateusz" }));
  // They cannot edit it, take over an occupied slot or touch another barber's photo.
  await assertFails(set(ref(mateusz, "shopfront/gallery/3/order"), 5));
  await assertFails(set(ref(mateusz, "shopfront/gallery/3"), { ...photo, alt: "Changed", barberId: "mateusz" }));
  await assertSucceeds(set(ref(owner, "shopfront/gallery/5"), { ...photo, order: 1, barberId: "kacper" }));
  await assertFails(set(ref(mateusz, "shopfront/gallery/5"), null));
  await assertFails(set(ref(kacper, "shopfront/gallery/3"), null));
  // Deleting their own photo works; switching the permission off stops new uploads at once.
  await assertSucceeds(set(ref(mateusz, "shopfront/gallery/3"), null));
  await setGalleryAccess("mateusz", false);
  await assertFails(set(ref(mateusz, "shopfront/gallery/3"), { ...photo, barberId: "mateusz" }));
  await assertSucceeds(set(ref(owner, "shopfront/gallery/5"), null));
});

test("a client reads and writes only their own account profile, with validated fields", async () => {
  const mine = databaseFor(clientUid);
  const path = `clientProfiles/${clientUid}`;
  const avatar = "data:image/webp;base64,AAAA";
  await assertSucceeds(set(ref(mine, path), { displayName: "Jan Kowalski", phone: "500600700", photoUrl: avatar, favoriteBarberId: "mateusz", updatedAt: 1 }));
  await assertSucceeds(get(ref(mine, path)));
  await assertFails(get(ref(databaseFor(mateuszUid), path)));
  await assertFails(get(ref(environment.unauthenticatedContext().database(), path)));
  await assertFails(set(ref(databaseFor(mateuszUid), path), { displayName: "Hacked" }));
  await assertFails(set(ref(mine, `${path}/phone`), "12345"));
  await assertFails(set(ref(mine, `${path}/phone`), "500 600 700"));
  await assertFails(set(ref(mine, `${path}/photoUrl`), "https://evil.example/x.webp"));
  await assertFails(set(ref(mine, `${path}/photoUrl`), `data:image/webp;base64,${"A".repeat(60001)}`));
  await assertFails(set(ref(mine, `${path}/displayName`), "J"));
  await assertFails(set(ref(mine, `${path}/role`), "owner"));
  await assertSucceeds(set(ref(mine, path), null));
});

test("gallery records for stored photos accept only same-origin photo paths", async () => {
  const owner = databaseFor(ownerUid);
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const bucketUrl = `/api/gallery-image/${id}/1600.webp`;
  const photo = { id, imageUrl: bucketUrl, alt: "Salon", order: 0, storage: true, width: 1600, height: 1067, blur: "data:image/webp;base64,AAAA" };
  await assertSucceeds(set(ref(owner, "shopfront/gallery/0"), photo));
  await assertFails(set(ref(owner, "shopfront/gallery/0/imageUrl"), "https://evil.example/x.webp"));
  await assertFails(set(ref(owner, "shopfront/gallery/0/imageUrl"), `//evil.example${bucketUrl}`));
  await assertFails(set(ref(owner, "shopfront/gallery/0/blur"), "javascript:alert(1)"));
  await assertFails(set(ref(databaseFor(clientUid), "shopfront/gallery/0"), photo));
  await assertSucceeds(set(ref(owner, "shopfront/gallery/0"), null));
});

test("diagnostic reports cannot be read or forged through the public Firebase client", async () => {
  const path = "clientErrorReports/example";
  const report = { id: "example", message: "private diagnostic" };
  const databases = [
    environment.unauthenticatedContext().database(),
    databaseFor(clientUid),
    databaseFor(mateuszUid),
    databaseFor(ownerUid),
  ];
  for (const database of databases) {
    await assertFails(get(ref(database, "clientErrorReports")));
    await assertFails(set(ref(database, path), report));
  }
});

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
          profile: { displayName: "Mateusz", bio: "Fryzjer", phone: "500600700", email: "mateusz@example.com" },
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
          profile: { displayName: "Kacper", bio: "Broda", phone: "500600800", email: "kacper@example.com" },
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

// Earlier tests switch Mateusz off and leave him so; these two say what state they need and put it back.
const withMateuszActive = async (active, run) => {
  let previous;
  await environment.withSecurityRulesDisabled(async (context) => {
    previous = (await get(ref(context.database(), "team/barbers/mateusz/active"))).val();
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    await update(ref(context.database(), "team/barbers/mateusz"), { active });
  });
  try {
    await run();
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      await update(ref(context.database(), "team/barbers/mateusz"), { active: previous });
    });
  }
};

test("Firebase rules: a barber's phone and e-mail are private, the rest of the profile is public", () => withMateuszActive(true, async () => {
  const publicFields = ["displayName", "bio"];
  const privateFields = ["phone", "email"];

  // Any signed-in client: the public fields, the services and the work settings, but never the whole profile
  // or the barber's record as a whole (which would include the phone and e-mail).
  const client = databaseFor(clientUid);
  for (const field of publicFields) await assertSucceeds(get(ref(client, `barbers/mateusz/profile/${field}`)));
  for (const field of privateFields) await assertFails(get(ref(client, `barbers/mateusz/profile/${field}`)));
  await assertFails(get(ref(client, "barbers/mateusz/profile")));
  await assertFails(get(ref(client, "barbers/mateusz")));
  await assertFails(get(ref(client, "barbers")));
  await assertSucceeds(get(ref(client, "barbers/mateusz/services")));
  await assertSucceeds(get(ref(client, "barbers/mateusz/workSettings")));

  // Somebody who is not signed in reads none of it (the public salon page uses the server for that).
  const anonymous = environment.unauthenticatedContext().database();
  await assertFails(get(ref(anonymous, "barbers/mateusz/profile/displayName")));
  await assertFails(get(ref(anonymous, "barbers/mateusz/profile/phone")));

  // The owner and the barber himself read the whole profile; another barber reads only the public part.
  const wholeOwner = await assertSucceeds(get(ref(databaseFor(ownerUid), "barbers/mateusz/profile")));
  assert.equal(wholeOwner.val().phone, "500600700");
  const wholeSelf = await assertSucceeds(get(ref(databaseFor(mateuszUid), "barbers/mateusz/profile")));
  assert.equal(wholeSelf.val().email, "mateusz@example.com");
  const other = databaseFor(kacperUid);
  await assertFails(get(ref(other, "barbers/mateusz/profile")));
  await assertFails(get(ref(other, "barbers/mateusz/profile/phone")));
  await assertSucceeds(get(ref(other, "barbers/mateusz/profile/displayName")));
}));

test("Firebase rules: a switched-off barber no longer reads the whole profile", () => withMateuszActive(false, async () => {
  await assertFails(get(ref(databaseFor(mateuszUid), "barbers/mateusz/profile")));
  await assertSucceeds(get(ref(databaseFor(mateuszUid), "barbers/mateusz/profile/displayName")));
  await assertSucceeds(get(ref(databaseFor(ownerUid), "barbers/mateusz/profile")));
}));
