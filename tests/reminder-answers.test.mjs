import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the service worker shows both answers on a reminder and passes the chosen one to the app", async () => {
  const worker = await read("public/sw.js");
  assert.match(worker, /data\.actions === "attend"/);
  assert.match(worker, /action: "confirm", title: "Potwierdzam"/);
  assert.match(worker, /action: "cancel", title: "Odwołuję"/);
  assert.match(worker, /answerButtons/);
  assert.match(worker, /searchParams\.set\("reminder", event\.action\)/);
  // The token-based confirmation of a moved visit still takes precedence over the reminder answers.
  assert.ok(worker.indexOf("confirmActionToken) {") < worker.indexOf("notification.data?.answerButtons &&"));
});

test("only the visit reminder asks for an answer", async () => {
  const service = await read("netlify/functions/_notification-service.mjs");
  assert.match(service, /event === "appointment_reminder" && device\.audience === "client" \? "attend" : ""/);
  assert.match(service, /\.\.\.\(answerButtons \? \{ actions: answerButtons \} : \{\}\)/);
});

test("the app carries out the answer once the visit is loaded for the signed-in client", async () => {
  const links = await read("app/hooks/use-push-link-actions.ts");
  assert.match(links, /params\.get\("event"\) === "reminder"/);
  assert.match(links, /if \(answer\.action === "cancel"\) onCancel\(visit\.id\);/);
  assert.match(links, /else if \(visit\.status === "confirmed"\) onAttend\(visit\.id\);/);
  const home = await read("app/booking-home.tsx");
  assert.match(home, /useReminderAnswer\(\{/);
  assert.match(home, /url\.searchParams\.delete\("reminder"\)/);
});

test("the barber sees who vouched for the visit", async () => {
  const agenda = await read("app/components/screens/admin-agenda-screen.tsx");
  assert.match(agenda, /attendanceConfirmedAt\) return \{ key: "idle", label: "Klient potwierdził" \}/);
});
