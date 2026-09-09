import test from "node:test";
import assert from "node:assert/strict";
import { publicBarber, instagramUrl } from "../shared/shopfront.mjs";

test("public barber projection never exposes private profile or team fields", () => {
  const profile = publicBarber("barber", { name: "Jan Kowalski", userId: "secret", email: "secret", access: { profile: true } },
    { bio: "Klasyka", phone: "123456789", email: "secret", specialties: "Broda", instagram: "@jan" });
  assert.deepEqual(profile, { id: "barber", displayName: "Jan Kowalski", bio: "Klasyka", photoUrl: "", specialties: "Broda", instagram: "https://www.instagram.com/jan/" });
});
test("legacy profiles without new fields remain readable", () => {
  assert.equal(publicBarber("old", { name: "Jan" }).displayName, "Jan");
  assert.equal(publicBarber("old").specialties, "");
});
test("Instagram accepts handles and profile URLs but rejects foreign hosts and scripts", () => {
  for (const text of ["jan", "@jan", "https://instagram.com/jan/", "https://www.instagram.com/jan/"]) assert.equal(instagramUrl(text), "https://www.instagram.com/jan/");
  for (const text of ["javascript:alert(1)", "https://evil.com/jan", "https://instagram.com.evil.com/jan", "https://instagram.com/p/post/", ""]) assert.equal(instagramUrl(text), "");
});
