import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const motion = read("app/motion.css");
const admin = motion.slice(motion.indexOf("Admin panels (barber and owner)"), motion.indexOf("Less motion"));

test("admin animations exist and sit before the reduced-motion block", () => {
  assert.ok(admin.length > 500);
  assert.ok(motion.indexOf("Admin panels") < motion.indexOf("Less motion"));
  assert.match(motion.slice(motion.indexOf("Less motion")), /prefers-reduced-motion: reduce/);
});

test("analytics bars and meters grow from their baseline only when their tab is active", () => {
  assert.match(admin, /\.admin-tab-panel\.active \.analytics-bar-track span \{ transform-origin: bottom center; animation: motion-grow-y/);
  assert.match(admin, /\.admin-tab-panel\.active \.analytics-service-meter span \{ transform-origin: left center; animation: motion-grow-x/);
  // A stagger rule must be at least as specific as the animation it delays, or it is silently ignored.
  assert.match(admin, /\.admin-tab-panel\.active \.analytics-kpi-grid > :nth-child\(2\) \{ animation-delay: 60ms; \}/);
  assert.match(admin, /\.admin-tab-panel\.active \.analytics-bar-column:nth-child\(2\) \.analytics-bar-track span \{ animation-delay/);
  assert.doesNotMatch(admin, /\.analytics-bar-column:nth-child\([^)]*\) \.admin-tab-panel/);
});

test("list rows rise in sequence and hover lift is limited to devices with a pointer", () => {
  assert.match(admin, /\.mobile-agenda-appointment[\s\S]*animation: motion-rise/);
  assert.match(admin, /\.client-directory-list[\s\S]*> :nth-child\(3\) \{ animation-delay: 90ms; \}/);
  assert.match(admin, /@media \(hover: hover\) \{[\s\S]*translateY\(-2px\)/);
});

test("pressing a daily control gives tactile feedback without disabling it", () => {
  assert.match(admin, /:active:not\(:disabled\) \{\s*transform: scale\(\.97\);/);
});

test("the client search placeholder fits a phone screen", () => {
  const screen = read("app/components/screens/admin-clients-screen.tsx");
  const placeholder = screen.match(/placeholder="(Szukaj[^"]+)"/)?.[1] ?? "";
  assert.ok(placeholder.length > 0 && placeholder.length <= 34, placeholder);
});
