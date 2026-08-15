import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const ownerUid = "xkyDu2Lb1Ma8McF7yfyv8PIAj1M2";
const databaseUrl = "https://mock-bnb.firebaseio.test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_CLIENT_EMAIL = "service@bnb.test";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.FIREBASE_DATABASE_URL = databaseUrl;
process.env.FIREBASE_PROJECT_ID = "bnb-test";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_FROM_EMAIL = "BNB <notifications@bnb.test>";
process.env.URL = "https://bnb.example";

const database = {
  team: {
    barbers: {
      mateusz: {
        id: "mateusz",
        name: "Mateusz",
        email: "mateusz@example.com",
        userId: "mateusz-uid",
        active: true,
      },
    },
  },
  barbers: {},
  notificationTokens: {},
};
let authenticatedUser = { uid: ownerUid, email: "owner@example.com" };
let sentEmails = [];
let sentPushes = [];
let requestedUrls = [];

const pathParts = (path) => path.split("/").filter(Boolean);
const readPath = (path) =>
  pathParts(path).reduce((current, part) => current?.[decodeURIComponent(part)], database);
const patchPath = (path, patch) => {
  const parts = pathParts(path);
  const key = parts.pop();
  const parent = parts.reduce((current, part) => {
    const decoded = decodeURIComponent(part);
    current[decoded] ??= {};
    return current[decoded];
  }, database);
  const target = key
    ? (parent[decodeURIComponent(key)] ??= {})
    : parent;

  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete target[field];
    else target[field] = value;
  }
};

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  requestedUrls.push(url);

  if (url === "https://oauth2.googleapis.com/token") {
    return Response.json({ access_token: "database-access-token" });
  }
  if (url.startsWith("https://identitytoolkit.googleapis.com/")) {
    return Response.json({
      users: [{
        localId: authenticatedUser.uid,
        email: authenticatedUser.email,
        emailVerified: true,
      }],
    });
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
    const method = options.method ?? "GET";
    if (method === "GET") return Response.json(readPath(path) ?? null);
    if (method === "PATCH") {
      patchPath(path, JSON.parse(options.body));
      return Response.json(readPath(path));
    }
    if (method === "DELETE") return Response.json(null);
    if (method === "PUT") return Response.json({ ok: true });
  }

  throw new Error(`Unexpected request in test: ${url}`);
};

const invitationModule = await import("../netlify/functions/team-invitations.mjs");
const notificationModule = await import("../netlify/functions/send-push.mjs");

const callInvitation = (payload) =>
  invitationModule.default(
    new Request("https://bnb.example/.netlify/functions/team-invitations", {
      method: "POST",
      headers: {
        Authorization: "Bearer firebase-id-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  );

test("owner invitation creates a pending barber and the matching Google account claims it", async () => {
  const createResponse = await callInvitation({
    action: "create",
    member: {
      name: "Kacper",
      email: "kacper@example.com",
      access: {
        schedule: true,
        clients: true,
        analytics: true,
        work: true,
        services: true,
        profile: true,
      },
    },
  });
  assert.equal(createResponse.status, 200);
  const createResult = await createResponse.json();
  const memberId = createResult.memberId;
  const member = database.team.barbers[memberId];

  assert.equal(member.email, "kacper@example.com");
  assert.equal(member.active, false);
  assert.equal(member.userId, "");
  assert.equal(member.inviteStatus, "pending");
  assert.match(member.inviteTokenHash, /^[a-f0-9]{64}$/);
  assert.equal(sentEmails.at(-1).to, "kacper@example.com");

  const invitationUrl = sentEmails.at(-1).text.match(/https:\/\/\S+$/)?.[0];
  assert.ok(invitationUrl);
  const parsedInvitation = new URL(invitationUrl);
  const inviteToken = parsedInvitation.searchParams.get("invite");
  assert.ok(inviteToken);

  authenticatedUser = { uid: "wrong-uid", email: "wrong@example.com" };
  const wrongAccountResponse = await callInvitation({
    action: "claim",
    barberId: memberId,
    inviteToken,
  });
  assert.equal(wrongAccountResponse.status, 400);
  assert.match((await wrongAccountResponse.json()).error, /wskazanym w zaproszeniu/i);
  assert.equal(member.active, false);

  authenticatedUser = { uid: "kacper-uid", email: "kacper@example.com" };
  const claimResponse = await callInvitation({
    action: "claim",
    barberId: memberId,
    inviteToken,
  });
  assert.equal(claimResponse.status, 200);
  assert.equal(member.userId, "kacper-uid");
  assert.equal(member.active, true);
  assert.equal(member.inviteStatus, "accepted");
  assert.equal(member.inviteTokenHash, undefined);
});

test("appointment notifications go to the assigned barber and never to the owner", async () => {
  const memberId = Object.keys(database.team.barbers).find((id) => id !== "mateusz");
  assert.ok(memberId);
  database.notificationTokens = {
    [ownerUid]: {
      ownerDevice: { token: "owner-token", isAdmin: true },
    },
    "kacper-uid": {
      barberDevice: { token: "barber-token", isAdmin: true },
    },
  };
  sentEmails = [];
  sentPushes = [];
  requestedUrls = [];

  const response = await notificationModule.default(
    new Request("https://bnb.example/.netlify/functions/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "new_booking",
        appointment: {
          id: "appointment-1",
          barberId: memberId,
          userId: "client-uid",
          clientName: "Jan Kowalski",
          clientEmail: "client@example.com",
          phone: "500600700",
          serviceName: "Strzyżenie",
          dateKey: "2026-08-20",
          startTime: "10:00",
        },
      }),
    }),
  );
  const notificationResult = await response.json();
  assert.equal(response.status, 200, JSON.stringify(notificationResult));
  assert.deepEqual(sentPushes.map((payload) => payload.message.token), ["barber-token"]);
  assert.deepEqual(
    sentEmails.map((email) => email.to).sort(),
    ["client@example.com", "kacper@example.com"],
  );
  assert.equal(sentEmails.some((email) => email.to === "owner@example.com"), false);
  assert.equal(sentPushes.some((payload) => payload.message.token === "owner-token"), false);
  assert.equal(requestedUrls.some((url) => url.includes("smsapi.com")), false);
  assert.equal(requestedUrls.some((url) => url.includes("graph.facebook.com")), false);
});
