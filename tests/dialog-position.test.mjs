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
