import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHandler } from "../netlify/functions/client-photo.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const png = Buffer.from("RIFFxxxxWEBPdata").toString("base64");
const request = (path, method = "GET") => new Request(`https://bnb.example${path}`, { method });

test("a client's chosen picture is served as an image, only for a valid uid and a stored WebP", async () => {
  const handler = createHandler(async (uid) => (uid === "client-1" ? `data:image/webp;base64,${png}` : uid === "bad-data" ? "data:image/png;base64,AAAA" : null));
  const ok = await handler(request("/api/client-photo/client-1?v=5"));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/webp");
  assert.match(ok.headers.get("cache-control"), /immutable/);
  assert.equal(ok.headers.get("netlify-vary"), "query");
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), "RIFFxxxxWEBPdata");
  assert.equal((await handler(request("/api/client-photo/nobody"))).status, 404);
  assert.equal((await handler(request("/api/client-photo/bad-data"))).status, 404);
  assert.equal((await handler(request("/api/client-photo/..%2Fteam"))).status, 404);
  assert.equal((await handler(request("/api/client-photo/client-1", "POST"))).status, 405);
});

test("barbers see the chosen picture, and the owner and barbers have no \"Moje konto\"", () => {
  const server = read("netlify/functions/appointments.mjs");
  assert.match(server, /clientPhotoUrl: clientPhoto\(appointment\.userId, appointment\.clientPhotoUrl\)/);
  assert.match(server, /photoUrl: clientPhoto\(client\?\.userId, client\?\.photoUrl\)/);
  const home = read("app/booking-home.tsx");
  assert.match(home, /accountPanel=\{activeUser && !isAdmin \? \{/);
  assert.match(home, /isBarber\s*\? \{ name: signedInBarberName, photoUrl: signedInBarberProfile\.photoUrl/);
});

test("the appointment sheet is portalled to the page so it always reaches the bottom of the screen", () => {
  const agenda = read("app/components/screens/admin-agenda-screen.tsx");
  assert.match(agenda, /createPortal\(/);
  assert.match(agenda, /document\.body,/);
});
