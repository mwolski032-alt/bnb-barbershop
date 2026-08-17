import {
  databaseUrl,
  getAccessToken,
  patchDatabase,
  readDatabase,
  readDatabaseWithEtag,
  writeDatabaseIfUnchanged,
} from "./_firebase-admin.mjs";

export const notificationEventByAction = {
  create_client: "new_booking",
  create_admin: "new_booking",
  upsert_admin_client: "new_booking",
  reschedule_client: "client_rescheduled",
  reschedule_admin: "admin_rescheduled",
  confirm_client: "client_confirmed",
  confirm_admin: "admin_confirmed",
  cancel_client: "client_cancelled",
  cancel_admin: "admin_cancelled",
};

const MAX_ATTEMPTS = 6;
const LEASE_MS = 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000];

const eventCopy = {
  new_booking: {
    target: "barber",
    title: "Nowa wizyta",
    body: (appointment) => `${appointment.clientName} zarezerwował: ${appointment.serviceName}.`,
    barberEmail: true,
    clientTitle: "Wizyta potwierdzona",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientEmail: true,
  },
  client_rescheduled: {
    target: "barber",
    title: "Klient przesunął wizytę",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    barberEmail: true,
    clientTitle: "Termin wizyty zmieniony",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientEmail: true,
  },
  client_confirmed: {
    target: "barber",
    title: "Klient potwierdził nowy termin",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    barberEmail: true,
    clientTitle: "Nowy termin potwierdzony",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientEmail: true,
  },
  client_cancelled: {
    target: "barber",
    title: "Klient odwołał wizytę",
    body: (appointment) => `${appointment.clientName} odwołał: ${appointment.serviceName}.`,
    barberEmail: true,
    clientTitle: "Wizyta odwołana",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_rescheduled: {
    target: "client",
    title: "Wizyta została przesunięta",
    body: (appointment) => `Nowy termin: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientEmail: true,
  },
  admin_confirmed: {
    target: "client",
    title: "Nowy termin został potwierdzony",
    body: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientEmail: true,
  },
  admin_cancelled: {
    target: "client",
    title: "Wizyta została odwołana",
    body: (appointment) => `${appointment.serviceName} została odwołana przez barbera.`,
    clientEmail: true,
  },
  test_push: {
    target: "client",
    title: "Test powiadomień BNB",
    body: () => "Jeśli to widzisz, powiadomienia działają na tym urządzeniu.",
  },
};

const safeKey = (value) => String(value).replace(/[.#$\[\]/]/g, "_");
const errorMessage = (error) => error instanceof Error ? error.message : "Unknown notification error.";
const barberFallbackEmail = (barberId) => {
  if (barberId === "mateusz") return process.env.BARBER_MATEUSZ_EMAIL || "";
  if (barberId === "kacper") return process.env.BARBER_KACPER_EMAIL || "";
  return "";
};

export const resolveNotificationSiteUrl = (request) => {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL;
  return configured || new URL(request.url).origin;
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const renderAppointmentEmail = (title, body, appointment) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
    <h2 style="margin: 0 0 12px;">${escapeHtml(title)}</h2>
    <p>${escapeHtml(body)}</p>
    <table style="border-collapse: collapse; margin-top: 16px;">
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Klient</td><td>${escapeHtml(appointment.clientName)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Barber</td><td>${escapeHtml(appointment.barberName || appointment.barberId)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Telefon</td><td>${escapeHtml(appointment.phone || "brak")}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Usługa</td><td>${escapeHtml(appointment.serviceName)}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Termin</td><td>${escapeHtml(`${appointment.dateKey} ${appointment.startTime}`)}</td></tr>
    </table>
  </div>
`;

const sendResendEmail = async ({ to, subject, text, html, idempotencyKey }) => {
  if (!to) return { status: "skipped", error: "" };
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { status: "failed", error: "Missing Resend configuration." };

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
  if (process.env.RESEND_REPLY_TO) payload.reply_to = process.env.RESEND_REPLY_TO;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return { status: "failed", error: (await response.text()) || `Resend error ${response.status}` };
    }
    return { status: "delivered", error: "", deliveredAt: Date.now() };
  } catch (error) {
    return { status: "failed", error: errorMessage(error) };
  }
};

const readFcmErrorCode = (value) => {
  try {
    const parsed = JSON.parse(value);
    const detail = (parsed?.error?.details ?? []).find((item) => item["@type"]?.includes("FcmError"));
    return detail?.errorCode ?? parsed?.error?.status ?? "";
  } catch {
    return "";
  }
};

const removeNotificationToken = (accessToken, device) =>
  fetch(`${databaseUrl}/notificationTokens/${encodeURIComponent(device.uid)}/${encodeURIComponent(device.deviceKey)}.json`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

const sendToDevice = async (accessToken, device, notification, appointment, event, siteUrl) => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return { status: "failed", error: "Missing FIREBASE_PROJECT_ID.", errorCode: "" };
  const link = new URL(siteUrl);
  link.searchParams.set("appointment", appointment.id);
  link.searchParams.set("event", event);

  try {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: device.token,
          data: {
            appointmentId: appointment.id,
            operationId: appointment.lastOperationId || "",
            event,
            title: notification.title,
            body: notification.body,
            link: link.href,
            tag: `appointment-${appointment.id}-${event}`,
          },
          webpush: {
            headers: { Urgency: "high", TTL: "86400" },
            fcm_options: { link: link.href },
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) return { status: "delivered", deliveredAt: Date.now(), error: "", errorCode: "" };

    const message = (await response.text()) || `FCM error ${response.status}`;
    const errorCode = readFcmErrorCode(message);
    if (["NOT_FOUND", "UNREGISTERED"].includes(errorCode)) {
      await removeNotificationToken(accessToken, device).catch(() => undefined);
      return { status: "invalid", error: message, errorCode, invalidatedAt: Date.now() };
    }
    return { status: "failed", error: message, errorCode };
  } catch (error) {
    return { status: "failed", error: errorMessage(error), errorCode: "" };
  }
};

const collectTargetDevices = ({ tokensByUser, ownerUid, barber, appointment, copy }) => {
  const audiences = new Map();
  if (copy.target === "barber" && barber.active && barber.userId) audiences.set(barber.userId, "barber");
  if (appointment.userId) audiences.set(appointment.userId, "client");
  audiences.delete(ownerUid);

  const byToken = new Map();
  for (const [uid, audience] of audiences) {
    for (const [deviceKey, device] of Object.entries(tokensByUser?.[uid] ?? {})) {
      if (!device?.token || device.active === false) continue;
      byToken.set(device.token, { uid, deviceKey, token: device.token, audience });
    }
  }
  return [...byToken.values()];
};

const readDeliveryContext = async (accessToken, appointment) => {
  const [tokensByUser, owner, member] = await Promise.all([
    readDatabase("notificationTokens", accessToken),
    readDatabase("team/owner", accessToken),
    readDatabase(`team/barbers/${encodeURIComponent(appointment.barberId)}`, accessToken),
  ]);
  return {
    tokensByUser: tokensByUser ?? {},
    ownerUid: String(owner?.userId || ""),
    barber: {
      active: member?.active === true,
      userId: member?.active === true ? String(member?.userId || "") : "",
      name: String(member?.name || ""),
      email: member?.active === true
        ? String(member?.email || barberFallbackEmail(appointment.barberId)).trim().toLowerCase()
        : "",
    },
  };
};

const audienceNotification = (copy, appointment, audience) => audience === "client"
  ? { title: copy.clientTitle || copy.title, body: (copy.clientBody || copy.body)(appointment) }
  : { title: copy.title, body: copy.body(appointment) };

const claimJob = async (operationId, accessToken, now, force) => {
  const path = `notificationOutbox/${encodeURIComponent(operationId)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { etag, value } = await readDatabaseWithEtag(path, accessToken);
    const current = value ?? {};
    if (!current.operationId) return { state: "missing", job: current };
    if (["delivered", "exhausted"].includes(current.status)) return { state: current.status, job: current };
    if (!force && Number(current.nextAttemptAt) > now) return { state: "deferred", job: current };
    if (current.status === "processing" && Number(current.leaseUntil) > now) {
      return { state: "processing", job: current };
    }
    if ((Number(current.attempts) || 0) >= MAX_ATTEMPTS) {
      await patchDatabase(path, {
        status: "exhausted",
        leaseUntil: null,
        nextAttemptAt: null,
        updatedAt: now,
        lastError: current.lastError || "Notification retry limit reached.",
      }, accessToken);
      return { state: "exhausted", job: current };
    }

    const job = {
      ...current,
      status: "processing",
      attempts: (Number(current.attempts) || 0) + 1,
      attemptId: `${operationId}:${(Number(current.attempts) || 0) + 1}`,
      leaseUntil: now + LEASE_MS,
      updatedAt: now,
    };
    if (await writeDatabaseIfUnchanged(path, job, etag, accessToken)) return { state: "claimed", job };
  }
  return { state: "contended", job: null };
};

const finishJob = async (accessToken, job, update) => {
  const now = Date.now();
  const historyKey = `attempt_${job.attempts}`;
  const history = {
    ...(job.history ?? {}),
    [historyKey]: {
      attemptId: job.attemptId,
      attempt: job.attempts,
      startedAt: job.updatedAt,
      completedAt: now,
      ...update.history,
    },
  };
  await patchDatabase(`notificationOutbox/${encodeURIComponent(job.operationId)}`, {
    status: update.status,
    attempts: job.attempts,
    nextAttemptAt: update.nextAttemptAt ?? null,
    leaseUntil: null,
    updatedAt: now,
    deliveredAt: update.status === "delivered" ? now : null,
    lastError: update.lastError || null,
    deliveries: update.deliveries,
    history,
  }, accessToken);
  return { ...update, operationId: job.operationId, attempt: job.attempts };
};

const processClaimedJob = async (accessToken, job, siteUrl) => {
  const operation = await readDatabase(`appointmentOperations/${encodeURIComponent(job.operationId)}`, accessToken);
  const expectedEvent = notificationEventByAction[operation?.action];
  const appointment = operation?.appointment;
  if (!appointment || operation.appointmentId !== job.appointmentId || expectedEvent !== job.event) {
    return finishJob(accessToken, job, {
      status: "exhausted",
      lastError: "Notification operation is missing or does not match its outbox job.",
      deliveries: job.deliveries ?? {},
      history: { status: "invalid_operation", sent: 0, failed: 1, invalid: 0 },
    });
  }

  const copy = eventCopy[job.event];
  if (!copy || !appointment.barberId) {
    return finishJob(accessToken, job, {
      status: "exhausted",
      lastError: "Notification event or barberId is invalid.",
      deliveries: job.deliveries ?? {},
      history: { status: "invalid_payload", sent: 0, failed: 1, invalid: 0 },
    });
  }

  const context = await readDeliveryContext(accessToken, appointment);
  const devices = collectTargetDevices({ ...context, appointment, copy });
  const previous = job.deliveries ?? {};
  const deviceDeliveries = { ...(previous.devices ?? {}) };
  const pendingDevices = devices.filter((device) => {
    const state = deviceDeliveries[safeKey(`${device.uid}:${device.deviceKey}`)]?.status;
    return state !== "delivered" && state !== "invalid";
  });
  const deviceResults = await Promise.all(pendingDevices.map(async (device) => {
    const result = await sendToDevice(
      accessToken,
      device,
      audienceNotification(copy, appointment, device.audience),
      appointment,
      job.event,
      siteUrl,
    );
    const deliveryKey = safeKey(`${device.uid}:${device.deviceKey}`);
    const delivery = {
      uid: device.uid,
      deviceKey: device.deviceKey,
      audience: device.audience,
      status: result.status,
      lastAttemptAt: Date.now(),
      deliveredAt: result.deliveredAt ?? null,
      invalidatedAt: result.invalidatedAt ?? null,
      error: result.error || null,
      errorCode: result.errorCode || null,
    };
    deviceDeliveries[deliveryKey] = delivery;
    await patchDatabase(
      `notificationOutbox/${encodeURIComponent(job.operationId)}/deliveries/devices/${encodeURIComponent(deliveryKey)}`,
      delivery,
      accessToken,
    ).catch(() => undefined);
    return result;
  }));

  const appointmentWithBarber = { ...appointment, barberName: context.barber.name };
  const emailDeliveries = { ...(previous.emails ?? {}) };
  const emailTasks = [];
  if (
    copy.barberEmail &&
    !["delivered", "skipped"].includes(emailDeliveries.barber?.status)
  ) {
    const title = copy.title;
    const body = copy.body(appointmentWithBarber);
    emailTasks.push(sendResendEmail({
      to: context.barber.email,
      subject: `PILNE BNB: ${title}`,
      text: body,
      html: renderAppointmentEmail(title, body, appointmentWithBarber),
      idempotencyKey: `bnb-${job.operationId}-barber`,
    }).then(async (result) => {
      emailDeliveries.barber = { ...result, lastAttemptAt: Date.now() };
      await patchDatabase(
        `notificationOutbox/${encodeURIComponent(job.operationId)}/deliveries/emails/barber`,
        emailDeliveries.barber,
        accessToken,
      ).catch(() => undefined);
      return result;
    }));
  }
  if (
    copy.clientEmail &&
    appointment.userId !== context.ownerUid &&
    !["delivered", "skipped"].includes(emailDeliveries.client?.status)
  ) {
    const title = copy.clientTitle || copy.title;
    const body = (copy.clientBody || copy.body)(appointmentWithBarber);
    emailTasks.push(sendResendEmail({
      to: appointment.clientEmail,
      subject: `BNB Barbershop: ${title}`,
      text: body,
      html: renderAppointmentEmail(title, body, appointmentWithBarber),
      idempotencyKey: `bnb-${job.operationId}-client`,
    }).then(async (result) => {
      emailDeliveries.client = { ...result, lastAttemptAt: Date.now() };
      await patchDatabase(
        `notificationOutbox/${encodeURIComponent(job.operationId)}/deliveries/emails/client`,
        emailDeliveries.client,
        accessToken,
      ).catch(() => undefined);
      return result;
    }));
  }
  const emailResults = await Promise.all(emailTasks);
  const failed = [...deviceResults, ...emailResults].filter((result) => result.status === "failed");
  const invalid = deviceResults.filter((result) => result.status === "invalid");
  const delivered = [...deviceResults, ...emailResults].filter((result) => result.status === "delivered");
  const deliveries = { devices: deviceDeliveries, emails: emailDeliveries };

  if (failed.length === 0) {
    return finishJob(accessToken, job, {
      status: "delivered",
      deliveries,
      history: {
        status: "delivered",
        targets: devices.length,
        sent: delivered.length,
        failed: 0,
        invalid: invalid.length,
      },
    });
  }

  const exhausted = job.attempts >= MAX_ATTEMPTS;
  const lastError = failed[0]?.error || "Notification delivery failed.";
  return finishJob(accessToken, job, {
    status: exhausted ? "exhausted" : "retry",
    nextAttemptAt: exhausted ? null : Date.now() + RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)],
    lastError,
    deliveries,
    history: {
      status: delivered.length > 0 ? "partial" : exhausted ? "exhausted" : "retry",
      targets: devices.length,
      sent: delivered.length,
      failed: failed.length,
      invalid: invalid.length,
      error: lastError,
    },
  });
};

export const processNotificationJob = async (operationId, options = {}) => {
  const accessToken = options.accessToken || await getAccessToken();
  const now = Number(options.now) || Date.now();
  const claim = await claimJob(operationId, accessToken, now, options.force === true);
  if (claim.state !== "claimed") return { ok: true, state: claim.state, operationId };

  try {
    const result = await processClaimedJob(accessToken, claim.job, options.siteUrl || process.env.URL || "https://bnbbarbershop.pl");
    return { ok: result.status === "delivered", state: result.status, ...result };
  } catch (error) {
    const latestJob = await readDatabase(
      `notificationOutbox/${encodeURIComponent(operationId)}`,
      accessToken,
    ).catch(() => claim.job);
    if (["delivered", "exhausted"].includes(latestJob?.status)) {
      return { ok: latestJob.status === "delivered", state: latestJob.status, operationId };
    }
    const exhausted = claim.job.attempts >= MAX_ATTEMPTS;
    const recoveryJob = {
      ...claim.job,
      deliveries: latestJob?.deliveries ?? claim.job.deliveries,
      history: latestJob?.history ?? claim.job.history,
    };
    const result = await finishJob(accessToken, recoveryJob, {
      status: exhausted ? "exhausted" : "retry",
      nextAttemptAt: exhausted ? null : Date.now() + RETRY_DELAYS_MS[Math.min(claim.job.attempts - 1, RETRY_DELAYS_MS.length - 1)],
      lastError: errorMessage(error),
      deliveries: recoveryJob.deliveries ?? {},
      history: { status: exhausted ? "exhausted" : "retry", sent: 0, failed: 1, invalid: 0, error: errorMessage(error) },
    });
    return { ok: false, state: result.status, ...result };
  }
};

export const processDueNotificationJobs = async (options = {}) => {
  const accessToken = options.accessToken || await getAccessToken();
  const now = Number(options.now) || Date.now();
  const jobs = (await readDatabase("notificationOutbox", accessToken)) ?? {};
  const due = Object.entries(jobs)
    .filter(([, job]) => {
      if (["delivered", "exhausted"].includes(job?.status)) return false;
      if (job?.status === "processing" && Number(job?.leaseUntil) > now) return false;
      return Number(job?.nextAttemptAt) <= now;
    })
    .sort(([, first], [, second]) => (Number(first?.nextAttemptAt) || Number(first?.createdAt) || 0) - (Number(second?.nextAttemptAt) || Number(second?.createdAt) || 0))
    .slice(0, Math.max(1, Math.min(50, Number(options.limit) || 20)));

  const results = await Promise.all(due.map(([operationId]) =>
    processNotificationJob(operationId, {
      accessToken,
      now,
      siteUrl: options.siteUrl,
    }),
  ));
  return {
    ok: results.every((result) => result.ok || ["processing", "deferred"].includes(result.state)),
    scanned: Object.keys(jobs).length,
    processed: results.length,
    delivered: results.filter((result) => result.state === "delivered").length,
    retrying: results.filter((result) => result.state === "retry").length,
    exhausted: results.filter((result) => result.state === "exhausted").length,
    results,
  };
};

export const sendTestDeviceNotification = async ({ uid, appointment, siteUrl }) => {
  const accessToken = await getAccessToken();
  const [tokensByUser, owner] = await Promise.all([
    readDatabase("notificationTokens", accessToken),
    readDatabase("team/owner", accessToken),
  ]);
  if (!uid || uid === owner?.userId) return { ok: false, sent: 0, targets: 0, failed: 0, error: "Owner notifications are disabled." };
  const devices = Object.entries(tokensByUser?.[uid] ?? {})
    .filter(([, device]) => device?.token && device.active !== false)
    .map(([deviceKey, device]) => ({ uid, deviceKey, token: device.token, audience: "client" }));
  const copy = eventCopy.test_push;
  const results = await Promise.all(devices.map((device) => sendToDevice(
    accessToken,
    device,
    { title: copy.title, body: copy.body(appointment) },
    appointment,
    "test_push",
    siteUrl,
  )));
  const failed = results.filter((result) => result.status === "failed");
  return {
    ok: failed.length === 0 && devices.length > 0,
    sent: results.filter((result) => result.status === "delivered").length,
    targets: devices.length,
    failed: failed.length,
    error: failed[0]?.error || (devices.length ? "" : "No active device tokens."),
  };
};
