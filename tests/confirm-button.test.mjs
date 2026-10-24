import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("an irreversible action asks \"Na pewno?\" on the same button: the first tap arms it, the second does the work", async () => {
  const button = await read("app/components/confirm-button.tsx");
  assert.match(button, /confirmLabel = "Na pewno\?"/);
  assert.match(button, /if \(!armed\) \{\s*setArmed\(true\);/);
  assert.match(button, /onConfirm\(\);/);
  // It disarms by itself: after a few seconds, when the person taps elsewhere, and when the button is disabled.
  assert.match(button, /ARMED_MS = 4000/);
  assert.match(button, /onBlur=/);
  assert.match(button, /if \(disabled\)/);
  assert.match(await read("app/globals.css"), /button\[data-armed="true"\] \{[^}]*background: var\(--color-error\) !important;/);
});

test("the cancelling and removing buttons use it, and the dialogs they replaced stay for every other way in", async () => {
  const home = await read("app/booking-home.tsx");
  const agenda = await read("app/components/screens/admin-agenda-screen.tsx");
  const waitlist = await read("app/components/waitlist-detail-dialog.tsx");

  // Barber: cancel and refuse in the visit sheet, remove from the waiting list, mark a no-show.
  assert.match(agenda, /<ConfirmButton\s+className="danger"\s+confirmLabel="Na pewno\?"\s+onConfirm=\{\(\) => runAndClose\(\(\) => props\.onCancelAppointment/);
  assert.match(agenda, /<ConfirmButton\s+className="agenda-sheet-refuse"/);
  assert.match(waitlist, /<ConfirmButton\s+className="is-danger"/);
  assert.match(home, /onConfirm=\{\(\) => void markAdminAppointmentNoShow\(appointment, \{ confirmed: true \}\)\}/);
  assert.match(home, /declineAdminAppointment\(appointmentId, \{ confirmed: true \}\)/);
  assert.match(home, /refuseClientRescheduledAppointment\(appointment, \{ confirmed: true \}\)/);
  assert.match(home, /removeAdminWaitlistEntry\(entry, \{ confirmed: true \}\)/);

  // Client: cancel the visit, leave the waiting list (which asked nothing before).
  assert.match(home, /confirmLabel="Na pewno odwołać\?"\s+onConfirm=\{\(\) => void cancelClientAppointment\(selectedClientAppointment\.id\)\}/);
  assert.match(home, /confirmLabel="Na pewno wypisać\?"\s+onConfirm=\{\(\) => void leaveClientWaitlist\(activeClientWaitlistEntry\)\}/);

  // Without `confirmed`, each handler still opens its dialog (other screens and the reminder's "Odwołuję" use them).
  for (const handler of ["declineAdminAppointment", "refuseClientRescheduledAppointment", "removeAdminWaitlistEntry", "markAdminAppointmentNoShow"]) {
    const start = home.indexOf(`const ${handler} = async`);
    assert.ok(start > 0, handler);
    assert.match(home.slice(start, start + 500), /if \(!confirmed && !\(await confirmAction\(/, handler);
  }
});
