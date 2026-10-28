import assert from "node:assert/strict";
import test from "node:test";

import { BROADCAST_MAX_CHARS, broadcastAudience, canBroadcast, cleanBroadcastText } from "../shared/broadcast.mjs";

const clients = {
  a: { userId: "ua", barberIds: { mateusz: true } },
  b: { userId: "ub", barberIds: { kacper: true } },
  c: { userId: "uc", barberIds: { mateusz: true, kacper: true } },
  d: { userId: "ud", barberIds: { mateusz: true }, hiddenFor: { mateusz: true } },
  e: { barberIds: { mateusz: true } },
  f: { userId: "uteam", barberIds: { mateusz: true } },
};

test("a barber reaches own clients and favourites, once each", () => {
  const audience = broadcastAudience({ barberId: "mateusz", clients, favoriteUids: ["ub", "ua"], excludedUids: ["uteam"] });
  assert.deepEqual(audience.sort(), ["ua", "ub", "uc"]);
});

test("a client the barber removed from the list still gets the message when they chose the barber as favourite", () => {
  const audience = broadcastAudience({ barberId: "mateusz", clients, favoriteUids: ["ud"], excludedUids: ["uteam"] });
  assert.ok(audience.includes("ud"));
});

test("the owner reaches every client and every device account, never the team", () => {
  const audience = broadcastAudience({ barberId: "", clients, deviceUids: ["ux", "uteam", "ua"], excludedUids: ["uteam", "owner"] });
  assert.deepEqual(audience.sort(), ["ua", "ub", "uc", "ud", "ux"]);
});

test("text is trimmed, limited and loses runaway blank lines", () => {
  assert.equal(cleanBroadcastText("  Wolny termin!\r\n\r\n\r\n\r\nPrzyjdź  "), "Wolny termin!\n\nPrzyjdź");
  assert.equal(cleanBroadcastText("x".repeat(500)).length, BROADCAST_MAX_CHARS);
  assert.equal(cleanBroadcastText(undefined), "");
});

test("only an explicit block stops a barber; the owner always may", () => {
  assert.equal(canBroadcast({ isOwner: false, member: {} }), true);
  assert.equal(canBroadcast({ isOwner: false, member: { broadcastBlocked: true } }), false);
  assert.equal(canBroadcast({ isOwner: true, member: { broadcastBlocked: true } }), true);
});

import { readFileSync } from "node:fs";
import { createHandler } from "../netlify/functions/barber-photo.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const request = (path, method = "GET") => new Request(`https://bnb.example${path}`, { method });

test("a barber's picture is served as an image for the notification icon, only for a valid id and a stored image", async () => {
  const data = Buffer.from("JPEGdata").toString("base64");
  const handler = createHandler(async (id) => (id === "mateusz" ? `data:image/jpeg;base64,${data}` : id === "bad" ? "data:text/html;base64,AAAA" : null));
  const ok = await handler(request("/api/barber-photo/mateusz?v=3"));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), "JPEGdata");
  assert.equal((await handler(request("/api/barber-photo/nobody"))).status, 404);
  assert.equal((await handler(request("/api/barber-photo/bad"))).status, 404);
  assert.equal((await handler(request("/api/barber-photo/..%2Fteam"))).status, 404);
  assert.equal((await handler(request("/api/barber-photo/mateusz", "POST"))).status, 405);
});

test("the message is sent by the server only for the owner and for barbers the owner has not switched off", () => {
  const server = read("netlify/functions/broadcast.mjs");
  assert.match(server, /!context\.isAdmin \|\| !context\.active/);
  assert.match(server, /canBroadcast\(\{ isOwner: context\.isOwner, member \}\)/);
  assert.match(server, /claimRateLimit\(user\.uid, "broadcast", BROADCAST_COOLDOWN_MS/);
  // The owner writes as the company, a barber as themselves.
  assert.match(server, /let title = OWNER_NAME/);
  const home = read("app/booking-home.tsx");
  assert.match(home, /const canWriteToClients = isOwner \|\| \(isBarber && signedInBarber\?\.broadcastBlocked !== true\)/);
  assert.match(home, /broadcastBlocked: allowed \? null : true/);
});

test("the sender can untick people: the server drops them from a real send but lists everyone in the preview", () => {
  const server = read("netlify/functions/broadcast.mjs");
  assert.match(server, /const chosen = action === "send" \? audience\.filter\(\(uid\) => !excluded\.has\(uid\)\) : audience/);
  assert.match(server, /collectBroadcastDevices\(accessToken, chosen\)/);
  const dialog = read("app/components/client-broadcast.tsx");
  assert.match(dialog, /checked=\{!excluded\.has\(person\.uid\)\}/);
});
