import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BARBER_ID_PATTERN,
  NEW_BARBER_ACCESS,
  buildInvitedMember,
  claimInvite,
  findPendingInvite,
  isInvitePending,
  isInviteEmail,
  makeBarberId,
  normalizeInviteEmail,
} from "../shared/team-invite.mjs";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a new barber id comes from the name, is a valid database key and avoids existing ones", () => {
  const fixed = () => 0.5;
  const id = makeBarberId("Łukasz Kowalski-Żółć", [], fixed);
  assert.match(id, BARBER_ID_PATTERN);
  assert.match(id, /^lukasz-kowalski-zolc-[0-9a-z]{4}$/);
  assert.match(makeBarberId("!!!", [], fixed), /^barber-/);
  const taken = [makeBarberId("Jan", [], fixed)];
  const other = makeBarberId("Jan", taken, (() => { let n = 0; return () => (n++ === 0 ? 0.5 : 0.25); })());
  assert.notEqual(other, taken[0]);
});

test("e-mail addresses are compared without case or spaces, and obvious typos are rejected", () => {
  assert.equal(normalizeInviteEmail("  New.Barber@Example.COM "), "new.barber@example.com");
  assert.equal(isInviteEmail("barber@gmail.com"), true);
  for (const bad of ["", "barber", "barber@", "barber@gmail", "a b@gmail.com", "@gmail.com", `${"x".repeat(100)}@gmail.com`]) {
    assert.equal(isInviteEmail(bad), false, bad);
  }
});

test("a new card waits without an account, is switched off and can only edit its own profile", () => {
  const member = buildInvitedMember({ id: "jan-ab12", name: " Jan ", email: "Jan@Example.com", index: 2, now: 123 });
  assert.equal(member.name, "Jan");
  assert.equal(member.email, "jan@example.com");
  assert.equal(member.userId, "");
  assert.equal(member.active, false);
  assert.equal(member.label, "Barber 3");
  assert.deepEqual(member.access, NEW_BARBER_ACCESS);
  assert.deepEqual(Object.keys(member.access).filter((section) => member.access[section]), ["profile"]);
  assert.equal(isInvitePending(member), true);
  assert.equal(isInvitePending({ userId: "uid" }), false);
});

test("only a verified sign-in with the waiting address finds the card", () => {
  const members = {
    a: { userId: "", email: "new@example.com" },
    b: { userId: "uid-b", email: "linked@example.com" },
  };
  assert.deepEqual(findPendingInvite(members, "NEW@example.com", true), { id: "a" });
  assert.equal(findPendingInvite(members, "new@example.com", false), null);
  assert.equal(findPendingInvite(members, "new@example.com", undefined), null);
  assert.equal(findPendingInvite(members, "other@example.com", true), null);
  assert.equal(findPendingInvite(members, "", true), null);
  // A card that already has an account is never handed to somebody else.
  assert.equal(findPendingInvite(members, "linked@example.com", true), null);
  // Two cards waiting for one address: nobody gets either.
  const doubled = { ...members, c: { userId: "", email: "new@example.com" } };
  assert.deepEqual(findPendingInvite(doubled, "new@example.com", true), { conflict: true });
});

test("claiming links the account and switches the card on, keeping the owner's choices", () => {
  const card = buildInvitedMember({ id: "jan-ab12", name: "Jan", email: "jan@example.com", now: 1 });
  const claimed = claimInvite({ ...card, access: { ...card.access, schedule: true } }, "uid-1", 99);
  assert.equal(claimed.userId, "uid-1");
  assert.equal(claimed.active, true);
  assert.equal(claimed.claimedAt, 99);
  assert.equal(claimed.access.schedule, true);
  assert.equal(claimed.email, "jan@example.com");
});

test("the owner's team screen adds and removes invitations, and the server claims on sign-in", async () => {
  const home = await read("app/booking-home.tsx");
  const screen = await read("app/components/screens/admin-settings-screen.tsx");
  const admin = await read("netlify/functions/_firebase-admin.mjs");
  assert.match(home, /const NEW_TEAM_MEMBER_ID = "__new__"/);
  assert.match(home, /\[`barbers\/\$\{id\}\/profile\/displayName`\]: name/);
  // Removing an invitation never touches `barbers/<id>` itself: the database rules only allow its sub-nodes.
  assert.match(home, /\[`barbers\/\$\{member\.id\}\/profile`\]: null/);
  assert.match(home, /if \(!isOwner \|\| isTeamSaving \|\| member\.userId\) return;/);
  assert.match(screen, /Czeka na pierwsze logowanie/);
  assert.match(screen, /Usuń zaproszenie/);
  assert.match(admin, /claimWaitingBarberCard\(user, accessToken\)/);
  assert.match(admin, /writeDatabaseIfUnchanged\(path, member, etag, accessToken\)/);
});
