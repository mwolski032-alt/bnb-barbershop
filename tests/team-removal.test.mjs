import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { planBarberRemoval } from "../shared/team-removal.mjs";

const members = { jan: { id: "jan", userId: "uid-jan" }, ola: { id: "ola" } };

test("a barber with nothing attached is deleted together with their profile, links and photo credits", () => {
  const plan = planBarberRemoval({
    barberId: "jan",
    members,
    barberAppointments: null,
    barberWaitlist: {},
    clients: { c1: { barberIds: { jan: true, ola: true } }, c2: { barberIds: { ola: true } }, c3: {} },
    gallery: { 0: { barberId: "jan" }, 1: { barberId: "ola" }, 2: {} },
  });
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.updates, {
    "team/barbers/jan": null,
    "barbers/jan": null,
    "appointmentSync/barbers/jan": null,
    "clients/c1/barberIds/jan": null,
    "shopfront/gallery/0/barberId": null,
  });
});

test("a barber with visits or waiting clients is never deleted, and the answer says to switch the account off", () => {
  const withVisits = planBarberRemoval({ barberId: "jan", members, barberAppointments: { a: {}, b: {} } });
  assert.equal(withVisits.status, 409);
  assert.match(withVisits.error, /wizyty \(2\)\. Wyłącz jego konto/);
  assert.equal(withVisits.updates, undefined);
  const withWaitlist = planBarberRemoval({ barberId: "jan", members, barberAppointments: {}, barberWaitlist: { w: {} } });
  assert.equal(withWaitlist.status, 409);
  assert.match(withWaitlist.error, /liście rezerwowej \(1\)/);
});

test("an unknown barber is a 404 and nothing else is touched", () => {
  const plan = planBarberRemoval({ barberId: "nobody", members });
  assert.equal(plan.status, 404);
  assert.equal(plan.updates, undefined);
});

test("the team screen has a delete button that asks twice, and the server function is owner-only and locked", async () => {
  const screen = await readFile(new URL("../app/components/screens/admin-settings-screen.tsx", import.meta.url), "utf8");
  assert.match(screen, /confirmLabel="Na pewno usunąć\?"\s+onConfirm=\{\(\) => props\.onDeleteMember\(member\)\}/);
  const server = await readFile(new URL("../netlify/functions/team-member.mjs", import.meta.url), "utf8");
  assert.match(server, /!context\?\.isOwner \|\| !context\.active/);
  assert.match(server, /withDatabaseLock\("appointments"/);
  assert.match(server, /path: "\/api\/team-member"/);
});
