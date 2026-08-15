import crypto from "node:crypto";

const databaseUrl =
  process.env.FIREBASE_DATABASE_URL ??
  "https://bnbbarber-9a7bd-default-rtdb.europe-west1.firebasedatabase.app";

const fixedBarberUserIds = {
  mateusz: "XxBe4dwVYWZPtl004J4tWq6AMZ73",
  kacper: "TVwF6j7ePiTFhiGTWWPrq9nmRvJ3",
};

const getBarberFallbackEmail = (barberId) => {
  if (barberId === "mateusz") return process.env.BARBER_MATEUSZ_EMAIL || "";
  if (barberId === "kacper") return process.env.BARBER_KACPER_EMAIL || "";
  return "";
};

const getSiteUrl = (request) => {
  const netlifyUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (netlifyUrl) return netlifyUrl;

  return new URL(request.url).origin;
};

const eventCopy = {
  new_booking: {
    target: "barber",
    title: "Nowa wizyta",
    body: (appointment) => `${appointment.clientName} zarezerwowal: ${appointment.serviceName}.`,
    sms: (appointment) =>
      `BNB: Nowa wizyta - ${appointment.clientName}, ${appointment.serviceName}, ${appointment.dateKey} ${appointment.startTime}, tel. ${appointment.phone ?? "brak"}`,
  },
  client_rescheduled: {
    target: "barber",
    title: "Klient przesunal wizyte",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    sms: (appointment) =>
      `BNB: Klient zmienil termin - ${appointment.clientName}, ${appointment.serviceName}, ${appointment.dateKey} ${appointment.startTime}, tel. ${appointment.phone ?? "brak"}`,
  },
  client_cancelled: {
    target: "barber",
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

const clientEmailCopy = {
  new_booking: {
    title: "Potwierdzenie wizyty",
    body: (appointment) =>
      `Twoja wizyta w BNB Barbershop zostala potwierdzona: ${appointment.serviceName}, ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_rescheduled: {
    title: "Potwierdzenie zmiany terminu",
    body: (appointment) =>
      `Zmienilismy termin Twojej wizyty: ${appointment.serviceName}, ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_rescheduled: {
    title: "Wizyta zostala przesunieta",
    body: (appointment) =>
      `Administrator przesunal Twoja wizyte. Nowy termin: ${appointment.serviceName}, ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_cancelled: {
    title: "Wizyta zostala odwolana",
    body: (appointment) =>
      `Twoja wizyta ${appointment.serviceName}, ${appointment.dateKey}, ${appointment.startTime} zostala odwolana przez administratora.`,
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

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const renderAppointmentEmail = (copy, appointment, intro) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
    <h2 style="margin: 0 0 12px;">${escapeHtml(copy.title)}</h2>
    <p>${escapeHtml(intro ?? copy.body(appointment))}</p>
    <table style="border-collapse: collapse; margin-top: 16px;">
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Klient</td><td>${escapeHtml(appointment.clientName)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Barber</td><td>${escapeHtml(appointment.barberName || (appointment.barberId === "mateusz" ? "Mateusz" : appointment.barberId))}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Telefon</td><td>${escapeHtml(appointment.phone ?? "brak")}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Usluga</td><td>${escapeHtml(appointment.serviceName)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Termin</td><td>${escapeHtml(`${appointment.dateKey} ${appointment.startTime}`)}</td></tr>
    </table>
  </div>
`;

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

const readBarberContact = async (accessToken, barberId) => {
  const response = await fetch(`${databaseUrl}/team/barbers/${encodeURIComponent(barberId)}.json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Barber contact read failed: ${response.status}`);
  }

  const member = (await response.json()) ?? {};
  const active = member.active !== false;
  return {
    active,
    email: active ? String(member.email ?? "").trim().toLocaleLowerCase("pl") : "",
    userId: active ? String(member.userId || fixedBarberUserIds[barberId] || "").trim() : "",
    name: String(member.name ?? "").trim(),
  };
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

const collectTargetTokens = (tokensByUser, target, appointment, barberUserId) => {
  const collected = [];

  for (const [uid, devices] of Object.entries(tokensByUser)) {
    for (const [deviceKey, device] of Object.entries(devices ?? {})) {
      if (!device?.token) continue;

      if (target === "barber" && barberUserId && uid === barberUserId) {
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

const sendResendEmail = async ({ to, subject, text, html, idempotencyKey }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    return {
      enabled: false,
      sent: 0,
      failed: 1,
      error: "Missing RESEND_API_KEY, recipient email or RESEND_FROM_EMAIL.",
    };
  }

  const payload = {
    from,
    to,
    subject,
    text,
    html,
    headers: {
      Importance: "high",
      Priority: "urgent",
      "X-Priority": "1",
      "X-MSMail-Priority": "High",
    },
  };
  const replyTo = process.env.RESEND_REPLY_TO;

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();

  if (!response.ok) {
    return {
      enabled: true,
      sent: 0,
      failed: 1,
      error: responseText || `Resend error ${response.status}`,
    };
  }

  return { enabled: true, sent: 1, failed: 0, error: "" };
};

const sendBarberEmail = async (copy, appointment) => {
  if (!copy.sms) {
    return { enabled: false, sent: 0, failed: 0, error: "" };
  }

  let barberContact;
  try {
    const accessToken = await getAccessToken();
    barberContact = await readBarberContact(accessToken, appointment.barberId);
  } catch (error) {
    return {
      enabled: false,
      sent: 0,
      failed: 1,
      error: error instanceof Error ? error.message : "Could not resolve barber email.",
    };
  }

  if (!barberContact.active) {
    return { enabled: false, sent: 0, failed: 0, error: "Barber account is inactive." };
  }

  const recipient = barberContact.email || getBarberFallbackEmail(appointment.barberId);
  if (!recipient) {
    return { enabled: false, sent: 0, failed: 0, error: "" };
  }

  const barberAppointment = { ...appointment, barberName: barberContact.name };

  return sendResendEmail({
    to: recipient,
    subject: `PILNE BNB: ${copy.title}`,
    text: copy.sms?.(barberAppointment) ?? copy.body(barberAppointment),
    html: renderAppointmentEmail(copy, barberAppointment),
    idempotencyKey: `${appointment.id}-${appointment.event ?? "event"}-${appointment.barberId}-email`,
  });
};

const sendClientEmail = async (event, appointment) => {
  const copy = clientEmailCopy[event];
  const to = appointment.clientEmail;

  if (!copy) {
    return { enabled: false, sent: 0, failed: 0, error: "" };
  }

  if (!to) {
    return { enabled: false, sent: 0, failed: 1, error: "Missing appointment.clientEmail." };
  }

  return sendResendEmail({
    to,
    subject: `BNB Barbershop: ${copy.title}`,
    text: copy.body(appointment),
    html: renderAppointmentEmail(copy, appointment),
    idempotencyKey: `${appointment.id}-${event}-client-email`,
  });
};

const sendPushNotifications = async (copy, appointment, notification, siteUrl) => {
  try {
    const accessToken = await getAccessToken();
    const [tokensByUser, barberContact] = await Promise.all([
      readNotificationTokens(accessToken),
      copy.target === "barber"
        ? readBarberContact(accessToken, appointment.barberId)
        : Promise.resolve({ userId: "" }),
    ]);
    const tokens = collectTargetTokens(
      tokensByUser,
      copy.target,
      appointment,
      barberContact.userId,
    );
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
    const eventAppointment = {
      ...appointment,
      barberId: appointment.barberId || "mateusz",
      event,
    };
    const notification = {
      title: copy.title,
      body: copy.body(eventAppointment),
    };
    const [email, clientEmail, push] = await Promise.all([
      sendBarberEmail(copy, eventAppointment),
      sendClientEmail(event, eventAppointment),
      sendPushNotifications(copy, eventAppointment, notification, siteUrl),
    ]);
    const sms = { enabled: false, sent: 0, failed: 0, error: "Owner SMS notifications are disabled." };
    const whatsapp = {
      enabled: false,
      mode: "",
      sent: 0,
      failed: 0,
      error: "Owner WhatsApp notifications are disabled.",
    };
    const resultPayload = {
      ok: sms.sent > 0 || whatsapp.sent > 0 || email.sent > 0 || clientEmail.sent > 0 || push.result.sent > 0,
      event,
      appointmentId: appointment.id,
      target: copy.target,
      appointmentUserId: appointment.userId ?? "",
      appointmentBarberId: eventAppointment.barberId,
      sent: push.result.sent,
      targets: push.result.targets,
      failed: push.result.failed,
      firstError: push.result.firstError,
      firstErrorCode: push.result.firstErrorCode,
      sms,
      whatsapp,
      email,
      clientEmail,
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
