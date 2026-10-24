import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the rules give no blanket read on a barber's record, so the phone and e-mail stay private", async () => {
  const barber = JSON.parse(await read("database.rules.json")).rules.barbers.$barberId;
  // A read granted on a parent cannot be taken back below it, so the parent must grant none.
  assert.equal(barber[".read"], undefined);
  assert.match(barber.profile[".read"], /team\/owner\/userId'\)\.val\(\) === auth\.uid/);
  assert.match(barber.profile[".read"], /child\('userId'\)\.val\(\) === auth\.uid/);
  assert.equal(barber.services[".read"], "auth != null");
  assert.equal(barber.workSettings[".read"], "auth != null");
  for (const field of ["phone", "email"]) {
    assert.equal(barber.profile[field], undefined, `${field} must have no public read`);
  }
});

test("the profile fields the app asks for one by one are exactly the public ones in the rules", async () => {
  const barber = JSON.parse(await read("database.rules.json")).rules.barbers.$barberId;
  const listener = await read("app/lib/barber-profile-listener.ts");
  const listed = /PUBLIC_PROFILE_FIELDS = \[([^\]]*)\]/.exec(listener)[1].match(/"[^"]+"/g).map((name) => name.slice(1, -1));
  const publicInRules = Object.keys(barber.profile).filter((key) => !key.startsWith("."));
  assert.deepEqual([...listed].sort(), [...publicInRules].sort());
  for (const field of publicInRules) assert.equal(barber.profile[field][".read"], "auth != null", field);
});

test("only the owner and a barber's own panel read the whole profile; everyone else asks field by field", async () => {
  const home = await read("app/booking-home.tsx");
  assert.match(home, /const canReadWholeProfile = Boolean\(isOwner\) \|\| \(isBarber && step === "admin"\);/);
  assert.match(home, /listenToBarberProfile\(realtimeDb, barber\.id, canReadWholeProfile,/);
  assert.doesNotMatch(home, /onValue\(ref\(realtimeDb, `barbers\/\$\{barber\.id\}\/profile`\)/);
});
