import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const theme = read("app/theme.css");
const palette = {
  background: "F6EBD7", surface: "FBF4E7", "surface-secondary": "F1E4CF",
  primary: "014241", "primary-hover": "013634", "primary-active": "012E2D", "primary-soft": "D8E5DF",
  secondary: "AB0082", "secondary-hover": "8F006D", "secondary-soft": "F3D9EA",
  text: "14211E", "text-secondary": "625F57", "text-muted": "8A8479",
  border: "D8C8AD", "border-strong": "BFAE91", "disabled-bg": "DDD5C8", "disabled-text": "958F85",
};

test("paper palette and global serif typography have a single source of truth", () => {
  for (const [name, hex] of Object.entries(palette)) assert.ok(theme.includes(`--color-${name}: #${hex};`), name);
  assert.match(theme, /--font-app: "Sitka Heading", Sitka, Georgia, serif;/);
  for (const file of ["app/globals.css", "app/paper-components.css"]) {
    const css = read(file);
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, file);
    assert.doesNotMatch(css, /color-scheme:\s*dark|backdrop-filter:\s*blur/);
    for (const match of css.matchAll(/font-family:\s*([^;]+);/g)) assert.match(match[1], /^(?:var\(--font-app\)|inherit)$/);
  }
});

test("PWA launches on paper with dark system icons and safe area", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.background_color, `#${palette.background}`);
  assert.equal(manifest.theme_color, `#${palette.background}`);
  assert.match(read("app/layout.tsx"), /themeColor: "#F6EBD7"/);
  assert.match(read("app/layout.tsx"), /statusBarStyle: "default"/);
  assert.doesNotMatch(read("app/layout.tsx"), /prefers-color-scheme/);
  assert.match(read("app/layout.tsx"), /viewportFit: "cover"/);
  assert.match(read("app/layout.tsx"), /colorScheme: "light"/);
  assert.match(read("app/layout.tsx"), /import "\.\/paper-components.css"/);
});

test("booking and admin refinements keep important details visible", () => {
  const components = read("app/paper-components.css");
  assert.match(components, /\.topbar-logo-mark\s*\{[^}]*background:\s*var\(--color-brand-black\)/s);
  assert.match(components, /\.home-hero::after\s*\{\s*display:\s*none/);
  assert.match(components, /\.service-card b\s*\{\s*color:\s*var\(--color-on-primary\)/);
  assert.match(components, /button\.active small\s*\{[^}]*color:\s*var\(--color-text\)/s);
  assert.match(components, /\.profile-avatar\.selected-barber-avatar\s*\{[^}]*aspect-ratio:\s*1 \/ 1/s);
  assert.match(components, /\.nearest-slot-button:active:not\(:disabled\)/);
  assert.match(components, /\.admin-bottom-nav button\s*\{\s*border-radius:\s*999px/);
  assert.match(components, /\.analytics-period-control button\s*\{\s*border-radius:\s*999px/);
  assert.match(components, /\.availability-month-toggle\s*\{\s*border:\s*0/);
  assert.match(components, /Composite search fields own the only visible focus ring/);
});

function luminance(hex) {
  const values = hex.match(/../g).map(part => parseInt(part, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
test("body, supporting text, primary actions and semantic messages meet AA contrast", () => {
  for (const [foreground, background] of [
    [palette.text, palette.background], [palette["text-secondary"], palette.surface],
    [palette.surface, palette.primary], [palette.surface, palette["primary-hover"]],
    [palette.surface, palette["primary-active"]], ["923C32", "F4E0D9"], ["80521C", "F3E6CC"], ["245C42", "E2EBDD"],
  ]) {
    const a = luminance(foreground), b = luminance(background);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground} on ${background}`);
  }
});
