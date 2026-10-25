import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the account profile is private to its owner and its fields are validated", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.clientProfiles.$uid;
  assert.match(rules[".read"], /auth\.uid === \$uid/);
  assert.match(rules[".write"], /auth\.uid === \$uid/);
  assert.equal(rules.$other[".validate"], false);
  assert.match(rules.phone[".validate"], /\[0-9\]\{9\}/);
  assert.match(rules.photoUrl[".validate"], /<= 60000/);
  assert.ok(rules.photoUrl[".validate"].includes("data:image\\/webp;base64"), "only WebP data URLs");
});

test("the account dialog shows the e-mail read-only and keeps phone and name editable", () => {
  const dialog = read("app/components/client-account.tsx");
  assert.match(dialog, /className="account-readonly"/);
  assert.doesNotMatch(dialog, /<input[^>]*value=\{props\.email\}/);
  assert.match(dialog, /autoComplete="tel"/);
  assert.match(dialog, /autoComplete="name"/);
});

test("a picture chosen in the account replaces the Google one wherever a barber sees the client", () => {
  const server = read("netlify/functions/appointments.mjs");
  assert.match(server, /readDatabase\("clientPhotoVersions", accessToken\)/);
  assert.match(server, /\/api\/client-photo\//);
});

test("the salon page opens the account from the account pill and books with the favourite barber", () => {
  const home = read("app/components/salon-home.tsx");
  assert.match(home, /className="salon-account-open"/);
  assert.match(home, /props\.onBook\(favoriteId && barbers\.some/);
});

test("signing out lives in the account dialog and the pill tells people it opens their account", () => {
  const dialog = read("app/components/client-account.tsx");
  assert.match(dialog, /className="account-logout"/);
  const home = read("app/components/salon-home.tsx");
  // With an account panel the home page has no sign-out button of its own; only the owner (no panel) keeps one.
  const withPanel = home.slice(home.indexOf('props.accountPanel\n'), home.indexOf("</>}", home.indexOf('props.accountPanel\n')));
  assert.match(withPanel, /salon-account-cta/);
  assert.match(withPanel, /bnb-account-hint|dismissHint/);
  assert.match(home, /localStorage\.setItem\("bnb-account-hint", "1"\)/);
});

test("the profile picture is cropped by the client and never tinted", () => {
  const dialog = read("app/components/client-account.tsx");
  assert.match(dialog, /<PhotoCropDialog/);
  assert.match(dialog, /shrinkAvatar\(cropped\)/);
  const css = read("app/client-account.css");
  assert.doesNotMatch(css, /hue-rotate\(360deg\)/, "the picture must not change colour");
  assert.match(css, /\.account-avatar::after \{[^}]*animation: account-ring/, "only the ring layer turns");
});

test("the phone typed for a first booking is saved to the account once", () => {
  const hook = read("app/hooks/use-client-account.ts");
  assert.match(hook, /bnb-phone-synced:/);
  assert.match(hook, /saveClientProfile\(uid, \{ \.\.\.profile, phone: knownPhone \}\)/);
});

test("the owner's account switcher sits first in the home page menu, for owner and paired accounts only", () => {
  assert.match(read("app/components/salon-home.tsx"), /<nav aria-label="Menu główne">\s*\{props\.admin && <AccountSwitcher \/>\}/);
  assert.match(read("netlify/functions/account-switch.mjs"), /if \(!group\.isOwner\) return jsonResponse\(\{ error: "Only the owner can link accounts" \}, 403\)/);
});
