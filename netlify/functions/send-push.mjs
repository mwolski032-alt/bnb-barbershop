import crypto from "node:crypto";

const databaseUrl =
  process.env.FIREBASE_DATABASE_URL ??
  "https://bnbbarber-9a7bd-default-rtdb.europe-west1.firebasedatabase.app";

const getSiteUrl = (request) => {
  const netlifyUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (netlifyUrl) return netlifyUrl;

  return new URL(request.url).origin;
};

const eventCopy = {
  new_booking: {
    target: "admin",
    title: "Nowa wizyta",
    body: (appointment) => `${appointment.clientName} zarezerwował: ${appointment.serviceName}.`,
  },
  client_rescheduled: {
    target: "admin",
    title: "Klient przesunął wizytę",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_cancelled: {
    target: "admin",
    title: "Klient odwołał wizytę",
    body: (appointment) => `${appointment.clientName} odwołał: ${appointment.serviceName}.`,
  },
  admin_rescheduled: {
    target: "client",
    title: "Wizyta została przesunięta",
    body: (appointment) => `Nowy termin: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_cancelled: {
    target: "client",
    title: "Wizyta została odwołana",
    body: (appointment) => `${appointment.serviceName} została odwołana przez administratora.`,
  },
};

const base64Url = (value) =>
  Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const normalizePrivateKey = () => {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  return key?.replace(/\\n/g, "\n");
};

const getAccessToken = async () => {
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
      scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  );
  const unsignedJwt = `${header}.${claimSet}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsignedJwt).sign(privateKey, "base64");
  const jwt = `${unsignedJwt}.${signature.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth token request failed: ${response.status}`);
  }

  const value = await response.json();
  return value.access_token;
};

const readNotificationTokens = async (accessToken) => {
  const response = await fetch(`${databaseUrl}/notificationTokens.json?access_token=${accessToken}`);
  if (!response.ok) {
    throw new Error(`Token read failed: ${response.status}`);
  }

  return (await response.json()) ?? {};
};

const collectTargetTokens = (tokensByUser, target, appointment) => {
  const collected = [];

  for (const [uid, devices] of Object.entries(tokensByUser)) {
    for (const device of Object.values(devices ?? {})) {
      if (!device?.token) continue;

      if (target === "admin" && device.isAdmin) {
        collected.push(device.token);
      }

      if (target === "client" && appointment.userId && uid === appointment.userId) {
        collected.push(device.token);
      }
    }
  }

  return [...new Set(collected)];
};

const sendToToken = async (accessToken, token, notification, appointment, siteUrl) => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID.");
  }

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification,
        data: {
          appointmentId: appointment.id,
          event: appointment.event,
        },
        webpush: {
          fcm_options: {
            link: siteUrl,
          },
          notification: {
            ...notification,
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            tag: `appointment-${appointment.id}-${appointment.event}`,
          },
        },
      },
    }),
  });

  if (response.ok) {
    return { ok: true };
  }

  const errorText = await response.text();
  return { ok: false, error: errorText || `FCM error ${response.status}` };
};

export default async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { event, appointment } = await request.json();
    const copy = eventCopy[event];

    if (!copy || !appointment?.id) {
      return Response.json({ ok: false, error: "Invalid notification payload." }, { status: 400 });
    }

    const accessToken = await getAccessToken();
    const tokensByUser = await readNotificationTokens(accessToken);
    const tokens = collectTargetTokens(tokensByUser, copy.target, appointment);
    const siteUrl = getSiteUrl(request);
    const notification = {
      title: copy.title,
      body: copy.body(appointment),
    };
    const eventAppointment = { ...appointment, event };
    const results = await Promise.all(
      tokens.map((token) => sendToToken(accessToken, token, notification, eventAppointment, siteUrl)),
    );
    const failed = results.filter((result) => !result.ok);

    return Response.json({
      ok: true,
      sent: results.filter((result) => result.ok).length,
      targets: tokens.length,
      failed: failed.length,
      firstError: failed[0]?.error,
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown push error." },
      { status: 500 },
    );
  }
};
