import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("robots.txt is valid, keeps private endpoints out of search and points to the sitemap", () => {
  const robots = read("public/robots.txt");
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/\.netlify\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/bnbbarber\.netlify\.app\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /<html/i, "a missing robots.txt used to fall back to the app's HTML");
});

test("the sitemap lists the public page only", () => {
  const sitemap = read("public/sitemap.xml");
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), ["https://bnbbarber.netlify.app/"]);
});

test("the brand colour pairs used for text keep WCAG AA contrast", () => {
  const theme = read("app/theme.css");
  const colour = name => theme.match(new RegExp(`--color-${name}: (#[0-9A-Fa-f]{6});`))?.[1];
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + 0.05) / (low + 0.05); };
  const pairs = [
    ["text", "background", 4.5], ["text-secondary", "background", 4.5], ["text-secondary", "surface", 4.5],
    ["primary", "background", 4.5], ["surface", "primary", 4.5], ["surface", "error", 4.5],
    ["error", "error-soft", 4.5], ["success", "success-soft", 4.5], ["warning", "warning-soft", 4.5],
    ["secondary", "background", 3],
  ];
  for (const [foreground, background, minimum] of pairs) {
    assert.ok(colour(foreground) && colour(background), `${foreground}/${background}`);
    assert.ok(ratio(colour(foreground), colour(background)) >= minimum, `${foreground} on ${background}`);
  }
});
