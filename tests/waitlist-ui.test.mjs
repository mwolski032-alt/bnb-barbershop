import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the waitlist is a real button with a bell, on the calendar step and under an empty list of hours", () => {
  const wizard = read("app/components/booking-wizard.tsx");
  assert.match(wizard, /className="story-waitlist"/);
  assert.match(wizard, /<strong>Lista rezerwowa<\/strong>/);
  assert.match(wizard, /Zapisz się/);
  assert.equal((wizard.match(/<WaitlistCard onClick=\{props\.onWaitlist\}/g) ?? []).length, 2);
  assert.doesNotMatch(wizard, /Nie pasuje termin\? Dołącz do listy rezerwowej/);
});

test("the waitlist form picks days with the same picker layout the barber uses for his working days", () => {
  const home = read("app/booking-home.tsx");
  assert.match(home, /<DayPicker\s+selected=\{waitlistDraft\.dates\}/);
  assert.doesNotMatch(home, /waitlist-date-fields/);
  assert.match(home, /dates: waitlistDraft\.dates,/);
  const picker = read("app/components/day-picker.tsx");
  const barber = read("app/components/screens/admin-settings-screen.tsx");
  // The same words and the same style hooks on both sides.
  for (const shared of ["Cały miesiąc", "Poniedziałek–piątek", "Tylko wybrane dni tygodnia", "Pojedyncze dni", "Wyczyść wybór", "wk-calendar-grid", "wk-weekdays", "wk-month-nav"]) {
    assert.ok(picker.includes(shared) && barber.includes(shared), shared);
  }
});

test("a tap on 'new days' opens the booking on that day, and the day is not held for anyone", () => {
  const home = read("app/booking-home.tsx");
  assert.match(home, /event === "waitlist_day_open" && waitlistId && barberId && serviceId && dateKey/);
  assert.match(home, /const opensDay = pendingWaitlistSelection\.startTime === ""/);
  assert.match(home, /setBookingWizardStep\(3\)/);
  const worker = read("netlify/functions/notification-worker.mjs");
  assert.match(worker, /notifyNewWaitlistDays\(database/);
  assert.doesNotMatch(worker, /offerAvailableWaitlistSlots/);
});