import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("header sign-in never opens the booking wizard, so login lands on the salon home", () => {
  const salon = read("app/components/salon-home.tsx");
  const home = read("app/booking-home.tsx");
  assert.match(salon, /onClick=\{props\.onLogin \?\? \(\(\) => props\.onBook\(\)\)\}>Zaloguj się/);
  const handler = home.match(/onLogin=\{\(\) => \{([\s\S]*?)\n      \}\}/)?.[1] ?? "";
  assert.match(handler, /setWizardOpen\(false\)/);
  assert.doesNotMatch(handler, /setWizardOpen\(true\)/);
});

test("returning to the salon from the login screen clears a stale wizard", () => {
  const home = read("app/booking-home.tsx");
  assert.match(home, /onBackToSalon=\{\(\) => \{ setWizardOpen\(false\); setSalonOpen\(true\); \}\}/);
  assert.match(read("app/components/screens/auth-screen.tsx"), /onClick=\{onBackToSalon\}>‹ Strona salonu/);
});

test("the public salon page stays visible while the session is being verified", () => {
  const home = read("app/booking-home.tsx");
  const loader = home.indexOf("if (!authReady || (activeUser && !sessionReady))");
  assert.ok(loader > 0);
  assert.match(home.slice(loader, loader + 700), /return salonHomeView;/);
});
