import crypto from "node:crypto";

const databaseUrl =
  process.env.FIREBASE_DATABASE_URL ??
  "https://bnbbarber-9a7bd-default-rtdb.europe-west1.firebasedatabase.app";
const fallbackFirebaseApiKey = "AIzaSyATrBnGXzcxUR8r6Y-AeAeXDVPeKAjrymU";
const defaultOwnerUid = "xkyDu2Lb1Ma8McF7yfyv8PIAj1M2";
const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const barberSections = ["schedule", "clients", "analytics", "work", "services", "profile"];

const json = (body, status = 200) => Response.json(body, { status });

const getSiteUrl = (request) =>
  process.env.URL || process.env.DEPLOY_PRIME_URL || new URL(request.url).origin;

const normalizePrivateKey = () => process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

const base64Url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const getDatabaseAccessToken = async () => {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey();
  if (!clientEmail || !privateKey) throw new Error("Brakuje danych konta serwisowego Firebase.");

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claimSet = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.database",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claimSet}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsignedJwt).sign(privateKey, "base64");
  const assertion = `${unsignedJwt}.${signature.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("Nie udało się uwierzytelnić serwera Firebase.");
  return (await response.json()).access_token;
};

const readDatabase = async (accessToken, path) => {
  const response = await fetch(`${databaseUrl}/${path}.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Nie udało się odczytać danych zespołu.");
  return (await response.json()) ?? null;
};

const patchDatabase = async (accessToken, path, value) => {
  const response = await fetch(`${databaseUrl}/${path}.json`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error("Nie udało się zapisać danych zespołu.");
};

const getAuthenticatedUser = async (request) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Brak sesji użytkownika.");

  const apiKey =
    process.env.FIREBASE_WEB_API_KEY ??
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    fallbackFirebaseApiKey;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    },
  );
  if (!response.ok) throw new Error("Sesja użytkownika wygasła. Zaloguj się ponownie.");

  const user = (await response.json()).users?.[0];
  if (!user?.localId || !user?.email || user.emailVerified !== true) {
    throw new Error("Nie udało się potwierdzić zweryfikowanego konta Google.");
  }
  return { uid: user.localId, email: String(user.email).trim().toLocaleLowerCase("pl") };
};

