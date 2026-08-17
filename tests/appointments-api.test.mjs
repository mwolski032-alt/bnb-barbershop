import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

const databaseUrl = "https://mock-appointments.firebaseio.test";
const mateuszUid = "XxBe4dwVYWZPtl004J4tWq6AMZ73";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_CLIENT_EMAIL = "service@bnb.test";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.FIREBASE_DATABASE_URL = databaseUrl;
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "firebase-test-key";

let revision = 1;
const database = {
  appointmentSync: { revision: 1 },
  team: {
    owner: { userId: "owner-test-uid", active: true },
    barbers: {
      mateusz: {
        id: "mateusz",
        userId: mateuszUid,
        active: true,
        access: {
          schedule: true,
          clients: true,
          analytics: true,
          work: true,
          services: true,
          profile: true,
        },
      },
      kacper: { id: "kacper", userId: "kacper-uid", active: true },
    },
  },
  barbers: {
    mateusz: {
      services: {
        "mens-haircut": {
          id: "mens-haircut",
          barberId: "mateusz",
          name: "Strzyżenie męskie",
          price: "30 zł",
          durationMinutes: 60,
        },
      },
      workSettings: {
        availability: {
          "2026-08-20": {
            id: "2026-08-20",
            barberId: "mateusz",
            dateKey: "2026-08-20",
            startTime: "08:00",
            endTime: "16:00",
          },
        },
      },
    },
  },
  appointments: {
    own: {
      id: "own",
      barberId: "mateusz",
      userId: "client-uid",
      clientId: "client-uid",
      serviceId: "mens-haircut",
      clientName: "Własny Klient",
      clientEmail: "client@example.com",
      phone: "500600700",
      serviceName: "Strzyżenie",
      price: "30 zł",
      dateKey: "2026-08-20",
      startTime: "10:00",
      durationMinutes: 60,
      status: "confirmed",
      version: 1,
    },
    other: {
      id: "other",
      barberId: "kacper",
      userId: "other-uid",
      clientId: "other-uid",
      serviceId: "beard-trim",
      clientName: "Prywatne Dane",
      clientEmail: "private@example.com",
      phone: "999999999",
      serviceName: "Broda",
      price: "20 zł",
      dateKey: "2026-08-20",
      startTime: "11:00",
      durationMinutes: 60,
      status: "confirmed",
      version: 1,
    },
  },
  clients: {
    "client-uid": {
      id: "client-uid",
      email: "client@example.com",
      phone: "500600700",
      userId: "client-uid",
      barberIds: { mateusz: true },
    },
    "other-uid": {
      id: "other-uid",
      email: "private@example.com",
      phone: "999999999",
      userId: "other-uid",
      barberIds: { kacper: true },
    },
  },
};

const parts = (path) => path.split("/").filter(Boolean).map(decodeURIComponent);
const readPath = (path) => parts(path).reduce((current, part) => current?.[part], database);
const writePath = (path, value) => {
  const keys = parts(path);
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
    if (idToken === "valid-client-token") {
      return Response.json({ users: [{ localId: "client-uid", email: "client@example.com" }] });
    }
    if (idToken === "valid-barber-token") {
      return Response.json({ users: [{ localId: mateuszUid, email: "barber@example.com" }] });
    }
    return new Response("Unauthorized", { status: 401 });
  }
  if (url.startsWith(databaseUrl)) {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.json$/, "");
    const method = options.method ?? "GET";
    if (method === "GET") {
      return new Response(JSON.stringify(readPath(path) ?? null), {
        headers: path === "appointments" || path === "" ? { ETag: `"${revision}"` } : {},
      });
    }
    if (method === "PUT") {
      if (["appointments", ""].includes(path) && options.headers?.["If-Match"] !== `"${revision}"`) {
        return new Response("Precondition failed", { status: 412 });
      }
      if (path === "") {
        const next = JSON.parse(options.body);
        for (const key of Object.keys(database)) delete database[key];
        Object.assign(database, next);
      } else {
        writePath(path, JSON.parse(options.body));
      }
      revision += 1;
      return Response.json(readPath(path));
    }
    if (method === "PATCH") return Response.json({ ok: true });
  }
  throw new Error(`Unexpected request in test: ${url}`);
};

const appointmentModule = await import("../netlify/functions/appointments.mjs");
let operationSequence = 0;
const request = (method, body, token = "valid-client-token") =>
  appointmentModule.default(
    new Request("https://bnb.example/.netlify/functions/appointments", {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      ...(body
        ? {
            body: JSON.stringify(
              method === "POST"
                ? {
                    operationId: body.operationId ?? `api-operation-${++operationSequence}`,
                    expectedVersion:
                      body.expectedVersion ??
                      (["create_client", "create_admin", "upsert_admin_client", "hide_admin_client"].includes(
                        body.action,
                      )
                        ? 0
                        : 1),
                    ...body,
                  }
                : body,
            ),
          }
        : {}),
    }),
  );

