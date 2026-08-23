import { generateKeyPairSync } from "node:crypto";

export const ownerUid = "xkyDu2Lb1Ma8McF7yfyv8PIAj1M2";
export const mateuszUid = "XxBe4dwVYWZPtl004J4tWq6AMZ73";
export const kacperUid = "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3";
export const clientAUid = "client-a-uid";
export const clientBUid = "client-b-uid";

export const tokens = {
  owner: "owner-id-token",
  mateusz: "mateusz-id-token",
  kacper: "kacper-id-token",
  clientA: "client-a-id-token",
  clientB: "client-b-id-token",
  unverifiedClient: "unverified-client-id-token",
};

const databaseUrl = "https://mock-role-workflows.firebaseio.test";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

process.env.FIREBASE_CLIENT_EMAIL = "service@bnb.test";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.FIREBASE_DATABASE_URL = databaseUrl;
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "firebase-test-key";

const fullAccess = {
  schedule: true,
  clients: true,
  analytics: true,
  work: true,
  services: true,
  profile: true,
};

const service = (barberId) => ({
  cut: {
    id: "cut",
    barberId,
    name: "Strzyzenie",
    price: "50 zl",
    durationMinutes: 60,
  },
});

const workSettings = (barberId) => ({
  availability: {
    "2099-01-10": {
      id: "2099-01-10",
      barberId,
      dateKey: "2099-01-10",
      startTime: "08:00",
      endTime: "18:00",
    },
  },
});

const appointment = ({ id, barberId, userId, clientId, dateKey, startTime, status = "confirmed" }) => ({
  id,
  barberId,
  userId,
  clientId,
  serviceId: "cut",
  clientName: userId === clientBUid ? "Klient B" : "Klient A",
  clientEmail: userId === clientBUid ? "client-b@example.com" : "client-a@example.com",
  phone: userId === clientBUid ? "600700800" : "500600700",
  serviceName: "Strzyzenie",
  price: "50 zl",
  dateKey,
  startTime,
  durationMinutes: 60,
  color: "blue",
  status,
  version: 1,
});

export const createInitialDatabase = () => ({
  appointmentSync: { revision: 1 },
  team: {
    owner: { userId: ownerUid, active: true },
    barbers: {
      mateusz: {
        id: "mateusz",
        userId: mateuszUid,
        active: true,
        access: { ...fullAccess },
      },
      kacper: {
        id: "kacper",
        userId: kacperUid,
        active: true,
        access: { ...fullAccess },
      },
    },
  },
  barbers: {
    mateusz: { services: service("mateusz"), workSettings: workSettings("mateusz") },
    kacper: { services: service("kacper"), workSettings: workSettings("kacper") },
  },
  appointments: {
    "mateusz-upcoming": appointment({
      id: "mateusz-upcoming",
      barberId: "mateusz",
      userId: clientAUid,
      clientId: clientAUid,
      dateKey: "2099-01-10",
      startTime: "09:00",
    }),
    "kacper-upcoming": appointment({
      id: "kacper-upcoming",
      barberId: "kacper",
      userId: clientBUid,
      clientId: clientBUid,
      dateKey: "2099-01-10",
      startTime: "10:00",
    }),
    "kacper-past": appointment({
      id: "kacper-past",
      barberId: "kacper",
      userId: clientBUid,
      clientId: clientBUid,
      dateKey: "2026-08-01",
      startTime: "10:00",
    }),
  },
  clients: {
    [clientAUid]: {
      id: clientAUid,
      firstName: "Klient",
      lastName: "A",
      email: "client-a@example.com",
      phone: "500600700",
      userId: clientAUid,
      barberIds: { mateusz: true },
    },
    [clientBUid]: {
      id: clientBUid,
      firstName: "Klient",
      lastName: "B",
      email: "client-b@example.com",
      phone: "600700800",
      userId: clientBUid,
      barberIds: { kacper: true },
    },
  },
});

const pathParts = (path) => path.split("/").filter(Boolean).map(decodeURIComponent);

const readPath = (database, path) =>
  pathParts(path).reduce((current, part) => current?.[part], database);

const writePath = (database, path, value) => {
  const keys = pathParts(path);
  let target = database;

  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  const finalKey = keys.at(-1);
  if (value === null) delete target[finalKey];
  else target[finalKey] = value;
};

