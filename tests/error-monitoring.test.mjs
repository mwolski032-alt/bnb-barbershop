import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  diagnosticFingerprint,
  normalizeClientErrorReport,
  normalizeDiagnosticRoute,
  redactDiagnosticText,
} from "../shared/error-monitoring.mjs";

test("mobile diagnostics removes contact details, tokens and URL parameters", () => {
  const value = redactDiagnosticText(
    "Jan jan@example.com +48 501 234 567 Bearer secret.jwt.value https://bnb.test/?token=abc&name=Jan",
  );
  assert.doesNotMatch(value, /jan@example|501 234|secret\.jwt|token=abc|name=Jan/i);
  assert.match(value, /\[e-mail\]/);
  assert.match(value, /\[telefon\]/);
  assert.equal(normalizeDiagnosticRoute("https://bnb.test/panel?email=jan@example.com#private"), "/panel");
});

test("mobile diagnostics accepts only a small allowlist of anonymous device fields", () => {
  const report = normalizeClientErrorReport({
    type: "network",
    message: "POST /appointments: HTTP 503",
    route: "/?phone=501234567",
    screen: "rezerwacja-krok-4",
    deviceId: "random-installation-id",
    userId: "must-not-survive",
    email: "must-not-survive@example.com",
    device: {
      os: "Android 15",
      browser: "Chrome 152",
      viewport: "390x844",
      installed: true,
      online: true,
      connection: "4g",
      phone: "501234567",
    },
  });
  assert.equal(report.route, "/");
  assert.equal(report.type, "network");
  assert.deepEqual(Object.keys(report.device).sort(), ["browser", "connection", "installed", "online", "os", "viewport"].sort());
  assert.equal("userId" in report, false);
  assert.equal("email" in report, false);
  assert.equal("phone" in report.device, false);
});

test("fingerprints group the same failure and separate releases", () => {
  const report = normalizeClientErrorReport({ type: "javascript", message: "Boom", route: "/" });
  assert.equal(diagnosticFingerprint(report, "release-a"), diagnosticFingerprint(report, "release-a"));
  assert.notEqual(diagnosticFingerprint(report, "release-a"), diagnosticFingerprint(report, "release-b"));
});

test("monitoring endpoint is owner-only for reading and never opens Firebase rules", async () => {
  const [handler, rules, layout, bookingHome] = await Promise.all([
    readFile(new URL("../netlify/functions/client-errors.mjs", import.meta.url), "utf8"),
    readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
  ]);
  const parsedRules = JSON.parse(rules);
  assert.equal(parsedRules.rules.clientErrorReports[".read"], false);
  assert.equal(parsedRules.rules.clientErrorReports[".write"], false);
  assert.match(handler, /context\.isOwner && context\.active/);
  assert.match(handler, /Origin not allowed/);
  assert.match(handler, /maxReportsPerWindow = 12/);
  assert.match(handler, /path: "\/api\/client-errors"/);
  assert.match(handler, /aggregateBy: \["ip", "domain"\]/);
  assert.match(layout, /<ClientErrorMonitor>/);
  assert.match(bookingHome, /ownerPanelTab === "errors"/);
  assert.match(bookingHome, />\s*Błędy\s*</);
});