test("client data contains only own details and sanitized occupancy", async () => {
  const response = await request("GET");
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.clientAppointments.map((item) => item.id), ["own"]);
  assert.equal(result.occupancy.length, 2);
  assert.equal("clientName" in result.occupancy[0], false);
  assert.equal(JSON.stringify(result.occupancy).includes("private@example.com"), false);
});

test("appointment endpoint rejects missing authentication", async () => {
  const response = await request("GET", null, "");
  assert.equal(response.status, 401);
});

test("Mateusz receives only his own calendar from the canonical team assignment", async () => {
  const response = await request("GET", null, "valid-barber-token");
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(result.adminAppointments.map((item) => item.id), ["own"]);
  assert.equal(result.adminAppointments.some((item) => item.clientEmail === "private@example.com"), false);
  assert.deepEqual(result.clientAppointments, []);
  assert.equal(result.occupancy.length, 2);
});

test("a stale team assignment revokes Mateusz admin context", async () => {
  database.team.barbers.mateusz.userId = "stale-barber-uid";
  const response = await request("GET", null, "valid-barber-token");
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal("adminAppointments" in result, false);
  assert.equal(result.context.role, "client");
  database.team.barbers.mateusz.userId = mateuszUid;
});

test("atomic booking rejects an occupied time and accepts a free time", async () => {
  const baseAppointment = {
    id: "new-client-appointment",
    barberId: "mateusz",
    userId: "client-uid",
    clientName: "Nowy Klient",
    phone: "500600700",
    serviceId: "mens-haircut",
    serviceName: "Strzyżenie męskie",
    price: "30 zł",
    dateKey: "2026-08-20",
    startTime: "10:30",
    durationMinutes: 60,
    status: "confirmed",
  };
  const conflict = await request("POST", { action: "create_client", appointment: baseAppointment });
  assert.equal(conflict.status, 409);

  const success = await request("POST", {
    action: "create_client",
    appointment: { ...baseAppointment, id: "free-client-appointment", startTime: "12:00" },
  });
  assert.equal(success.status, 200, await success.text());
  assert.equal(database.appointments["free-client-appointment"].userId, "client-uid");
});

test("two simultaneous requests cannot reserve the same free slot", async () => {
  const create = (id) =>
    request("POST", {
      action: "create_client",
      appointment: {
        id,
        barberId: "mateusz",
        userId: "client-uid",
        clientName: "Klient",
        phone: "500600700",
        serviceId: "mens-haircut",
        serviceName: "Strzyżenie męskie",
        price: "30 zł",
        dateKey: "2026-08-20",
        startTime: "14:00",
        durationMinutes: 60,
        status: "confirmed",
      },
    });
  const responses = await Promise.all([create("race-one"), create("race-two")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
});

test("client cannot cancel another user's appointment", async () => {
  const response = await request("POST", { action: "cancel_client", appointmentId: "other" });
  assert.notEqual(response.status, 200);
  assert.equal(database.appointments.other.status, "confirmed");
});

test("client can confirm an admin-rescheduled appointment", async () => {
  database.appointments.own.status = "rescheduled";
  database.appointments.own.rescheduledBy = "admin";
  database.appointments.own.version = 1;
  const response = await request("POST", { action: "confirm_client", appointmentId: "own" });
  assert.equal(response.status, 200, await response.text());
  assert.equal(database.appointments.own.status, "confirmed");
  assert.equal(database.appointments.own.confirmedBy, "client");
  assert.equal(typeof database.appointments.own.confirmedAt, "number");
});

test("client cannot approve a reschedule they requested themselves", async () => {
  database.appointments.own.status = "rescheduled";
  database.appointments.own.rescheduledBy = "client";
  database.appointments.own.version = 1;
  const response = await request("POST", { action: "confirm_client", appointmentId: "own" });
  assert.equal(response.status, 409);
  assert.equal(database.appointments.own.status, "rescheduled");
});

test("active barber can confirm a rescheduled appointment in own calendar", async () => {
  database.appointments.own.status = "rescheduled";
  database.appointments.own.rescheduledBy = "client";
  database.appointments.own.version = 1;
  const response = await request(
    "POST",
    { action: "confirm_admin", appointmentId: "own" },
    "valid-barber-token",
  );
  assert.equal(response.status, 200, await response.text());
  assert.equal(database.appointments.own.status, "confirmed");
});
