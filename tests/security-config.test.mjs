import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Firebase rules deny root access and keep client records admin-only", async () => {
  const rules = JSON.parse(await readFile(new URL("../database.rules.json", import.meta.url), "utf8"));
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.match(rules.rules.appointments[".read"], /xkyDu2Lb1Ma8McF7yfyv8PIAj1M2/);
  assert.match(rules.rules.clients[".read"], /team\/barbers\/mateusz/);
  assert.equal(rules.rules.inAppNotifications, undefined);
});

test("Netlify production build contains a mandatory typecheck", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts["build:netlify"], /npm run typecheck/);
});

test("Firebase service account requests every required REST scope", async () => {
  const adminSource = await readFile(
    new URL("../netlify/functions/_firebase-admin.mjs", import.meta.url),
    "utf8",
  );
  assert.match(adminSource, /https:\/\/www\.googleapis\.com\/auth\/userinfo\.email/);
  assert.match(adminSource, /https:\/\/www\.googleapis\.com\/auth\/firebase\.database/);
});
