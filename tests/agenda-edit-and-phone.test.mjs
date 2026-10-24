import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the visit sheet in the calendar offers editing of the date, time and price, also for a settled visit", () => {
  const agenda = read("app/components/screens/admin-agenda-screen.tsx");
  assert.match(agenda, /props\.canManageSchedule && \(canEdit \|\| isCompleted\)/);
  assert.match(agenda, /isCompleted \? "Popraw cenę" : "Edytuj"/);
  // Cancelling stays limited to open visits.
  // Cancelling asks "Na pewno?" on the same button (a second tap) instead of opening a dialog.
  assert.match(agenda, /props\.canManageSchedule && canEdit \? \(\s*<ConfirmButton\s+className="danger"/);
});

test("a returning client's phone number fills the booking and waitlist forms and survives a booking", () => {
  const hook = read("app/hooks/use-known-phone.ts");
  assert.match(hook, /getPhoneDigits\(appointment\.phone \?\? ""\)\.length === 9/);
  assert.match(hook, /getAppointmentSortValue\(second\)\.localeCompare\(getAppointmentSortValue\(first\)\)/);
  assert.match(hook, /doneFor\.current === uid/);
  const home = read("app/booking-home.tsx");
  assert.match(home, /useKnownPhone\(activeUser\?\.uid, ownClientAppointments/);
  // Only an empty field is filled, never one the client already typed.
  assert.match(home, /getPhoneDigits\(c\.phone\)\.length === 9 \? c : \{ \.\.\.c, phone \}/);
  assert.match(home, /setForm\(\(current\) => \(\{ fullName: "", phone: current\.phone \}\)\)/);
});
