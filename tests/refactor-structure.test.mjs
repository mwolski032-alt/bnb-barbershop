import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("app/booking-home.tsx");

test("helpers extracted from the former monolith live in their own focused modules", () => {
  const modules = {
    "app/lib/booking-labels.ts": /export const adminSectionLabels/,
    "app/lib/booking-format.ts": /export const formatDuration/,
    "app/lib/calendar-export.ts": /export const buildCalendarEvent/,
    "app/lib/client-sms.ts": /export const buildClientSmsMessage/,
    "app/lib/availability-helpers.ts": /export const buildCalendarDays/,
    "app/lib/team-normalizers.ts": /export const normalizeTeamMember/,
    "app/lib/view-memory.ts": /export const readViewMemory/,
    "app/lib/google-redirect.ts": /export const signInWithGoogleRedirect/,
    "app/components/install-guide-dialog.tsx": /export default InstallGuideDialog/,
    "app/components/screens/auth-screen.tsx": /export function LoginScreen/,
    "app/components/screens/success-screen.tsx": /export default function SuccessScreen/,
  };
  for (const [file, pattern] of Object.entries(modules)) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
    assert.match(read(file), pattern, file);
  }
});

test("booking-home no longer declares what it now imports", () => {
  for (const name of ["formatDuration", "buildCalendarEvent", "readViewMemory", "InstallGuideDialog", "normalizeTeamMember"]) {
    assert.doesNotMatch(home, new RegExp(`^(export )?(async )?(function|const) ${name}\\b`, "m"), name);
  }
  assert.ok(home.split("\n").length < 7500, "the main file should keep shrinking, not grow back");
});

test("every panel modal is wrapped so it can fade out instead of vanishing", () => {
  const wrapped = (home.match(/<ModalPresence>/g) ?? []).length;
  assert.equal(wrapped, (home.match(/<\/ModalPresence>/g) ?? []).length);
  assert.equal(wrapped, (home.match(/className=\{?[`"]client-modal-backdrop/g) ?? []).length);
  assert.ok(wrapped >= 11);
});

test("ModalPresence compares children as passed, never re-created copies", () => {
  const source = read("app/components/modal-presence.tsx");
  // Children.toArray returns fresh clones every call, which made the render loop forever (React error 301).
  assert.doesNotMatch(source, /Children\.toArray/);
  assert.match(source, /const current = children \|\| null;/);
  assert.match(source, /data-leaving=\{leaving \|\| undefined\}/);
  const css = read("app/motion.css");
  assert.match(css, /\.modal-presence\[data-leaving\] > \.client-modal-backdrop \{[^}]*pointer-events: none/);
  assert.match(css, /\.modal-presence \{ display: contents; \}/);
});

test("dead CSS stays out: no rule targets a class that no source file uses", () => {
  const css = read("app/globals.css");
  for (const dead of ["work-hero", "vacation-card", "work-metrics", "work-week-strip", "vacation-chip-list"]) {
    assert.doesNotMatch(css, new RegExp(`\\.${dead}\\b`), dead);
  }
});
