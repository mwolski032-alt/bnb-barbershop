import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GALLERY_BARBER_PATTERN, GALLERY_MAX_PHOTOS } from "../shared/gallery-images.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const rules = JSON.parse(read("database.rules.json")).rules.shopfront.gallery;
const slashRegex = (expression) => {
  const match = /\.matches\(\/(.+?)\/\)/.exec(expression);
  assert.ok(match, expression);
  return new RegExp(match[1].replaceAll("\\\\", "\\"));
};

test("the gallery holds at least twenty photos and the database rules agree with the app", () => {
  assert.ok(GALLERY_MAX_PHOTOS >= 20);
  const idRule = slashRegex(rules.$imageId[".validate"]);
  for (let id = 0; id < GALLERY_MAX_PHOTOS; id += 1) assert.ok(idRule.test(String(id)), `record ${id}`);
  for (const id of [String(GALLERY_MAX_PHOTOS), "-1", "01", "a", ""]) assert.ok(!idRule.test(id), `record ${id}`);
  assert.match(rules.$imageId.order[".validate"], new RegExp(`<= ${GALLERY_MAX_PHOTOS - 1}\\b`));
});

test("a photo may name the barber who did the haircut, and nothing else is accepted there", () => {
  const rule = rules.$imageId.barberId[".validate"];
  assert.match(rule, /newData\.isString\(\)/);
  const allowed = slashRegex(rule);
  assert.equal(allowed.source, GALLERY_BARBER_PATTERN.source);
  for (const good of ["mateusz", "kacper", "barber_2", "a-b"]) assert.ok(allowed.test(good), good);
  for (const bad of ["", "has space", "a/b", "../x", "x".repeat(81), "$x"]) assert.ok(!allowed.test(bad), bad);
  // The record still rejects unknown fields.
  assert.equal(rules.$imageId.$other[".validate"], false);
});

test("the owner picks the barber when adding a photo or later, and an unassigned photo stays as before", () => {
  const manager = read("app/components/salon-manager.tsx");
  assert.match(manager, /GALLERY_MAX_PHOTOS/);
  assert.doesNotMatch(manager, /> 6\b|>= 6\b|\/6\b/);
  assert.match(manager, /\.\.\.\(uploadBarberId \? \{ barberId: uploadBarberId \} : \{\}\)/);
  assert.match(manager, /delete rest\.barberId/);
  assert.match(manager, /Bez przypisania/);
  const home = read("app/components/salon-home.tsx");
  assert.match(home, /barbers\.find\(barber => barber\.id === photo\.barberId\)\?\.displayName \?\? ""/);
  assert.match(home, /photoBarber\(photo\) \? `Barber: \$\{photoBarber\(photo\)\}` : ""/);
  assert.match(read("app/components/gallery-lightbox.tsx"), /\{text && <p className="lightbox-caption">/);
});