const ownerUids = () =>
  new Set(
    (process.env.BNB_OWNER_UIDS || defaultOwnerUid)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

const ensureOwner = (user) => {
  if (!ownerUids().has(user.uid)) throw new Error("Tylko właściciel może zarządzać zaproszeniami.");
};

const sanitizeAccess = (access) =>
  Object.fromEntries(barberSections.map((section) => [section, access?.[section] !== false]));

const createBarberId = (name, existingIds) => {
  const base =
    String(name)
      .toLocaleLowerCase("pl")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "barber";
  let id = base;
  let suffix = 2;
  while (existingIds.includes(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
};

const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);
const hashInviteToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const createInviteToken = () => crypto.randomBytes(32).toString("base64url");

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const sendInvitationEmail = async ({ to, barberName, inviteUrl, idempotencyKey }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Brakuje konfiguracji poczty Resend.");

  const subject = "Zaproszenie do panelu BNB Barbershop";
  const text = `Siema! Zostałeś zaproszony do panelu BNB Barbershop jako ${barberName}. Otwórz link, zaloguj się swoim kontem Google (${to}) i aktywuj dostęp: ${inviteUrl}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:560px;margin:0 auto">
      <h2 style="margin:0 0 12px">Siema, ${escapeHtml(barberName)}!</h2>
      <p>Zostałeś zaproszony do panelu BNB Barbershop.</p>
      <p>Otwórz poniższy link i zaloguj się dokładnie kontem Google: <strong>${escapeHtml(to)}</strong>.</p>
      <p style="margin:24px 0"><a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#1769ff;color:#fff;text-decoration:none;font-weight:700">Aktywuj konto barbera</a></p>
      <p style="color:#6b7280;font-size:14px">Link jest ważny przez 7 dni i może być użyty tylko raz.</p>
    </div>
  `;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!response.ok) throw new Error("Nie udało się wysłać zaproszenia e-mail.");
};

const buildInvite = (siteUrl, barberId, token) => {
  const url = new URL(siteUrl);
  url.searchParams.set("barber", barberId);
  url.searchParams.set("invite", token);
  return url.toString();
};

const issueInvitation = async (accessToken, request, member) => {
  const token = createInviteToken();
  const now = Date.now();
  const expiresAt = now + inviteLifetimeMs;
  await patchDatabase(accessToken, `team/barbers/${member.id}`, {
    inviteStatus: "pending",
    inviteTokenHash: hashInviteToken(token),
    inviteSentAt: now,
    inviteExpiresAt: expiresAt,
    active: false,
    updatedAt: now,
  });
  await sendInvitationEmail({
    to: member.email,
    barberName: member.name,
    inviteUrl: buildInvite(getSiteUrl(request), member.id, token),
    idempotencyKey: `team-invite-${member.id}-${hashInviteToken(token).slice(0, 20)}`,
  });
};

const handleCreate = async (request, user, payload) => {
  ensureOwner(user);
  const name = String(payload.member?.name ?? "").trim();
  const email = String(payload.member?.email ?? "").trim().toLocaleLowerCase("pl");
  if (name.length < 2 || !isValidEmail(email)) throw new Error("Podaj imię i poprawny adres e-mail barbera.");

  const accessToken = await getDatabaseAccessToken();
  const team = (await readDatabase(accessToken, "team/barbers")) ?? {};
  const duplicateEmail = Object.values(team).some(
    (member) => String(member?.email ?? "").trim().toLocaleLowerCase("pl") === email,
  );
  if (duplicateEmail) throw new Error("Ten adres e-mail jest już przypisany do członka zespołu.");

  const memberIndex = Object.keys(team).length;
  const id = createBarberId(name, Object.keys(team));
  const now = Date.now();
  const member = {
    id,
    name,
    label: `Barber ${memberIndex + 1}`,
    accent: memberIndex % 2 === 0 ? "blue" : "mint",
    email,
    userId: "",
    active: false,
    access: sanitizeAccess(payload.member?.access),
    inviteStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
  await patchDatabase(accessToken, `team/barbers/${id}`, member);
  await patchDatabase(accessToken, `barbers/${id}/profile`, {
    displayName: name,
    email,
    updatedAt: now,
  });
  await issueInvitation(accessToken, request, member);
  return json({ ok: true, memberId: id });
};

const handleResend = async (request, user, payload) => {
  ensureOwner(user);
  const barberId = String(payload.barberId ?? "");
  if (!/^[a-z0-9-]+$/.test(barberId)) throw new Error("Nieprawidłowy barber.");

  const accessToken = await getDatabaseAccessToken();
  const member = await readDatabase(accessToken, `team/barbers/${barberId}`);
  if (!member?.email || member?.userId) throw new Error("To konto nie oczekuje na zaproszenie.");
  await issueInvitation(accessToken, request, { ...member, id: barberId });
  return json({ ok: true, memberId: barberId });
};

const handleClaim = async (request, user, payload) => {
  const barberId = String(payload.barberId ?? "");
  const inviteToken = String(payload.inviteToken ?? "");
  if (!/^[a-z0-9-]+$/.test(barberId) || inviteToken.length < 32) {
    throw new Error("Zaproszenie jest nieprawidłowe.");
  }

  const accessToken = await getDatabaseAccessToken();
  const member = await readDatabase(accessToken, `team/barbers/${barberId}`);
  if (!member) throw new Error("Nie znaleziono zaproszenia.");
  if (member.userId === user.uid) return json({ ok: true, memberId: barberId });
  if (member.userId) throw new Error("To zaproszenie zostało już wykorzystane.");
  if (member.inviteStatus !== "pending" || !member.inviteTokenHash) {
    throw new Error("To zaproszenie nie jest już aktywne.");
  }
  if (Number(member.inviteExpiresAt) < Date.now()) throw new Error("Link zaproszenia wygasł.");
  if (hashInviteToken(inviteToken) !== member.inviteTokenHash) {
    throw new Error("Link zaproszenia jest nieprawidłowy.");
  }
  if (String(member.email ?? "").trim().toLocaleLowerCase("pl") !== user.email) {
    throw new Error("Zaloguj się kontem Google wskazanym w zaproszeniu.");
  }

  const team = (await readDatabase(accessToken, "team/barbers")) ?? {};
  const duplicateUid = Object.entries(team).some(
    ([id, other]) => id !== barberId && other?.userId === user.uid,
  );
  if (duplicateUid) throw new Error("To konto Google jest już połączone z innym barberem.");

  const now = Date.now();
  await patchDatabase(accessToken, `team/barbers/${barberId}`, {
    userId: user.uid,
    active: true,
    inviteStatus: "accepted",
    inviteTokenHash: null,
    inviteExpiresAt: null,
    inviteAcceptedAt: now,
    updatedAt: now,
  });
  await patchDatabase(accessToken, `barbers/${barberId}/profile`, {
    email: user.email,
    updatedAt: now,
  });
  return json({ ok: true, memberId: barberId });
};

const handler = async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const payload = await request.json();
    const user = await getAuthenticatedUser(request);
    if (payload.action === "create") return await handleCreate(request, user, payload);
    if (payload.action === "resend") return await handleResend(request, user, payload);
    if (payload.action === "claim") return await handleClaim(request, user, payload);
    return json({ ok: false, error: "Nieprawidłowa akcja." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się obsłużyć zaproszenia.";
    const status = /sesji|Tylko właściciel/i.test(message) ? 403 : 400;
    return json({ ok: false, error: message }, status);
  }
};

export default handler;
