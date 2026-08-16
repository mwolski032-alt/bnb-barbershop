import {
  databaseUrl,
  claimRateLimit,
  fixedBarberUserIds,
  getAccessToken,
  getAdminContext,
  jsonResponse,
  readDatabase,
  verifyRequestUser,
} from "./_firebase-admin.mjs";

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
    userId: active ? String(fixedBarberUserIds[barberId] || member.userId || "").trim() : "",
    name: String(member.name ?? "").trim(),
  };
};

const clientPushCopy = {
  new_booking: {
    title: "Wizyta potwierdzona",
    body: (appointment) =>
      `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_rescheduled: {
    title: "Termin wizyty zmieniony",
    body: (appointment) =>
      `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_cancelled: {
    title: "Wizyta odwołana",
    body: (appointment) =>
      `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_rescheduled: eventCopy.admin_rescheduled,
  admin_cancelled: eventCopy.admin_cancelled,
  test_push: eventCopy.test_push,
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

const collectTargetTokens = (tokensByUser, event, appointment, barberUserId) => {
  const collected = [];

  for (const [uid, devices] of Object.entries(tokensByUser)) {
    for (const [deviceKey, device] of Object.entries(devices ?? {})) {
      if (!device?.token) continue;

      if (eventCopy[event].target === "barber" && barberUserId && uid === barberUserId) {
        collected.push({ uid, deviceKey, token: device.token, audience: "barber" });
      }

      if (appointment.userId && uid === appointment.userId) {
        collected.push({ uid, deviceKey, token: device.token, audience: "client" });
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
  const notificationLink = new URL(siteUrl);
  notificationLink.searchParams.set("appointment", appointment.id);
  notificationLink.searchParams.set("event", appointment.event);

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
          link: notificationLink.href,
          tag: `appointment-${appointment.id}-${appointment.event}`,
        },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "86400",
          },
          fcm_options: {
            link: notificationLink.href,
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
    idempotencyKey: `${appointment.id}-${appointment.event ?? "event"}-${appointment.dateKey}-${appointment.startTime}-${appointment.barberId}-email`,
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
    idempotencyKey: `${appointment.id}-${event}-${appointment.dateKey}-${appointment.startTime}-client-email`,
  });
};

const sendPushNotifications = async (event, copy, appointment, notification, siteUrl) => {
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
      event,
      appointment,
      barberContact.userId,
    );
    const eventAppointment = { ...appointment, event: appointment.event };
    const results = await Promise.all(
      tokens.map((device) => {
        const audienceCopy = device.audience === "client" ? clientPushCopy[event] : null;
        const audienceNotification = audienceCopy
          ? {
              title: audienceCopy.title,
              body: audienceCopy.body(eventAppointment),
            }
          : notification;
        return sendToToken(
          accessToken,
          device,
          audienceNotification,
          eventAppointment,
          siteUrl,
        );
      }),
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

const isAdminAllowedForAppointment = (admin, appointment) =>
  admin.isOwner || (admin.isAdmin && admin.barberId === appointment.barberId);

const validateNotificationAccess = (event, appointment, user, admin) => {
  if (event === "test_push") return appointment.userId === user.uid;
  if (event.startsWith("client_")) return appointment.userId === user.uid;
  if (event.startsWith("admin_")) return isAdminAllowedForAppointment(admin, appointment);
  if (event === "new_booking") {
    return appointment.userId === user.uid || isAdminAllowedForAppointment(admin, appointment);
  }
  return false;
};

const handler = async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ ok: false, error: "Brak ważnej sesji." }, 401);
    const accessToken = await getAccessToken();
    const admin = await getAdminContext(user, accessToken);
    const { event, appointment: requestedAppointment } = await request.json();
    const copy = eventCopy[event];

    if (!copy || !requestedAppointment?.id) {
      return jsonResponse({ ok: false, error: "Invalid notification payload." }, 400);
    }
    const rateLimitGranted = await claimRateLimit(
      user.uid,
      `notification-${event}-${requestedAppointment.id}`,
      2000,
      accessToken,
    );
    if (!rateLimitGranted) {
      return jsonResponse({ ok: false, error: "Powiadomienie zostało już wysłane." }, 429);
    }

    const appointment = event === "test_push"
      ? { ...requestedAppointment, userId: user.uid }
      : await readDatabase(`appointments/${encodeURIComponent(requestedAppointment.id)}`, accessToken);
    if (!appointment) return jsonResponse({ ok: false, error: "Wizyta nie istnieje." }, 404);
    appointment.id ||= requestedAppointment.id;
    appointment.barberId ||= "mateusz";
    if (!validateNotificationAccess(event, appointment, user, admin)) {
      return jsonResponse({ ok: false, error: "Brak dostępu do powiadomienia." }, 403);
    }
    if (
      ((event === "client_cancelled" || event === "admin_cancelled") && appointment.status !== "cancelled") ||
      ((event === "client_rescheduled" || event === "admin_rescheduled") && appointment.status !== "rescheduled")
    ) {
      return jsonResponse({ ok: false, error: "Stan wizyty nie pasuje do zdarzenia." }, 409);
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
      sendPushNotifications(event, copy, eventAppointment, notification, siteUrl),
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

    return jsonResponse(resultPayload);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown notification error.",
        createdAt: new Date().toISOString(),
      },
      500,
    );
  }
};

export default handler;
