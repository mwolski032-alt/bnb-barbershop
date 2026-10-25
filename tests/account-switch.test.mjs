import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_CLIENT_EMAIL = "svc@example.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\n");
const { createHandler } = await import("../netlify/functions/account-switch.mjs");

const USERS = {
  "owner-token": { localId: "owner-uid", email: "owner@example.com", displayName: "Mateusz W", photoUrl: "" },
  "barber-token": { localId: "barber-uid", email: "mateusz@example.com", displayName: "Mateusz", photoUrl: "" },
  "stranger-token": { localId: "stranger-uid", email: "x@example.com", displayName: "X", photoUrl: "" },
};

/** A tiny fake of Google sign-in lookup and the realtime database. */
function installFetch(db) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "token" });
    if (url.hostname === "identitytoolkit.googleapis.com") {
      const user = USERS[JSON.parse(init.body).idToken];
      return user ? Response.json({ users: [user] }) : new Response("{}", { status: 400 });
    }
    const path = decodeURIComponent(url.pathname).replace(/^\//, "").replace(/\.json$/, "");
    if ((init.method ?? "GET") === "PUT") {
      const body = JSON.parse(init.body);
      if (body === null) delete db[path]; else db[path] = body;
      return Response.json(body);
    }
    if (path === "team/owner") return Response.json({ userId: "owner-uid", active: true });
    if (path === "barbers/mateusz/profile") return Response.json({ displayName: "Mateusz W.", photoUrl: "data:image/webp;base64,BARBER" });
    if (path === "team/barbers") return Response.json({ mateusz: { name: "Mateusz", userId: "barber-uid", active: true } });
    if (path === "accountLinks") {
      const links = {};
      for (const [key, value] of Object.entries(db)) {
        const [, ownerUid, uid] = key.split("/");
        if (key.startsWith("accountLinks/")) (links[ownerUid] ??= {})[uid] = value;
      }
      return Response.json(Object.keys(links).length ? links : null);
    }
    return Response.json(null);
  };
  return () => { globalThis.fetch = original; };
}

const call = (token, body) =>
  createHandler()(new Request("https://bnb.example/api/account-switch", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
const uidOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).uid;

test("only the owner can pair accounts, and a pair needs a real sign-in to the second account", async () => {
  const db = {}; const restore = installFetch(db);
  try {
    assert.equal((await call("barber-token", { action: "link", linkToken: "owner-token" })).status, 403);
    assert.equal((await call("stranger-token", { action: "link", linkToken: "barber-token" })).status, 403);
    assert.equal((await call("owner-token", { action: "link", linkToken: "not-a-token" })).status, 400);
    assert.equal((await call("owner-token", { action: "link", linkToken: "owner-token" })).status, 400);
    assert.equal((await call("owner-token", { action: "link", linkToken: "barber-token" })).status, 200);
    assert.ok(db["accountLinks/owner-uid/barber-uid"]);
  } finally { restore(); }
});

test("a paired account is listed and switchable in both directions; strangers are refused", async () => {
  const db = {}; const restore = installFetch(db);
  try {
    await call("owner-token", { action: "link", linkToken: "barber-token" });
    const fromOwner = await (await call("owner-token", { action: "list" })).json();
    assert.equal(fromOwner.canLink, true);
    assert.deepEqual(fromOwner.accounts.map((account) => [account.uid, account.role, account.current]), [["owner-uid", "owner", true], ["barber-uid", "barber", false]]);
    const fromBarber = await (await call("barber-token", { action: "list" })).json();
    assert.equal(fromBarber.canLink, false);
    // The paired barber appears with the picture and name of their barber profile.
    const barberEntry = fromOwner.accounts.find((account) => account.uid === "barber-uid");
    assert.equal(barberEntry.photoUrl, "data:image/webp;base64,BARBER");
    assert.equal(barberEntry.name, "Mateusz W.");
    assert.equal(fromBarber.accounts.length, 2);

    assert.equal(uidOf((await (await call("owner-token", { action: "switch", uid: "barber-uid" })).json()).token), "barber-uid");
    assert.equal(uidOf((await (await call("barber-token", { action: "switch", uid: "owner-uid" })).json()).token), "owner-uid");
    assert.equal((await call("barber-token", { action: "switch", uid: "stranger-uid" })).status, 403);
    assert.equal((await call("stranger-token", { action: "switch", uid: "owner-uid" })).status, 403);
    assert.equal((await call("owner-token", { action: "switch", uid: "../x" })).status, 403);
    assert.equal(((await (await call("stranger-token", { action: "list" })).json()).accounts).length, 0);
  } finally { restore(); }
});

test("unpairing removes the account from the list and from switching", async () => {
  const db = {}; const restore = installFetch(db);
  try {
    await call("owner-token", { action: "link", linkToken: "barber-token" });
    assert.equal((await call("barber-token", { action: "unlink", uid: "owner-uid" })).status, 403);
    assert.equal((await call("owner-token", { action: "unlink", uid: "barber-uid" })).status, 200);
    assert.equal((await call("owner-token", { action: "switch", uid: "barber-uid" })).status, 403);
  } finally { restore(); }
});

test("the switcher's avatars keep their round size and phones get a compact header and crop buttons", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../app/client-account.css", import.meta.url), "utf8");
  // The avatar is a span too, so the text column needs its own class or it stretches into an ellipse.
  assert.match(css, /\.acct-switch-text \{ display: grid; flex: 1;/);
  assert.doesNotMatch(css, /\.acct-switch-row > button:first-child > span \{/);
  assert.match(css, /@media \(max-width: 440px\) \{[^}]*\.acct-switch-label \{ display: none; \}/);
  assert.match(css, /\.salon-dialog\.photo-crop \.salon-confirm-actions \{ flex-direction: row;/);
});
