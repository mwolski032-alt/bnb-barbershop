import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("pictures cannot be dragged out of the page or saved from the right-click or long-press menu", async () => {
  const guard = await read("app/components/image-guard.tsx");
  assert.match(guard, /addEventListener\("dragstart", stop, true\)/);
  assert.match(guard, /addEventListener\("contextmenu", stop, true\)/);
  assert.match(guard, /closest\("img, picture, canvas"\)/);
  assert.match(guard, /removeEventListener\("dragstart", stop, true\)/);
  assert.match(await read("app/layout.tsx"), /<ImageGuard \/>/);

  const css = await read("app/globals.css");
  // Declared after the @import lines: a rule in front of an import would make the import invalid.
  const lastImport = css.lastIndexOf("@import");
  const rule = css.indexOf("\nimg {\n  -webkit-user-drag: none;");
  assert.ok(rule > lastImport, "the img rule must come after every @import");
  assert.match(css.slice(rule, rule + 200), /-webkit-touch-callout: none;/);
  assert.match(css.slice(rule, rule + 200), /user-select: none;/);
});

test("only pictures are guarded: the calendar's draggable appointments keep working", async () => {
  const guard = await read("app/components/image-guard.tsx");
  assert.doesNotMatch(guard, /draggable|\[draggable|closest\("\*"\)/);
  assert.match(await read("app/components/screens/admin-calendar-screen.tsx"), /draggable=\{!props\.isTouchDevice && appointmentIsEditable\}/);
});
