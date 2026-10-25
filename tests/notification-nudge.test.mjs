import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the nudge opens our own dialog and only a tap asks the browser for permission", () => {
  const hook = read("app/hooks/use-notification-nudge.ts");
  assert.doesNotMatch(hook, /requestPermission|registerPushNotifications/, "no browser prompt without a tap");
  assert.match(hook, /status === "disabled" \? "enable"/);
  assert.match(hook, /status === "blocked" \? "blocked"/);
  assert.match(hook, /sessionStorage\.setItem\(DISMISSED_KEY/, "\"later\" lasts until the app is closed");
  const home = read("app/booking-home.tsx");
  assert.match(home, /useNotificationNudge\(\{ ready: Boolean\(activeUser\) && !isOwner && sessionReady/);
  assert.match(home, /onEnable=\{\(\) => void handlePushDeviceToggle\(\)\}/);
});

test("a blocked or iPhone-without-app device gets instructions instead of a dead button", () => {
  const dialog = read("app/components/notification-nudge.tsx");
  assert.match(dialog, /UNBLOCK_STEPS/);
  assert.match(dialog, /Pokaż, jak zainstalować/);
  assert.match(dialog, /setTimeout\(onClose, 2000\)/, "celebrates, then closes by itself");
});

test("a client who books with notifications off is offered reminders for that visit", () => {
  const success = read("app/components/screens/success-screen.tsx");
  assert.match(success, /push\.status === "disabled"/);
  assert.match(success, /Chcesz dostać przypomnienie o tej wizycie\?/);
  assert.match(read("app/booking-home.tsx"), /<SuccessScreen[^>]*push=\{\{ status: pushDeviceStatus/);
});

test("the header chip is as tall as the logo", () => {
  const css = read("app/client-account.css");
  assert.match(css, /\.salon-header \{ --chip-height: 45px; \}/);
  assert.match(css, /\.salon-account-pill \{[^}]*height: var\(--chip-height\)/);
});
