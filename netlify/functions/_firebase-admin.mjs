import crypto from "node:crypto";

export const databaseUrl =
  process.env.FIREBASE_DATABASE_URL ??
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ??
  "https://bnbbarber-9a7bd-default-rtdb.europe-west1.firebasedatabase.app";

export const ownerUserIds = new Set(["xkyDu2Lb1Ma8McF7yfyv8PIAj1M2"]);

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

const base64Url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const normalizePrivateKey = () => process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

export const getAccessToken = async () => {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey();
  if (!clientEmail || !privateKey) {
    throw new Error("Missing Firebase service account variables.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope:
        "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claimSet}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedJwt)
    .sign(privateKey, "base64");
  const jwt = `${unsignedJwt}.${signature
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status}`);

  const value = await response.json();
  cachedAccessToken = String(value.access_token ?? "");
  cachedAccessTokenExpiresAt = Date.now() + 50 * 60 * 1000;
  if (!cachedAccessToken) throw new Error("OAuth token response is empty.");
  return cachedAccessToken;
};

export const verifyRequestUser = async (request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!idToken) return null;

  const apiKey =
    process.env.FIREBASE_API_KEY ??
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    "AIzaSyATrBnGXzcxUR8r6Y-AeAeXDVPeKAjrymU";
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) return null;

  const value = await response.json();
  const user = value.users?.[0];
  if (!user?.localId || user.disabled) return null;
  return {
    uid: String(user.localId),
    email: String(user.email ?? ""),
    displayName: String(user.displayName ?? ""),
    photoUrl: String(user.photoUrl ?? ""),
  };
};

const databaseRequest = async (path, options = {}) => {
  const accessToken = options.accessToken ?? (await getAccessToken());
  const normalizedPath = String(path).replace(/^\/+|\/+$/g, "");
  return fetch(`${databaseUrl}/${normalizedPath}.json`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers ?? {}),
    },
  });
};

export const readDatabase = async (path, accessToken) => {
  const response = await databaseRequest(path, { accessToken });
  if (!response.ok) throw new Error(`Database read failed: ${response.status}`);
  return (await response.json()) ?? null;
};

export const writeDatabase = async (path, value, accessToken) => {
  const response = await databaseRequest(path, {
    accessToken,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Database write failed: ${response.status}`);
  return (await response.json()) ?? null;
};

export const patchDatabase = async (path, value, accessToken) => {
  const response = await databaseRequest(path, {
    accessToken,
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`Database patch failed: ${response.status}`);
  return (await response.json()) ?? null;
};

export const readAppointmentsWithEtag = async (accessToken) => {
  const response = await databaseRequest("appointments", {
    accessToken,
    headers: { "X-Firebase-ETag": "true" },
  });
  if (!response.ok) throw new Error(`Appointment read failed: ${response.status}`);
  return {
    etag: response.headers.get("etag") ?? "",
    appointments: (await response.json()) ?? {},
  };
};

export const claimRateLimit = async (uid, scope, windowMs, accessToken) => {
  const safeUid = String(uid).replace(/[.#$\[\]/]/g, "_");
  const safeScope = String(scope).replace(/[.#$\[\]/]/g, "_");
  const path = `requestLimits/${safeUid}/${safeScope}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await databaseRequest(path, {
      accessToken,
      headers: { "X-Firebase-ETag": "true" },
    });
    if (!response.ok) throw new Error(`Rate limit read failed: ${response.status}`);
    const lastRequestAt = Number(await response.json()) || 0;
    if (Date.now() - lastRequestAt < windowMs) return false;
    const writeResponse = await databaseRequest(path, {
      accessToken,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": response.headers.get("etag") ?? "null_etag",
      },
      body: JSON.stringify(Date.now()),
    });
    if (writeResponse.ok) return true;
    if (writeResponse.status !== 412) {
      throw new Error(`Rate limit write failed: ${writeResponse.status}`);
    }
  }
  return false;
};

export const writeAppointmentsIfUnchanged = async (appointments, etag, accessToken) => {
  const response = await databaseRequest("appointments", {
    accessToken,
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": etag,
    },
    body: JSON.stringify(appointments),
  });
  if (response.status === 412) return false;
  if (!response.ok) throw new Error(`Appointment transaction failed: ${response.status}`);
  return true;
};

export const readTeamMember = async (barberId, accessToken) =>
  (await readDatabase(`team/barbers/${encodeURIComponent(barberId)}`, accessToken)) ?? {};

export const getAdminContext = async (user, accessToken) => {
  if (ownerUserIds.has(user.uid)) return { isAdmin: true, isOwner: true, barberId: "" };
  const team = (await readDatabase("team/barbers", accessToken)) ?? {};
  const entry = Object.entries(team).find(([, member]) => member?.userId === user.uid);
  if (!entry || entry[1]?.active === false) {
    return { isAdmin: false, isOwner: false, barberId: "" };
  }
  return { isAdmin: true, isOwner: false, barberId: entry[0] };
};

export const jsonResponse = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
