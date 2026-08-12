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
    body: (appointment) => `${appointment.clientName} zarezerwowal: ${appointment.serviceName}.`,
    sms: (appointment) =>
      `BNB: Nowa wizyta - ${appointment.clientName}, ${appointment.serviceName}, ${appointment.dateKey} ${appointment.startTime}, tel. ${appointment.phone ?? "brak"}`,
  },
  client_rescheduled: {
    target: "admin",
    title: "Klient przesunal wizyte",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    sms: (appointment) =>
      `BNB: Klient zmienil termin - ${appointment.clientName}, ${appointment.serviceName}, ${appointment.dateKey} ${appointment.startTime}, tel. ${appointment.phone ?? "brak"}`,
  },
  client_cancelled: {
    target: "admin",
    title: "Klient odwolal wizyte",
    body: (appointment) => `${appointment.clientName} odwolal: ${appointment.serviceName}.`,
    sms: (appointment) =>
      `BNB: Klient odwolal wizyte - ${appointment.clientName}, ${appointment.serviceName}, ${appointment.dateKey} ${appointment.startTime}, tel. ${appointment.phone ?? "brak"}`,
  },
  admin_rescheduled: {
    target: "client",
    title: "Wizyta zostala przesunieta",
    body: (appointment) => `Nowy termin: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_cancelled: {
    target: "client",
    title: "Wizyta zostala odwolana",
    body: (appointment) => `${appointment.serviceName} zostala odwolana przez administratora.`,
  },
  test_push: {
    target: "client",
    title: "Test powiadomien BNB",
    body: () => "Jesli to widzisz, powiadomienia dzialaja na tym urzadzeniu.",
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

const normalizeSmsPhone = (phone) => phone?.replace(/[^\d+]/g, "").replace(/^\+/, "");

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
  const response = await fetch(`${databaseUrl}/notificationTokens.json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Token read failed: ${response.status}`);
  }

  return (await response.json()) ?? {};
};

const writePushLog = async (accessToken, payload) => {
  try {
    await fetch(`${databaseUrl}/pushDebugLogs/${Date.now()}.json`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Debug logs are best-effort only.
  }
};

const collectTargetTokens = (tokensByUser, target, appointment) => {
  const collected = [];

  for (const [uid, devices] of Object.entries(tokensByUser)) {
    for (const [deviceKey, device] of Object.entries(devices ?? {})) {
      if (!device?.token) continue;

      if (target === "admin" && device.isAdmin) {
        collected.push({ uid, deviceKey, token: device.token });
      }

      if (target === "client" && appointment.userId && uid === appointment.userId) {
        collected.push({ uid, deviceKey, token: device.token });
      }
    }
  }

  return Array.from(new Map(collected.map((device) => [device.token, device])).values());
};

const removeNotificationToken = async (accessToken, device) => {
  await fetch(`${databaseUrl}/notificationTokens/${device.uid}/${device.deviceKey}.json`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
};

const readFcmErrorCode = (errorText) => {
  try {
    const parsed = JSON.parse(errorText);
    const details = parsed?.error?.details ?? [];
    const fcmError = details.find((detail) => detail["@type"]?.includes("FcmError"));

    return fcmError?.errorCode ?? parsed?.error?.status ?? "";
  } catch {
    return "";
  }
};

const sendToToken = async (accessToken, device, notification, appointment, siteUrl) => {
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
        token: device.token,
        data: {
          appointmentId: appointment.id,
          event: appointment.event,
          title: notification.title,
          body: notification.body,
          link: siteUrl,
          tag: `appointment-${appointment.id}-${appointment.event}`,
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
  const errorCode = readFcmErrorCode(errorText);

  if (["NOT_FOUND", "UNREGISTERED"].includes(errorCode)) {
    await removeNotificationToken(accessToken, device).catch(() => undefined);
  }

  return {
    ok: false,
    error: errorText || `FCM error ${response.status}`,
    errorCode,
  };
};

const sendAdminSms = async (copy, appointment) => {
  if (!copy.sms) {
    return { enabled: false, sent: 0, failed: 0, error: "" };
  }

  const token = process.env.SMSAPI_TOKEN;
  const to = normalizeSmsPhone(process.env.ADMIN_SMS_PHONE);

  if (!token || !to) {
    return {
      enabled: false,
      sent: 0,
      failed: 1,
      error: "Missing SMSAPI_TOKEN or ADMIN_SMS_PHONE.",
    };
  }

  const body = new URLSearchParams({
    to,
    message: copy.sms(appointment).slice(0, 459),
    format: "json",
    encoding: "utf-8",
  });
  const sender = process.env.SMSAPI_FROM;

  if (sender) {
    body.set("from", sender);
  }

  const response = await fetch("https://api.smsapi.com/sms.do", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const responseText = await response.text();

  if (!response.ok) {
    return {
      enabled: true,
      sent: 0,
      failed: 1,
      error: responseText || `SMSAPI error ${response.status}`,
    };
  }

  return { enabled: true, sent: 1, failed: 0, error: "" };
};

const sendPushNotifications = async (copy, appointment, notification, siteUrl) => {
  try {
    const accessToken = await getAccessToken();
    const tokensByUser = await readNotificationTokens(accessToken);
    const tokens = collectTargetTokens(tokensByUser, copy.target, appointment);
    const eventAppointment = { ...appointment, event: appointment.event };
    const results = await Promise.all(
      tokens.map((device) => sendToToken(accessToken, device, notification, eventAppointment, siteUrl)),
    );
    const failed = results.filter((result) => !result.ok);

    return {
      accessToken,
      result: {
        sent: results.filter((result) => result.ok).length,
        targets: tokens.length,
        failed: failed.length,
        firstError: failed[0]?.error ?? "",
        firstErrorCode: failed[0]?.errorCode ?? "",
      },
    };
  } catch (error) {
    return {
      accessToken: "",
      result: {
        sent: 0,
        targets: 0,
        failed: 1,
        firstError: error instanceof Error ? error.message : "Unknown push error.",
        firstErrorCode: "",
      },
    };
  }
};

const handler = async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { event, appointment } = await request.json();
    const copy = eventCopy[event];

    if (!copy || !appointment?.id) {
      return Response.json({ ok: false, error: "Invalid notification payload." }, { status: 400 });
    }

    const siteUrl = getSiteUrl(request);
    const notification = {
      title: copy.title,
      body: copy.body(appointment),
    };
    const eventAppointment = { ...appointment, event };
    const [sms, push] = await Promise.all([
      sendAdminSms(copy, appointment),
      sendPushNotifications(copy, eventAppointment, notification, siteUrl),
    ]);
    const resultPayload = {
      ok: sms.sent > 0 || push.result.sent > 0,
      event,
      appointmentId: appointment.id,
      target: copy.target,
      appointmentUserId: appointment.userId ?? "",
      sent: push.result.sent,
      targets: push.result.targets,
      failed: push.result.failed,
      firstError: push.result.firstError,
      firstErrorCode: push.result.firstErrorCode,
      sms,
      createdAt: new Date().toISOString(),
    };

    if (push.accessToken) {
      await writePushLog(push.accessToken, resultPayload);
    }

    return Response.json(resultPayload);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown notification error.",
        createdAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
};

export default handler;
