import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ERROR_TYPE_LABELS, formatErrorReportsText } from "../shared/error-report-text.mjs";

const report = (overrides = {}) => ({
  id: "r1",
  type: "javascript",
  message: "Cannot read properties of undefined (reading 'map')",
  stack: ["TypeError: x", "at a (app.js:1:1)", "at b (app.js:2:2)", "at c", "at d", "at e", "at f", "at g"].join("\n"),
  route: "/",
  screen: "admin",
  release: "0123456789abcdef",
  count: 3,
  firstSeenAt: Date.parse("2026-10-20T08:00:00Z"),
  lastSeenAt: Date.parse("2026-10-23T12:30:00Z"),
  resolvedAt: null,
  device: { browser: "Chrome 141", os: "Android 15", viewport: "412x915", installed: true, online: true, connection: "4g" },
  ...overrides,
});

test("the copied text lists every error with what is needed to find the cause, most frequent first", () => {
  const text = formatErrorReportsText(
    [report({ id: "rare", message: "Rzadki", count: 1 }), report({ id: "often", message: "Częsty", count: 9, type: "network" })],
    { now: Date.parse("2026-10-24T09:00:00Z") },
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "Błędy aplikacji BNB (aktywne), stan na 24.10.2026, 11:00");
  assert.equal(lines[1], "Zgłoszeń: 2, wystąpień: 10");
  assert.ok(text.indexOf("1. [Połączenie z serwerem] 9×") < text.indexOf("2. [Błąd aplikacji] 1×"));
  assert.ok(text.indexOf("Treść: Częsty") < text.indexOf("Treść: Rzadki"));
  assert.match(text, /Urządzenie: Android 15, Chrome 141, 412x915, zainstalowana aplikacja, 4g/);
  assert.match(text, /Ekran: admin, adres: \//);
  assert.match(text, /Pierwszy raz: 20\.10\.2026, 10:00, ostatni raz: 23\.10\.2026, 14:30, wersja: 01234567/);
});

test("the stack is cut to its first lines and a resolved error is marked", () => {
  const text = formatErrorReportsText([report({ resolvedAt: 1 })], { scope: "wszystkie" });
  assert.match(text, /\(wszystkie\)/);
  assert.match(text, /1\. \[Błąd aplikacji\] 3× \(rozwiązany\)/);
  assert.ok(text.includes("at e"));
  assert.ok(!text.includes("at f"));
  assert.ok(!formatErrorReportsText([report({ stack: "" })]).includes("Ślad:"));
});

test("an empty list and a few missing fields still give readable text", () => {
  assert.match(formatErrorReportsText([]), /Zgłoszeń: 0, wystąpień: 0/);
  const sparse = formatErrorReportsText([{ type: "weird", message: "x", count: 1 }]);
  assert.match(sparse, /\[Błąd aplikacji\] 1×/);
  assert.match(sparse, /Pierwszy raz: brak/);
  assert.deepEqual(Object.keys(ERROR_TYPE_LABELS).sort(), ["javascript", "network", "promise", "react", "resource"]);
});

test("the monitor has a copy button next to refresh that copies what the list shows", async () => {
  const panel = await readFile(new URL("../app/components/error-monitoring-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /formatErrorReportsText\(visibleReports, \{ scope: showResolved \? "wszystkie" : "aktywne" \}\)/);
  assert.match(panel, /Kopiuj błędy/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /document\.execCommand\("copy"\)/);
  assert.ok(panel.indexOf("Kopiuj błędy") < panel.indexOf("Odśwież"));
});
