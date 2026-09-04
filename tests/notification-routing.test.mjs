import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ownerUid = "xkyDu2Lb1Ma8McF7yfyv8PIAj1M2";
const mateuszUid = "XxBe4dwVYWZPtl004J4tWq6AMZ73";
const kacperUid = "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3";
const clientUid = "client-uid";
const waitlistClientUid = "waitlist-client-uid";
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

const fullAccess = {
  schedule: true,
  clients: true,
  analytics: true,
  work: true,
  services: true,
  profile: true,
};

const initialDatabase = () => ({
  appointmentSync: { revision: 0 },
  team: {
    owner: { userId: ownerUid, active: true },
    barbers: {
      mateusz: {
        id: "mateusz",
        name: "Mateusz",
        email: "mateusz@example.com",
        userId: mateuszUid,
        active: true,
        access: { ...fullAccess },
      },
      kacper: {
        id: "kacper",
        name: "Kacper",
        email: "",
        userId: kacperUid,
        active: true,
        access: { ...fullAccess },
      },
    },
  },
  barbers: {
    mateusz: {
      services: {
        cut: { id: "cut", barberId: "mateusz", name: "Strzyżenie", price: "70 zł", durationMinutes: 60 },
      },
      workSettings: {
        availability: {
          "2099-01-10": {
            id: "2099-01-10",
            barberId: "mateusz",
            dateKey: "2099-01-10",
            startTime: "08:00",
            endTime: "18:00",
          },
        },
      },
    },
    kacper: { services: {}, workSettings: { availability: {} } },
  },
  notificationTokens: {
    [ownerUid]: { ownerPhone: { token: "owner-token", active: true, isAdmin: true } },
    [mateuszUid]: { barberPhone: { token: "mateusz-token", active: true, isAdmin: true } },
    [kacperUid]: { barberPhone: { token: "kacper-token", active: true, isAdmin: true } },
    "stale-barber-uid": { stalePhone: { token: "stale-token", active: true, isAdmin: true } },
    [clientUid]: {
      phone: { token: "client-phone-token", active: true, isAdmin: false },
      tablet: { token: "client-tablet-token", active: true, isAdmin: false },
      retired: { token: "retired-token", active: false, isAdmin: false },
    },
    [waitlistClientUid]: {
      phone: { token: "waitlist-client-token", active: true, isAdmin: false },
    },
  },
  appointments: {},
  clients: {},
  appointmentOperations: {},
  notificationOutbox: {},
});

let database = initialDatabase();
let revision = 1;
let sentEmails = [];
let sentPushes = [];
let fcmResponses = new Map();

const pathParts = (path) => path.split("/").filter(Boolean).map(decodeURIComponent);
const readPath = (path) => pathParts(path).reduce((current, part) => current?.[part], database);
const writePath = (path, value) => {
  const keys = pathParts(path);
  if (keys.length === 0) {
    database = value;
    return;
  }
  let target = database;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  if (value === null) delete target[keys.at(-1)];
  else target[keys.at(-1)] = value;
};

const reset = () => {
  database = initialDatabase();
  revision = 1;
  sentEmails = [];
  sentPushes = [];
  fcmResponses = new Map();
};

globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") {
    return Response.json({ access_token: "database-access-token" });
  }
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
    const { idToken } = JSON.parse(options.body);
    const users = {
      "client-token": { localId: clientUid, email: "client@example.com" },
      "mateusz-id-token": { localId: mateuszUid, email: "mateusz@example.com" },
      "owner-id-token": { localId: ownerUid, email: "owner@example.com" },
    };
    return users[idToken]
      ? Response.json({ users: [users[idToken]] })
      : new Response("Unauthorized", { status: 401 });
  }
  if (url === "https://api.resend.com/emails") {
    sentEmails.push(JSON.parse(options.body));
    return Response.json({ id: `email-${sentEmails.length}` });
  }
  if (url.startsWith("https://fcm.googleapis.com/")) {
    const payload = JSON.parse(options.body);
    const token = payload.message.token;
    sentPushes.push(payload);
    const queue = fcmResponses.get(token) ?? [];
    const next = queue.shift();
    fcmResponses.set(token, queue);
    if (next === "transient") {
      return Response.json({ error: { status: "UNAVAILABLE" } }, { status: 503 });
    }
    if (next === "invalid") {
      return Response.json(
        {
          error: {
            status: "NOT_FOUND",
            details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
          },
        },
        { status: 404 },
      );
    }
    return Response.json({ name: `push-${sentPushes.length}` });
  }
  if (url.startsWith(databaseUrl)) {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.json$/, "");
    const method = options.method ?? "GET";
    if (method === "GET") {
      return new Response(JSON.stringify(readPath(path) ?? null), { headers: { ETag: `"${revision}"` } });
    }
    if (method === "PUT") {
      const expected = options.headers?.["If-Match"];
      if (expected && expected !== `"${revision}"`) return new Response("Precondition failed", { status: 412 });
      writePath(path, JSON.parse(options.body));
      revision += 1;
      return Response.json(readPath(path) ?? null);
    }
    if (method === "PATCH") {
      for (const [relativePath, value] of Object.entries(JSON.parse(options.body))) {
        writePath(`${path}/${relativePath}`, value);
      }
      revision += 1;
      return Response.json(readPath(path) ?? null);
    }
    if (method === "DELETE") {
      writePath(path, null);
      revision += 1;
      return Response.json(null);
    }
  }
  throw new Error(`Unexpected request in notification test: ${url}`);
};

const notificationService = await import("../netlify/functions/_notification-service.mjs");
const { default: appointmentsHandler } = await import("../netlify/functions/appointments.mjs");
const notificationDispatch = await import("../netlify/functions/notification-dispatch.mjs");
const { default: sendPushHandler } = await import("../netlify/functions/send-push.mjs");
const notificationWorker = await import("../netlify/functions/notification-worker.mjs");

const appointmentFor = (overrides = {}) => ({
  id: "appointment-1",
  barberId: "mateusz",
  clientId: clientUid,
  userId: clientUid,
  serviceId: "cut",
  clientName: "Jan Kowalski",
  clientEmail: "client@example.com",
  phone: "500600700",
  serviceName: "Strzyżenie",
  price: "70 zł",
  dateKey: "2099-01-10",
  startTime: "10:00",
  durationMinutes: 60,
  status: "confirmed",
  version: 1,
  ...overrides,
});

const seedJob = (event, action, overrides = {}) => {
  const appointment = appointmentFor(overrides);
  const operationId = `operation-${event}-${appointment.id}`;
  appointment.lastOperationId = operationId;
  database.appointments[appointment.id] = appointment;
  database.appointmentOperations[operationId] = {
    operationId,
    action,
    actorUid: action.endsWith("_admin") ? mateuszUid : clientUid,
    appointmentId: appointment.id,
    appointment: structuredClone(appointment),
    syncRevision: 1,
  };
  database.notificationOutbox[operationId] = {
    operationId,
    appointmentId: appointment.id,
    event,
    barberId: appointment.barberId,
    userId: appointment.userId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return { appointment, operationId };
};

const appointmentRequest = (token, body) => appointmentsHandler(
  new Request("https://bnb.example/.netlify/functions/appointments", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
);

const dispatchNotifications = (token, operationIds) => notificationDispatch.default(
  new Request("https://bnb.example/.netlify/functions/notification-dispatch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operationIds }),
  }),
);

test("appointment API commits immediately and a background function delivers its outbox job", async () => {
  reset();
  const response = await appointmentsHandler(
    new Request("https://bnb.example/.netlify/functions/appointments", {
      method: "POST",
      headers: { Authorization: "Bearer client-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_client",
        operationId: "backend-booking-operation",
        expectedVersion: 0,
        appointment: appointmentFor({ id: "backend-booking", startTime: "12:00" }),
        client: { firstName: "Jan", lastName: "Kowalski", phone: "500600700" },
      }),
    }),
  );
  const result = await response.json();

  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.notificationQueued, true);
  assert.deepEqual(result.notificationOperationIds, ["backend-booking-operation"]);
  assert.equal(database.notificationOutbox["backend-booking-operation"].status, "pending");
  assert.equal(sentPushes.length, 0);

  await dispatchNotifications("client-token", result.notificationOperationIds);

  assert.equal(database.notificationOutbox["backend-booking-operation"].status, "delivered");
  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "mateusz-token",
    "client-phone-token",
    "client-tablet-token",
  ]);
  assert.equal(sentPushes.some(({ message }) => message.token === "owner-token"), false);
  assert.equal(sentPushes.some(({ message }) => message.token === "retired-token"), false);
  assert.equal(sentPushes.some(({ message }) => message.token === "stale-token"), false);
});