const tokenUsers = {
  [tokens.owner]: { localId: ownerUid, email: "owner@example.com", emailVerified: true },
  [tokens.mateusz]: { localId: mateuszUid, email: "mateusz@example.com", emailVerified: true },
  [tokens.kacper]: { localId: kacperUid, email: "kacper@example.com", emailVerified: true },
  [tokens.clientA]: {
    localId: clientAUid,
    email: "client-a@example.com",
    emailVerified: true,
    displayName: "Klient A",
  },
  [tokens.clientB]: {
    localId: clientBUid,
    email: "client-b@example.com",
    emailVerified: true,
    displayName: "Klient B",
  },
  [tokens.unverifiedClient]: {
    localId: "unverified-client-uid",
    email: "unverified@example.com",
    emailVerified: false,
  },
};

const clone = (value) => structuredClone(value);

export const installAppointmentsFixture = () => {
  let database = createInitialDatabase();
  let revision = 1;
  const failingPatchPaths = new Set();
  const failingPutPaths = new Set();

  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);

    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "database-access-token" });
    }

    if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
      const { idToken } = JSON.parse(options.body);
      const user = tokenUsers[idToken];
      return user
        ? Response.json({ users: [user] })
        : new Response("Unauthorized", { status: 401 });
    }

    if (!url.startsWith(databaseUrl)) {
      throw new Error(`Unexpected request in appointments fixture: ${url}`);
    }

    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "").replace(/\.json$/, "");
    const method = options.method ?? "GET";

    if (method === "GET") {
      return new Response(JSON.stringify(readPath(database, path) ?? null), {
        headers: path === "appointments" || path === "" ? { ETag: `"${revision}"` } : {},
      });
    }

    if (method === "PUT") {
      if (failingPutPaths.has(path)) {
        return new Response("Forced put failure", { status: 500 });
      }
      if (["appointments", ""].includes(path) && options.headers?.["If-Match"] !== `"${revision}"`) {
        return new Response("Precondition failed", { status: 412 });
      }
      if (path === "") database = JSON.parse(options.body);
      else writePath(database, path, JSON.parse(options.body));
      revision += 1;
      return Response.json(readPath(database, path) ?? null);
    }

    if (method === "PATCH") {
      if (failingPatchPaths.has(path)) {
        return new Response("Forced patch failure", { status: 500 });
      }
      const updates = JSON.parse(options.body);
      for (const [relativePath, value] of Object.entries(updates)) {
        writePath(database, `${path}/${relativePath}`, value);
      }
      return Response.json(readPath(database, path) ?? null);
    }

    if (method === "DELETE") {
      writePath(database, path, null);
      return Response.json(null);
    }

    throw new Error(`Unsupported fixture method: ${method}`);
  };

  return {
    get database() {
      return database;
    },
    reset() {
      database = createInitialDatabase();
      revision = 1;
      failingPatchPaths.clear();
      failingPutPaths.clear();
    },
    failPatch(path) {
      failingPatchPaths.add(path);
    },
    failPut(path) {
      failingPutPaths.add(path);
    },
    snapshot() {
      return clone(database);
    },
  };
};

let operationSequence = 0;
const createLikeActions = new Set([
  "create_client",
  "create_admin",
  "upsert_admin_client",
  "hide_admin_client",
  "delete_admin_client",
  "join_waitlist",
]);

export const makeAppointmentRequest = (handler, token, method, body) =>
  handler(
    new Request("https://bnb.example/.netlify/functions/appointments", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body
        ? {
            body: JSON.stringify(
              method === "POST"
                ? {
                    operationId: body.operationId ?? `test-operation-${++operationSequence}`,
                    expectedVersion:
                      body.expectedVersion ?? (createLikeActions.has(body.action) ? 0 : 1),
                    ...body,
                  }
                : body,
            ),
          }
        : {}),
    }),
  );

export const createClientAppointment = ({
  id,
  barberId = "mateusz",
  userId = clientAUid,
  dateKey = "2099-01-10",
  startTime = "12:00",
} = {}) => ({
  id,
  barberId,
  userId,
  clientId: userId,
  serviceId: "cut",
  clientName: userId === clientBUid ? "Klient B" : "Klient A",
  clientEmail: userId === clientBUid ? "client-b@example.com" : "client-a@example.com",
  phone: userId === clientBUid ? "600700800" : "500600700",
  serviceName: "Strzyzenie",
  price: "50 zl",
  dateKey,
  startTime,
  durationMinutes: 60,
  color: "mint",
  status: "confirmed",
});
