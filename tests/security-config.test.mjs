import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Firebase rules deny root access and keep client records admin-only", async () => {
  const rules = JSON.parse(await readFile(new URL("../database.rules.json", import.meta.url), "utf8"));
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.match(rules.rules.appointments[".read"], /team\/owner\/userId/);
  assert.equal(rules.rules.clients[".read"], false);
  assert.equal(rules.rules.appointmentSync.revision[".read"], "auth != null");
  assert.equal(rules.rules.appointmentSync.revision[".write"], false);
  assert.equal(
    rules.rules.appointmentSync.users.$uid[".read"],
    "auth != null && auth.uid === $uid",
  );
  assert.equal(rules.rules.appointmentSync.users.$uid[".write"], false);
  assert.equal(rules.rules.appointmentSync.barbers.$barberId[".read"], "auth != null");
  assert.equal(rules.rules.appointmentSync.barbers.$barberId[".write"], false);
  assert.equal(rules.rules.notificationTokens.$uid[".read"], "auth != null && auth.uid === $uid");
  assert.equal(rules.rules.notificationTokens.$uid[".write"], "auth != null && auth.uid === $uid");
  assert.equal(rules.rules.notificationOutbox[".read"], false);
  assert.equal(rules.rules.clientErrorReports[".read"], false);
  assert.equal(rules.rules.clientErrorReports[".write"], false);
  for (const section of ["appointments", "clients", "waitlistEntries", "appointmentSync", "appointmentOperations", "notificationOutbox"]) {
    const guard = rules.rules[section][".write"];
    assert.match(guard, /auth\.uid === 'bnb-schedule-writer'/);
    assert.match(guard, /auth\.token\.bnbScheduleWriter === true/);
    assert.match(guard, /auth\.token\.lockOwner === root\.child\('systemLocks\/appointments\/owner'\)\.val\(\)/);
    assert.match(guard, /root\.child\('systemLocks\/appointments\/expiresAt'\)\.val\(\) > now/);
  }
  assert.deepEqual(rules.rules.notificationOutbox[".indexOn"], ["nextAttemptAt"]);
  assert.equal(rules.rules.appointmentOperations[".read"], false);
  assert.equal(rules.rules.inAppNotifications, undefined);
});

test("Netlify production build is blocked by the complete quality gate", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["build:netlify"], "npm run verify");
  assert.match(packageJson.scripts.verify, /npm run typecheck/);
  assert.match(packageJson.scripts.verify, /npm run lint/);
  assert.match(packageJson.scripts.verify, /npm run build/);
  assert.match(packageJson.scripts.verify, /npm run test:unit/);
});

test("GitHub checks the application, Lighthouse and Firebase rules before changes are accepted", async () => {
  const [workflow, lighthouseConfig] = await Promise.all([
    readFile(new URL("../.github/workflows/quality-gate.yml", import.meta.url), "utf8"),
    readFile(new URL("../.lighthouserc.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /run: npm run verify/);
  assert.match(workflow, /run: npm run verify:lighthouse/);
  assert.match(workflow, /java-version: "21"/);
  assert.match(workflow, /run: npm run test:rules/);
  assert.match(lighthouseConfig, /"categories:performance"/);
  assert.match(lighthouseConfig, /"categories:accessibility"/);
  assert.match(lighthouseConfig, /"cumulative-layout-shift"/);
});

test("Firebase service account requests every required REST scope", async () => {
  const adminSource = await readFile(
    new URL("../netlify/functions/_firebase-admin.mjs", import.meta.url),
    "utf8",
  );
  assert.match(adminSource, /https:\/\/www\.googleapis\.com\/auth\/userinfo\.email/);
  assert.match(adminSource, /https:\/\/www\.googleapis\.com\/auth\/firebase\.database/);
});