test("background dispatch processes only jobs created by the signed-in user", async () => {
  reset();
  const { operationId } = seedJob("new_booking", "create_client", {
    id: "authorized-background-job",
  });

  await dispatchNotifications("mateusz-id-token", [operationId]);
  assert.equal(database.notificationOutbox[operationId].status, "pending");
  assert.equal(sentPushes.length, 0);

  await dispatchNotifications("client-token", [operationId]);
  assert.equal(database.notificationOutbox[operationId].status, "delivered");
  assert.equal(sentPushes.length > 0, true);
});

test("joining the waitlist notifies only the selected barber and opens that waitlist", async () => {
  reset();
  const requestBody = {
    action: "join_waitlist",
    operationId: "waitlist-join-notification",
    expectedVersion: 0,
    waitlistEntry: {
      id: "waitlist-new-client",
      barberId: "mateusz",
      serviceId: "cut",
      clientName: "Jan Kowalski",
      phone: "500600700",
      dateFrom: "2099-01-10",
      dateTo: "2099-01-20",
      timePreference: "afternoon",
    },
  };

  const firstResponse = await appointmentRequest("client-token", requestBody);
  const firstResult = await firstResponse.json();

  assert.equal(firstResponse.status, 200, JSON.stringify(firstResult));
  assert.equal(firstResult.notificationQueued, true);
  assert.equal(database.notificationOutbox[requestBody.operationId].event, "waitlist_joined");
  assert.equal(database.notificationOutbox[requestBody.operationId].status, "pending");
  assert.equal(sentPushes.length, 0);

  await dispatchNotifications("client-token", firstResult.notificationOperationIds);

  assert.equal(database.notificationOutbox[requestBody.operationId].status, "delivered");
  assert.deepEqual(sentPushes.map(({ message }) => message.token), ["mateusz-token"]);
  assert.equal(sentPushes.some(({ message }) => message.token === "owner-token"), false);
  assert.equal(sentPushes.some(({ message }) => message.token === "client-phone-token"), false);

  const push = sentPushes[0].message;
  assert.equal(push.data.title, "Nowy zapis na listę rezerwową");
  assert.match(push.data.body, /Jan Kowalski/);
  assert.match(push.data.body, /Strzyżenie/);
  assert.match(push.data.body, /10\.01\.2099–20\.01\.2099/);
  assert.match(push.data.body, /po południu/);
  const link = new URL(push.data.link);
  assert.equal(link.searchParams.get("event"), "waitlist_joined");
  assert.equal(link.searchParams.get("waitlist"), "waitlist-new-client");
  assert.equal(link.searchParams.get("barber"), "mateusz");
  assert.equal(link.searchParams.get("appointment"), null);

  assert.deepEqual(sentEmails.map(({ to }) => to), ["mateusz@example.com"]);
  assert.match(sentEmails[0].html, /Jan Kowalski/);
  assert.match(sentEmails[0].html, /10\.01\.2099–20\.01\.2099/);
  assert.match(sentEmails[0].html, /po południu/);

  const pushCount = sentPushes.length;
  const emailCount = sentEmails.length;
  const retryResponse = await appointmentRequest("client-token", requestBody);
  const retryResult = await retryResponse.json();
  assert.equal(retryResponse.status, 200, JSON.stringify(retryResult));
  assert.equal(retryResult.idempotent, true);
  assert.equal(sentPushes.length, pushCount);
  assert.equal(sentEmails.length, emailCount);
});

