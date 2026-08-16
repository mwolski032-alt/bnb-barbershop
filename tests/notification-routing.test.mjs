import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const ownerUid = "xkyDu2Lb1Ma8McF7yfyv8PIAj1M2";
const mateuszUid = "XxBe4dwVYWZPtl004J4tWq6AMZ73";
const kacperUid = "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3";
const databaseUrl = "https://mock-bnb.firebaseio.test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_CLIENT_EMAIL = "service@bnb.test";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.FIREBASE_DATABASE_URL = databaseUrl;
process.env.FIREBASE_PROJECT_ID = "bnb-test";
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "firebase-test-key";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_FROM_EMAIL = "BNB <notifications@bnb.test>";
process.env.BARBER_KACPER_EMAIL = "kacper-env@example.com";
process.env.URL = "https://bnb.example";

const database = {
  team: {
    barbers: {
      mateusz: {
        id: "mateusz",
        name: "Mateusz",
        email: "mateusz@example.com",
        userId: "stale-mateusz-uid",
        active: true,
      },
      kacper: {
        id: "kacper",
        name: "Kacper",
        email: "",
        userId: kacperUid,
        active: true,
      },
    },
  },
  notificationTokens: {
    [ownerUid]: { ownerDevice: { token: "owner-token", isAdmin: true } },
    [mateuszUid]: { mateuszDevice: { token: "mateusz-token", isAdmin: true } },
    "stale-mateusz-uid": { staleDevice: { token: "stale-token", isAdmin: true } },
    [kacperUid]: { barberDevice: { token: "barber-token", isAdmin: true } },
    "client-uid": {
      clientPhone: { token: "client-phone-token", isAdmin: false },
      clientTablet: { token: "client-tablet-token", isAdmin: false },
    },
  },
  appointments: {},
};
let sentEmails = [];
let sentPushes = [];

const pathParts = (path) => path.split("/").filter(Boolean);
const readPath = (path) =>
  pathParts(path).reduce((current, part) => current?.[decodeURIComponent(part)], database);
const writePath = (path, value) => {
  const keys = pathParts(path).map(decodeURIComponent);
  let target = database;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
};

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);

  if (url === "https://oauth2.googleapis.com/token") {
    return Response.json({ access_token: "database-access-token" });
  }
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
    const { idToken } = JSON.parse(options.body);
    if (idToken === "valid-barber-token") {
      return Response.json({ users: [{ localId: kacperUid, email: "kacper@example.com" }] });
    }
    return Response.json({ users: [{ localId: "client-uid", email: "client@example.com" }] });
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
    if (options.method === "PUT") writePath(path, JSON.parse(options.body));
    return Response.json({ ok: true });
  }

  throw new Error(`Unexpected request in test: ${url}`);
};

const notificationModule = await import("../netlify/functions/send-push.mjs");

const sendBookingNotification = (id, event = "new_booking", token = "valid-client-token") => {
  database.appointments[id] = {
    id,
    barberId: "kacper",
    userId: "client-uid",
    clientName: "Jan Kowalski",
    clientEmail: "client@example.com",
    phone: "500600700",
    serviceName: "Strzyzenie",
    dateKey: "2026-08-20",
    startTime: "10:00",
    status: event.endsWith("cancelled")
      ? "cancelled"
      : event.endsWith("rescheduled")
        ? "rescheduled"
        : "confirmed",
  };
  return notificationModule.default(
    new Request("https://bnb.example/.netlify/functions/send-push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
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
};

test("notification endpoint rejects unauthenticated requests", async () => {
  const response = await notificationModule.default(
    new Request("https://bnb.example/.netlify/functions/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "new_booking", appointment: { id: "missing-auth" } }),
    }),
  );
  assert.equal(response.status, 401);
});

test("appointment notifications go only to the assigned active barber", async () => {
  const response = await sendBookingNotification("appointment-active");
  const result = await response.json();

  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(
    sentPushes.map((payload) => payload.message.token),
    ["barber-token", "client-phone-token", "client-tablet-token"],
  );
  assert.deepEqual(
    sentPushes.slice(1).map((payload) => payload.message.data.title),
    ["Wizyta potwierdzona", "Wizyta potwierdzona"],
  );
  assert.equal(sentPushes.every((payload) => payload.message.webpush.headers.Urgency === "high"), true);
  assert.equal(sentPushes.every((payload) => payload.message.webpush.notification === undefined), true);
  assert.deepEqual(
    sentEmails.map((email) => email.to).sort(),
    ["client@example.com", "kacper-env@example.com"],
  );
  assert.equal(sentEmails.some((email) => email.to === "owner@example.com"), false);
  assert.equal(sentPushes.some((payload) => payload.message.token === "owner-token"), false);
});

test("Mateusz notifications use his fixed account instead of a stale team user id", async () => {
  sentEmails = [];
  sentPushes = [];
  const id = "appointment-mateusz-fixed-id";
  database.appointments[id] = {
    id,
    barberId: "mateusz",
    userId: "client-uid",
    clientName: "Olaw Testowy",
    clientEmail: "client@example.com",
    phone: "500600700",
    serviceName: "Strzyzenie",
    dateKey: "2026-08-21",
    startTime: "11:00",
    status: "confirmed",
  };

  const response = await notificationModule.default(
    new Request("https://bnb.example/.netlify/functions/send-push", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-client-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "new_booking", appointment: { id } }),
    }),
  );

  assert.equal(response.status, 200, await response.text());
  assert.deepEqual(
    sentPushes.map((payload) => payload.message.token),
    ["mateusz-token", "client-phone-token", "client-tablet-token"],
  );
  assert.equal(sentPushes.some((payload) => payload.message.token === "stale-token"), false);
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

test("admin reschedule links the client notification to its appointment", async () => {
  sentEmails = [];
  sentPushes = [];

  const response = await sendBookingNotification(
    "appointment-admin-rescheduled",
    "admin_rescheduled",
    "valid-barber-token",
  );
  assert.equal(response.status, 200, await response.text());
  assert.equal(sentPushes.length, 2);
  assert.deepEqual(
    sentPushes.map((payload) => payload.message.token),
    ["client-phone-token", "client-tablet-token"],
  );
  const link = new URL(sentPushes[0].message.data.link);
  assert.equal(link.searchParams.get("appointment"), "appointment-admin-rescheduled");
  assert.equal(link.searchParams.get("event"), "admin_rescheduled");
});

test("deactivated barber loses own notifications while the client keeps device confirmation", async () => {
  database.team.barbers.kacper.active = false;
  sentEmails = [];
  sentPushes = [];

  const response = await sendBookingNotification("appointment-inactive");
  const result = await response.json();

  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(
    sentPushes.map((payload) => payload.message.token),
    ["client-phone-token", "client-tablet-token"],
  );
  assert.deepEqual(sentEmails.map((email) => email.to), ["client@example.com"]);
  assert.equal(result.email.sent, 0);
  assert.match(result.email.error, /inactive/i);
});
