import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const sourceFiles = (dir) => readdirSync(new URL(dir, root)).flatMap(name => {
  const path = join(dir, name);
  return statSync(new URL(path, root)).isDirectory() ? sourceFiles(path) : /\.(tsx?|mjs)$/.test(name) ? [path] : [];
});

test("the app never uses the browser's own confirm or alert boxes", () => {
  for (const file of sourceFiles("app")) {
    assert.doesNotMatch(read(file), /window\.(confirm|alert)\(/, file);
  }
});

test("destructive admin actions ask through the in-app dialog and wait for the answer", () => {
  const home = read("app/booking-home.tsx");
  // Includes disabling a barber account, removing someone from the waitlist and refusing a client's new term.
  assert.equal((home.match(/await confirmAction\(/g) ?? []).length, 7);
  const manager = read("app/components/salon-manager.tsx");
  assert.match(manager, /await confirmAction\(\{ title: "Usunąć zdjęcie z galerii\?"/);
  const lib = read("app/lib/confirm-action.tsx");
  assert.match(lib, /Esc, backdrop and Cancel resolve false/);
  assert.match(lib, /let answer = false/);
  assert.doesNotMatch(lib, /autoFocus/, "a destructive confirm must not steal Enter");
});

test("the photo viewer supports keyboard, swipe and buttons without swallowing vertical scroll", () => {
  const viewer = read("app/components/gallery-lightbox.tsx");
  assert.match(viewer, /ArrowRight/);
  assert.match(viewer, /ArrowLeft/);
  assert.match(viewer, /Math\.abs\(dx\) >= SWIPE_DISTANCE && Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.4/);
  assert.match(viewer, /aria-label="Poprzednie zdjęcie"/);
  assert.match(viewer, /aria-label="Następne zdjęcie"/);
  assert.match(read("app/salon.css"), /\.lightbox-stage \{[^}]*touch-action: pan-y pinch-zoom/);
  const home = read("app/components/salon-home.tsx");
  assert.match(home, /<GalleryLightbox photos=\{gallery\}/);
  assert.doesNotMatch(home, /setImage\(/);
});

test("on desktop the booking button sits beside the photo instead of below the fold", () => {
  const css = read("app/salon.css");
  assert.match(css, /@media \(min-width: 960px\) \{\s*\.salon-cover \{ display: grid;[^}]*grid-template-areas: "copy media"/);
});

test("empty and failed states are styled as content and offer a retry", () => {
  const css = read("app/salon.css");
  assert.match(css, /\.salon-empty \{[^}]*border: 1px dashed/);
  assert.match(read("app/components/salon-home.tsx"), /Spróbuj ponownie/);
});

test("the booking calendar marks today and tints the selected choice", () => {
  assert.match(read("app/components/booking-wizard.tsx"), /key === todayKey \? "today" : ""/);
  const css = read("app/booking-wizard.css");
  assert.match(css, /\.story-days button\.today > span/);
  assert.match(css, /\.story-barber\.selected, \.booking-story \.story-service\.selected \{ background: var\(--color-primary-soft\)/);
});