test("booking, reschedule, confirmation and cancellation each create a backend delivery job", async () => {
  reset();
  const appointment = appointmentFor({ id: "backend-flow", startTime: "12:00" });
  const operations = [
    ["client-token", {
      action: "create_client",
      operationId: "flow-create",
      expectedVersion: 0,
      appointment,
      client: { firstName: "Jan", lastName: "Kowalski", phone: "500600700" },
    }],
    ["mateusz-id-token", {
      action: "reschedule_admin",
      operationId: "flow-reschedule",
      expectedVersion: 1,
      appointmentId: appointment.id,
      dateKey: "2099-01-10",
      startTime: "13:00",
    }],
    ["client-token", {
      action: "confirm_client",
      operationId: "flow-confirm",
      expectedVersion: 2,
      appointmentId: appointment.id,
    }],
    ["client-token", {
      action: "cancel_client",
      operationId: "flow-cancel",
      expectedVersion: 3,
      appointmentId: appointment.id,
    }],
  ];

  for (const [token, body] of operations) {
    const response = await appointmentRequest(token, body);
    assert.equal(response.status, 200, await response.text());
  }

  assert.deepEqual(
    Object.fromEntries(Object.entries(database.notificationOutbox).map(([id, job]) => [id, job.event])),
    {
      "flow-create": "new_booking",
      "flow-reschedule": "admin_rescheduled",
      "flow-confirm": "client_confirmed",
      "flow-cancel": "client_cancelled",
    },
  );
  assert.equal(Object.values(database.notificationOutbox).every((job) => job.status === "pending"), true);
  assert.equal(database.appointments[appointment.id], undefined);
  assert.equal(database.appointmentOperations["flow-cancel"].appointment.status, "cancelled");
  assert.equal(database.appointmentOperations["flow-cancel"].appointment.version, 4);
});

test("admin changes reach every active client device and link to the exact appointment", async () => {
  reset();
  const { operationId } = seedJob("admin_rescheduled", "reschedule_admin", {
    id: "changed-appointment",
    status: "rescheduled",
    rescheduledBy: "admin",
  });
  const result = await notificationService.processNotificationJob(operationId, {
    force: true,
    siteUrl: "https://bnb.example",
  });

  assert.equal(result.state, "delivered");
  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "client-phone-token",
    "client-tablet-token",
  ]);
  for (const { message } of sentPushes) {
    const link = new URL(message.data.link);
    assert.equal(link.searchParams.get("appointment"), "changed-appointment");
    assert.equal(link.searchParams.get("event"), "admin_rescheduled");
    assert.equal(message.webpush.headers.Urgency, "high");
  }
});

test("individual discount notifies the client with the old and new price", async () => {
  reset();
  const appointment = appointmentFor({ id: "discounted-appointment" });
  database.appointments[appointment.id] = appointment;

  const response = await appointmentRequest("mateusz-id-token", {
    action: "update_admin",
    operationId: "discount-appointment-operation",
    expectedVersion: 1,
    appointmentId: appointment.id,
    dateKey: appointment.dateKey,
    startTime: appointment.startTime,
    priceAmount: 45,
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(database.notificationOutbox[result.operationId].event, "admin_appointment_updated");

  await dispatchNotifications("mateusz-id-token", result.notificationOperationIds);

  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "client-phone-token",
    "client-tablet-token",
  ]);
  const push = sentPushes[0].message;
  assert.equal(push.data.title, "Masz rabat na wizytę 🎉");
  assert.equal(
    push.data.body,
    "Cena usługi „Strzyżenie” została obniżona z 70 zł do 45 zł. Termin: 10.01.2099 o 10:00.",
  );
  assert.equal(new URL(push.data.link).searchParams.get("event"), "admin_appointment_updated");
  assert.deepEqual(sentEmails.map(({ to }) => to), ["client@example.com"]);
  assert.equal(sentEmails[0].subject, "BNB Barbershop: Masz rabat na wizytę 🎉");
});

