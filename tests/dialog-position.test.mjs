import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("no salon dialog overrides the browser's fixed position, so it opens in the middle of the screen wherever the page is scrolled", async () => {
  const css = await readFile(new URL("../app/salon.css", import.meta.url), "utf8");
  // A positioned dialog is placed against the whole page, not the screen: the reviews window used to open
  // far below or above what the visitor was looking at.
  const dialogRules = css.split("\n").filter((line) => /^\.[\w.-]*(dialog)[\w.-]*\s*\{/.test(line) && !/\.salon-dialog-content/.test(line.split("{")[0]));
  assert.ok(dialogRules.length > 0);
  for (const rule of dialogRules) {
    assert.doesNotMatch(rule.split("{")[1] ?? "", /(^|[\s;])position\s*:/, rule.slice(0, 80));
  }
});

test("on a wide screen the admin top bar has no panel of its own and the barber pill sits in the same row, flush right", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const wide = css.slice(css.indexOf("@media (min-width: 1200px)"));
  // The bar must beat the paper surface rule (which also targets .admin-topbar) to stay transparent on the rounded panel.
  assert.match(wide, /\.app-shell \.admin-view > \.admin-topbar \{[^}]*background: transparent;/);
  const pill = /\.selected-barber-context \{([^}]*)\}/.exec(wide.slice(wide.indexOf("The barber pill")))[1];
  assert.match(pill, /grid-row: 1;/);
  assert.match(pill, /justify-self: end;/);
  assert.match(pill, /align-self: center;/);
  assert.doesNotMatch(pill, /position: absolute|right: 5\.2rem/);
});
