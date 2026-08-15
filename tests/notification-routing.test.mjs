import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const ownerUid = "xkyDu2Lb1Ma8McF7yfyv8PIAj1M2";
const kacperUid = "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3";
const databaseUrl = "https://mock-bnb.firebaseio.test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_CLIENT_EMAIL = "service@bnb.test";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.FIREBASE_DATABASE_URL = databaseUrl;
process.env.FIREBASE_PROJECT_ID = "bnb-test";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_FROM_EMAIL = "BNB <notifications@bnb.test>";
process.env.BARBER_KACPER_EMAIL = "kacper-env@example.com";
process.env.URL = "https://bnb.example";

const database = {
  team: {
    barbers: {
      kacper: {
        id: "kacper",
        name: "Kacper",
        email: "",
        userId: "",
        active: true,
      },
    },
  },
  notificationTokens: {
    [ownerUid]: { ownerDevice: { token: "owner-token", isAdmin: true } },
    [kacperUid]: { barberDevice: { token: "barber-token", isAdmin: true } },
  },
};
let sentEmails = [];
let sentPushes = [];

const pathParts = (path) => path.split("/").filter(Boolean);
const readPath = (path) =>
  pathParts(path).reduce((current, part) => current?.[decodeURIComponent(part)], database);

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);

  if (url === "https://oauth2.googleapis.com/token") {
    return Response.json({ access_token: "database-access-token" });
  }
  if (url === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(options.body));
    return Response.json({ id: `email-${sentEmails.length}` });
  }
  if (url.startsWith("https://fcm.googleapis.com/")) {
    sentPushes.push(JSON.parse(options.body));
    return Response.json({ name: `push-${sentPushes.length}` });
  }
  if (url.startsWith(databaseUrl)) {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.json$/, "");
    if ((options.method ?? "GET") === "GET") return Response.json(readPath(path) ?? null);
    return Response.json({ ok: true });
  }

  throw new Error(`Unexpected request in test: ${url}`);
};

const notificationModule = await import("../netlify/functions/send-push.mjs");

const sendBookingNotification = (id, event = "new_booking") =>
  notificationModule.default(
    new Request("https://bnb.example/.netlify/functions/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        appointment: {
          id,
          barberId: "kacper",
          userId: "client-uid",
          clientName: "Jan Kowalski",
          clientEmail: "client@example.com",
          phone: "500600700",
          serviceName: "Strzyzenie",
          dateKey: "2026-08-20",
          startTime: "10:00",
        },
      }),
    }),
  );

test("appointment notifications go only to the assigned active barber", async () => {
  const response = await sendBookingNotification("appointment-active");
  const result = await response.json();

  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(sentPushes.map((payload) => payload.message.token), ["barber-token"]);
  assert.deepEqual(
    sentEmails.map((email) => email.to).sort(),
    ["client@example.com", "kacper-env@example.com"],
  );
  assert.equal(sentEmails.some((email) => email.to === "owner@example.com"), false);
  assert.equal(sentPushes.some((payload) => payload.message.token === "owner-token"), false);
});

test("Kacper email receives booking, reschedule and cancellation events", async () => {
  sentEmails = [];
  sentPushes = [];

  for (const event of ["new_booking", "client_rescheduled", "client_cancelled"]) {
    const response = await sendBookingNotification(`appointment-${event}`, event);
    assert.equal(response.status, 200);
  }

  const kacperEmails = sentEmails.filter((email) => email.to === "kacper-env@example.com");
  assert.equal(kacperEmails.length, 3);
  assert.deepEqual(
    kacperEmails.map((email) => email.subject),
    ["PILNE BNB: Nowa wizyta", "PILNE BNB: Klient przesunal wizyte", "PILNE BNB: Klient odwolal wizyte"],
  );
});

test("deactivated barber loses push and email notifications", async () => {
  database.team.barbers.kacper.active = false;
  sentEmails = [];
  sentPushes = [];

  const response = await sendBookingNotification("appointment-inactive");
  const result = await response.json();

  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(sentPushes, []);
  assert.deepEqual(sentEmails.map((email) => email.to), ["client@example.com"]);
  assert.equal(result.email.sent, 0);
  assert.match(result.email.error, /inactive/i);
});