test("a free visit sends a special notification and keeps zero as a real price", async () => {
  reset();
  const appointment = appointmentFor({ id: "free-appointment" });
  database.appointments[appointment.id] = appointment;

  const response = await appointmentRequest("mateusz-id-token", {
    action: "update_admin",
    operationId: "free-appointment-operation",
    expectedVersion: 1,
    appointmentId: appointment.id,
    dateKey: appointment.dateKey,
    startTime: appointment.startTime,
    priceAmount: 0,
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.appointment.priceAmount, 0);
  assert.equal(result.appointment.price, "0 zł");

  await dispatchNotifications("mateusz-id-token", result.notificationOperationIds);

  const push = sentPushes[0].message;
  assert.equal(push.data.title, "Ta wizyta jest od nas 🎁");
  assert.equal(
    push.data.body,
    "Usługa „Strzyżenie” będzie bezpłatna — za tę wizytę nic nie płacisz. Termin: 10.01.2099 o 10:00.",
  );
  assert.deepEqual(sentEmails.map(({ to }) => to), ["client@example.com"]);
});

test("a completed visit correction uses past-tense notification copy", async () => {
  reset();
  const appointment = appointmentFor({
    id: "completed-price-correction",
    status: "completed",
    settlement: { barberId: "mateusz", settledAt: 1, amount: 70 },
  });
  database.appointments[appointment.id] = appointment;

  const response = await appointmentRequest("mateusz-id-token", {
    action: "update_admin",
    operationId: "completed-price-correction-operation",
    expectedVersion: 1,
    appointmentId: appointment.id,
    dateKey: appointment.dateKey,
    startTime: appointment.startTime,
    priceAmount: 20,
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.appointment.settlement.amount, 20);

  await dispatchNotifications("mateusz-id-token", result.notificationOperationIds);

  const push = sentPushes[0].message;
  assert.equal(push.data.title, "Skorygowano cenę wizyty");
  assert.equal(
    push.data.body,
    "Końcowa cena usługi „Strzyżenie” została skorygowana z 70 zł do 20 zł. Data wizyty: 10.01.2099 o 10:00.",
  );
});

test("waitlist notification links directly to the offered barber, service, date and time", async () => {
  reset();
  const { operationId } = seedJob("waitlist_slot_open", "notify_waitlist", {
    id: "waitlist-entry-link",
    waitlistId: "waitlist-entry-link",
    serviceId: "cut",
    dateKey: "2099-01-10",
    startTime: "15:00",
    offerExpiresAt: Date.now() + 10 * 60 * 1000,
  });
  const result = await notificationService.processNotificationJob(operationId, {
    force: true,
    siteUrl: "https://bnb.example",
  });

  assert.equal(result.state, "delivered");
  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "client-phone-token",
    "client-tablet-token",
  ]);
  const link = new URL(sentPushes[0].message.data.link);
  assert.equal(link.searchParams.get("waitlist"), "waitlist-entry-link");
  assert.equal(link.searchParams.get("barber"), "mateusz");
  assert.equal(link.searchParams.get("service"), "cut");
  assert.equal(link.searchParams.get("date"), "2099-01-10");
  assert.equal(link.searchParams.get("time"), "15:00");
  assert.equal(link.searchParams.get("appointment"), null);
  assert.equal(sentEmails.some(({ html }) => html.includes("Zarezerwuj termin")), true);
});

