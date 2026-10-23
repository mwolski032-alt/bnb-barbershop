import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const motion = read("app/motion.css");

test("motion stylesheet is loaded after the component styles that it refines", () => {
  const layout = read("app/layout.tsx");
  assert.ok(layout.indexOf('import "./motion.css"') > layout.indexOf('import "./booking-wizard.css"'));
});

test("every animation draws its timing from the shared tokens", () => {
  const theme = read("app/theme.css");
  for (const token of ["--ease-out", "--ease-spring", "--duration-fast", "--duration-base", "--duration-slow"]) {
    assert.ok(theme.includes(`${token}:`), token);
  }
  // Delays between siblings may be literal; every animation shorthand must still take its duration from a token.
  const declarations = [...motion.matchAll(/animation:\s*([^;]+);/g)].map(match => match[1]).filter(value => !value.startsWith("none"));
  assert.ok(declarations.length > 20);
  for (const declaration of declarations) assert.match(declaration, /var\(--duration-(fast|base|slow)\)|calc\(var\(--duration-slow\)/, declaration);
});

test("people who prefer reduced motion get no animation or transition", () => {
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: \.01ms !important/);
  assert.match(motion, /transition-duration: \.01ms !important/);
  assert.match(motion, /::view-transition-old\(\*\)/);
  assert.match(read("app/theme.css"), /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*--duration-base: 0ms/);
});

test("scroll reveal never hides content unless JavaScript marked the page ready", () => {
  assert.match(motion, /\.salon-home\.reveal-ready \[data-reveal\]:not\(\.is-visible\) \{ opacity: 0; \}/);
  assert.doesNotMatch(motion, /(^|\n)\[data-reveal\][^{]*\{[^}]*opacity: 0/);
  const hook = read("app/hooks/use-reveal.ts");
  assert.match(hook, /typeof IntersectionObserver === "undefined"\) return/);
  assert.ok(hook.indexOf("getBoundingClientRect") < hook.indexOf("observer.observe"));
});

test("dialogs play their exit animation before the parent unmounts them", () => {
  const dialog = read("app/components/salon-dialog.tsx");
  assert.match(dialog, /data-closing=\{closing \|\| undefined\}/);
  assert.match(dialog, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); requestClose\(\); \}\}/);
  assert.match(dialog, /reduced \? 0 : EXIT_MS/);
  assert.doesNotMatch(dialog, /onCancel=\{onClose\}|onClick=\{onClose\}/);
  assert.match(motion, /\.salon-dialog\[data-closing\] \{ animation: dialog-out/);
});

test("view transitions are feature-detected and skipped for reduced motion", () => {
  const helper = read("app/lib/view-transition.ts");
  assert.match(helper, /!doc\.startViewTransition \|\| window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(helper, /flushSync\(update\)/);
  const home = read("app/booking-home.tsx");
  for (const call of ["onBook", "onPanel", "onVisits", "onClose"]) assert.ok(home.includes("withViewTransition"), call);
});

test("wizard heading lives inside the keyed scene so a step never shows two headings", () => {
  const wizard = read("app/components/booking-wizard.tsx");
  const scene = wizard.indexOf('className="story-scene"');
  const heading = wizard.indexOf('className="story-heading"');
  assert.ok(scene > 0 && heading > scene);
  assert.doesNotMatch(wizard, /className="story-heading" key=/);
  assert.match(wizard, /data-direction=\{motion\.direction\}/);
});

test("salon page keeps its public data across remounts to avoid reloading it", () => {
  const home = read("app/components/salon-home.tsx");
  assert.match(home, /const shared = \{/);
  assert.match(home, /Date\.now\(\) - shared\.teamFetchedAt < TEAM_FRESH_MS/);
});