test("cancellation immediately delivers the waitlist offer created in the same request", async () => {
  reset();
  const appointment = appointmentFor({ id: "cancelled-for-waitlist", startTime: "15:00" });
  database.appointments[appointment.id] = appointment;
  database.waitlistEntries = {
    waiting: {
      id: "waiting",
      userId: waitlistClientUid,
      clientName: "Klient z listy",
      clientEmail: "waitlist@example.com",
      phone: "600700800",
      barberId: "mateusz",
      serviceId: "cut",
      serviceName: "Strzyżenie",
      durationMinutes: 60,
      dateFrom: "2099-01-10",
      dateTo: "2099-01-10",
      timePreference: "afternoon",
      status: "waiting",
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };

  const response = await appointmentRequest("client-token", {
    action: "cancel_client",
    operationId: "cancel-and-notify-waitlist",
    expectedVersion: 1,
    appointmentId: appointment.id,
  });
  const responseResult = await response.json();
  assert.equal(response.status, 200, JSON.stringify(responseResult));

  const waitlistJob = Object.values(database.notificationOutbox).find(
    (job) => job.event === "waitlist_slot_open",
  );
  assert.equal(waitlistJob.status, "pending");
  assert.equal(sentPushes.length, 0);

  await dispatchNotifications("client-token", responseResult.notificationOperationIds);

  assert.equal(
    Object.values(database.notificationOutbox).find((job) => job.event === "waitlist_slot_open")
      .status,
    "delivered",
  );
  assert.equal(
    sentPushes.some(({ message }) => message.token === "waitlist-client-token"),
    true,
  );
  assert.equal(sentEmails.some(({ to }) => to === "waitlist@example.com"), true);
});

test("scheduled worker discovers a newly available slot and notifies the waiting client", async () => {
  reset();
  database.waitlistEntries = {
    waiting: {
      id: "waiting",
      userId: waitlistClientUid,
      clientName: "Klient z listy",
      clientEmail: "waitlist@example.com",
      phone: "600700800",
      barberId: "mateusz",
      serviceId: "cut",
      serviceName: "Strzyżenie",
      durationMinutes: 60,
      dateFrom: "2099-01-10",
      dateTo: "2099-01-10",
      timePreference: "morning",
      status: "waiting",
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  };

  const response = await notificationWorker.default();
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(database.waitlistEntries.waiting.status, "offered");
  assert.equal(result.waitlist.offeredCount, 1);

  const waitlistJob = Object.values(database.notificationOutbox).find(
    (job) => job.event === "waitlist_slot_open",
  );
  assert.equal(waitlistJob.status, "delivered");
  assert.equal(
    sentPushes.some(({ message }) => message.token === "waitlist-client-token"),
    true,
  );
});

test("confirmation actions have distinct backend events for the proper audience", async () => {
  reset();
  const clientConfirmation = seedJob("client_confirmed", "confirm_client", { id: "client-confirmed" });
  await notificationService.processNotificationJob(clientConfirmation.operationId, { force: true });
  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "mateusz-token",
    "client-phone-token",
    "client-tablet-token",
  ]);

  sentPushes = [];
  const adminConfirmation = seedJob("admin_confirmed", "confirm_admin", { id: "admin-confirmed" });
  await notificationService.processNotificationJob(adminConfirmation.operationId, { force: true });
  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "client-phone-token",
    "client-tablet-token",
  ]);
});

test("an operationId is delivered once even when the backend retries the same job", async () => {
  reset();
  const { operationId } = seedJob("client_cancelled", "cancel_client", {
    id: "cancelled-once",
    status: "cancelled",
  });
  const first = await notificationService.processNotificationJob(operationId, { force: true });
  const deliveredCount = sentPushes.length;
  const emailCount = sentEmails.length;
  const second = await notificationService.processNotificationJob(operationId, { force: true });

  assert.equal(first.state, "delivered");
  assert.equal(second.state, "delivered");
  assert.equal(sentPushes.length, deliveredCount);
  assert.equal(sentEmails.length, emailCount);
  assert.equal(Object.keys(database.notificationOutbox[operationId].history).length, 1);
});

test("worker retries only the failed device and preserves delivery history", async () => {
  reset();
  fcmResponses.set("client-tablet-token", ["transient"]);
  const { operationId } = seedJob("admin_rescheduled", "reschedule_admin", {
    id: "retry-appointment",
    status: "rescheduled",
  });
  const first = await notificationService.processNotificationJob(operationId, { force: true });
  assert.equal(first.state, "retry");
  assert.equal(database.notificationOutbox[operationId].deliveries.devices[`${clientUid}:phone`].status, "delivered");
  assert.equal(database.notificationOutbox[operationId].deliveries.devices[`${clientUid}:tablet`].status, "failed");

  const dueAt = database.notificationOutbox[operationId].nextAttemptAt;
  const workerResult = await notificationService.processDueNotificationJobs({
    now: dueAt,
    siteUrl: "https://bnb.example",
  });
  assert.equal(workerResult.delivered, 1);
  assert.equal(sentPushes.filter(({ message }) => message.token === "client-phone-token").length, 1);
  assert.equal(sentPushes.filter(({ message }) => message.token === "client-tablet-token").length, 2);
  assert.equal(database.notificationOutbox[operationId].status, "delivered");
  assert.deepEqual(Object.keys(database.notificationOutbox[operationId].history), ["attempt_1", "attempt_2"]);
});

test("invalid FCM tokens are recorded and removed while the job completes", async () => {
  reset();
  fcmResponses.set("client-tablet-token", ["invalid"]);
  const { operationId } = seedJob("admin_cancelled", "cancel_admin", {
    id: "invalid-device",
    status: "cancelled",
  });
  const result = await notificationService.processNotificationJob(operationId, { force: true });

  assert.equal(result.state, "delivered");
  assert.equal(database.notificationTokens[clientUid].tablet, undefined);
  assert.equal(database.notificationOutbox[operationId].deliveries.devices[`${clientUid}:tablet`].status, "invalid");
  assert.equal(database.notificationOutbox[operationId].history.attempt_1.invalid, 1);
});

test("inactive barber and owner never receive appointment notifications", async () => {
  reset();
  database.team.barbers.mateusz.active = false;
  const { operationId } = seedJob("new_booking", "create_client", { id: "inactive-barber" });
  await notificationService.processNotificationJob(operationId, { force: true });

  assert.deepEqual(sentPushes.map(({ message }) => message.token), [
    "client-phone-token",
    "client-tablet-token",
  ]);
  assert.deepEqual(sentEmails.map(({ to }) => to), ["client@example.com"]);
  assert.equal(sentPushes.some(({ message }) => message.token === "owner-token"), false);
});

test("public push endpoint accepts only a signed-in non-owner test notification", async () => {
  reset();
  const appointment = appointmentFor({ id: "test-push" });
  const appointmentEvent = await sendPushHandler(new Request("https://bnb.example/.netlify/functions/send-push", {
    method: "POST",
    headers: { Authorization: "Bearer client-token", "Content-Type": "application/json" },
    body: JSON.stringify({ event: "new_booking", appointment }),
  }));
  const ownerTest = await sendPushHandler(new Request("https://bnb.example/.netlify/functions/send-push", {
    method: "POST",
    headers: { Authorization: "Bearer owner-id-token", "Content-Type": "application/json" },
    body: JSON.stringify({ event: "test_push", appointment }),
  }));
  const unauthenticated = await sendPushHandler(new Request("https://bnb.example/.netlify/functions/send-push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "test_push", appointment }),
  }));

  assert.equal(appointmentEvent.status, 400);
  assert.equal(ownerTest.status, 403);
  assert.equal(unauthenticated.status, 401);
  assert.equal(sentPushes.length, 0);
});

test("scheduled worker and frontend wiring keep appointment notifications backend-owned", async () => {
  const [frontend, appointmentClient, appointmentsSource, dispatchSource, notificationSource] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/appointments.ts", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/appointments.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/notification-dispatch.mjs", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/_notification-service.mjs", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(notificationWorker.config, { schedule: "* * * * *" });
  assert.doesNotMatch(frontend, /sendAppointmentNotification/);
  assert.match(appointmentsSource, /notificationQueued:/);
  assert.doesNotMatch(appointmentsSource, /await processNotificationJob/);
  assert.match(appointmentClient, /notification-dispatch[\s\S]*keepalive: true/);
  assert.match(dispatchSource, /background: true/);
  assert.match(dispatchSource, /processNotificationJob\(operationId/);
  assert.match(notificationSource, /confirm_client: "client_confirmed"/);
  assert.match(notificationSource, /confirm_admin: "admin_confirmed"/);
  assert.match(notificationSource, /status: "invalid"/);
  assert.match(notificationSource, /history/);
});
