import {
  databaseUrl,
  getAccessToken,
  patchDatabase,
  readDatabase,
  readDatabaseQuery,
  readDatabaseWithEtag,
  writeDatabaseIfUnchanged,
} from "./_firebase-admin.mjs";

export const notificationEventByAction = {
  create_client: "new_booking",
  create_admin: "new_booking",
  update_admin: "admin_appointment_updated",
  upsert_admin_client: "new_booking",
  reschedule_client: "client_rescheduled",
  reschedule_admin: "admin_rescheduled",
  confirm_client: "client_confirmed",
  confirm_admin: "admin_confirmed",
  cancel_client: "client_cancelled",
  cancel_admin: "admin_cancelled",
  join_waitlist: "waitlist_joined",
  notify_waitlist: "waitlist_slot_open",
  notify_waitlist_day: "waitlist_day_open",
  settle_admin: "visit_settled",
};

const MAX_ATTEMPTS = 6;
const LEASE_MS = 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000];

const waitlistTimePreferenceLabels = {
  any: "dowolna pora",
  morning: "rano, do 12:00",
  afternoon: "po południu, 12:00–17:00",
  evening: "wieczorem, od 17:00",
};

const weekdayName = (dateKey) =>
  new Intl.DateTimeFormat("pl-PL", { weekday: "long", timeZone: "UTC" }).format(new Date(`${dateKey}T12:00:00Z`));

const formatDateKey = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || "");
};

const waitlistDateRange = (appointment) =>
  appointment.dateFrom === appointment.dateTo
    ? formatDateKey(appointment.dateFrom)
    : `${formatDateKey(appointment.dateFrom)}–${formatDateKey(appointment.dateTo)}`;

const waitlistPreferenceLabel = (appointment) =>
  waitlistTimePreferenceLabels[appointment.timePreference] || waitlistTimePreferenceLabels.any;

const formatPrice = (value, fallback = "") => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return `${amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1").replace(".", ",")} zł`;
};

const appointmentUpdateTitle = (appointment) => {
  if (!appointment.priceChanged) return "Wizyta została przesunięta";
  if (Number(appointment.priceAmount) === 0) {
    return appointment.appointmentWasCompleted
      ? "Ta wizyta była od nas 🎁"
      : "Ta wizyta jest od nas 🎁";
  }
  if (appointment.appointmentWasCompleted) return "Skorygowano cenę wizyty";
  if (Number(appointment.priceAmount) < Number(appointment.previousPriceAmount)) {
    return "Masz rabat na wizytę 🎉";
  }
  return "Zmieniono cenę wizyty";
};

const appointmentUpdateBody = (appointment) => {
  const newTerm = `${formatDateKey(appointment.dateKey)} o ${appointment.startTime}`;
  if (!appointment.priceChanged) return `Nowy termin: ${newTerm}.`;

  let priceMessage;
  if (Number(appointment.priceAmount) === 0) {
    priceMessage = appointment.appointmentWasCompleted
      ? `Rozliczenie usługi „${appointment.serviceName}” zostało zmienione z ${formatPrice(appointment.previousPriceAmount, appointment.previousPrice)} na 0 zł — ta wizyta była bezpłatna.`
      : `Usługa „${appointment.serviceName}” będzie bezpłatna — za tę wizytę nic nie płacisz.`;
  } else if (Number(appointment.priceAmount) < Number(appointment.previousPriceAmount)) {
    priceMessage = appointment.appointmentWasCompleted
      ? `Końcowa cena usługi „${appointment.serviceName}” została skorygowana z ${formatPrice(appointment.previousPriceAmount, appointment.previousPrice)} do ${formatPrice(appointment.priceAmount, appointment.price)}.`
      : `Cena usługi „${appointment.serviceName}” została obniżona z ${formatPrice(appointment.previousPriceAmount, appointment.previousPrice)} do ${formatPrice(appointment.priceAmount, appointment.price)}.`;
  } else {
    priceMessage =
      `Cena usługi „${appointment.serviceName}” została zmieniona z ` +
      `${formatPrice(appointment.previousPriceAmount, appointment.previousPrice)} na ${formatPrice(appointment.priceAmount, appointment.price)}.`;
  }
  return `${priceMessage} ${appointment.appointmentWasCompleted ? "Data wizyty" : appointment.scheduleChanged ? "Nowy termin" : "Termin"}: ${newTerm}.`;
};

const eventCopy = {
  new_booking: {
    target: "barber",
    title: "Nowa wizyta",
    body: (appointment) => `${appointment.clientName} zarezerwował: ${appointment.serviceName}.`,
    clientTitle: "Wizyta potwierdzona",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_rescheduled: {
    target: "barber",
    title: "Klient przesunął wizytę",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientTitle: "Termin wizyty zmieniony",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_confirmed: {
    target: "barber",
    title: "Klient potwierdził nowy termin",
    body: (appointment) => `${appointment.clientName}: ${appointment.dateKey}, ${appointment.startTime}.`,
    clientTitle: "Nowy termin potwierdzony",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  client_cancelled: {
    target: "barber",
    title: "Klient odwołał wizytę",
    body: (appointment) => `${appointment.clientName} odwołał: ${appointment.serviceName}.`,
    clientTitle: "Wizyta odwołana",
    clientBody: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_rescheduled: {
    target: "client",
    title: "Wizyta została przesunięta",
    body: (appointment) => `Nowy termin: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_confirmed: {
    target: "client",
    title: "Nowy termin został potwierdzony",
    body: (appointment) => `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}.`,
  },
  admin_cancelled: {
    target: "client",
    title: "Wizyta została odwołana",
    body: (appointment) => `${appointment.serviceName} została odwołana przez barbera.`,
  },
  admin_appointment_updated: {
    target: "client",
    title: appointmentUpdateTitle,
    body: appointmentUpdateBody,
  },
  waitlist_joined: {
    target: "barber",
    clientPush: false,
    title: "Nowy zapis na listę rezerwową",
    body: (appointment) =>
      `${appointment.clientName} chce umówić: ${appointment.serviceName}. Termin: ${waitlistDateRange(appointment)}, ${waitlistPreferenceLabel(appointment)}.`,
  },
  waitlist_slot_open: {
    target: "client",
    title: "Zwolnił się termin",
    body: (appointment) =>
      `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}. Termin czeka na Ciebie przez 10 minut.`,
    clientTitle: "Zwolnił się termin z listy rezerwowej",
    clientBody: (appointment) =>
      `${appointment.serviceName}: ${appointment.dateKey}, ${appointment.startTime}. Zarezerwuj w ciągu 10 minut.`,
  },
  // Sent to the client right after the barber settles a visit. Opens the visit, where the review form is.
  visit_settled: {
    target: "client",
    title: (appointment) =>
      appointment.barberName ? `Jak było u ${appointment.barberName}?` : "Jak było na wizycie?",
    body: (appointment) =>
      `Dziękujemy za wizytę: ${appointment.serviceName}. Zostaw krótką opinię, zajmie to chwilę ⭐`,
  },
  // New free days the barber added. Nothing is held: everyone can book them, the client is just told first.
  waitlist_day_open: {
    target: "client",
    title: (appointment) =>
      appointment.barberName ? `${appointment.barberName} dodał nowe terminy` : "Pojawiły się nowe terminy",
    body: (appointment) => {
      const dates = Array.isArray(appointment.newDates) && appointment.newDates.length > 0 ? appointment.newDates : [appointment.dateKey];
      const label = (dateKey) => `${weekdayName(dateKey)} ${formatDateKey(dateKey).slice(0, 5)}`;
      const days = dates.length === 1
        ? label(dates[0])
        : `${dates.slice(0, 3).map(label).join(", ")}${dates.length > 3 ? ` i ${dates.length - 3} więcej` : ""}`;
      return `${appointment.serviceName}: ${days}. Termin czeka na Ciebie na liście rezerwowej. Zarezerwuj, zanim zajmie go ktoś inny.`;
    },
  },
  test_push: {
    target: "client",
    title: "Test powiadomień BNB",
    body: () => "Jeśli to widzisz, powiadomienia działają na tym urządzeniu.",
  },
};

const safeKey = (value) => String(value).replace(/[.#$\[\]/]/g, "_");
const errorMessage = (error) => error instanceof Error ? error.message : "Unknown notification error.";
export const resolveNotificationSiteUrl = (request) => {
  const configured = process.env.URL || process.env.DEPLOY_PRIME_URL;
  return configured || new URL(request.url).origin;
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

const buildNotificationLink = (siteUrl, appointment, event) => {
  const link = new URL(siteUrl);
  link.searchParams.set("event", event);
  if (event === "waitlist_joined" && appointment.waitlistId) {
    link.searchParams.set("waitlist", appointment.waitlistId);
    link.searchParams.set("barber", appointment.barberId);
  } else if (event === "waitlist_day_open" && appointment.waitlistId) {
    // Opens the booking on that very day, with the barber and the service already chosen.
    link.searchParams.set("waitlist", appointment.waitlistId);
    link.searchParams.set("barber", appointment.barberId);
    link.searchParams.set("service", appointment.serviceId);
    link.searchParams.set("date", appointment.dateKey);
  } else if (event === "waitlist_slot_open" && appointment.waitlistId) {
    link.searchParams.set("waitlist", appointment.waitlistId);
    link.searchParams.set("barber", appointment.barberId);
    link.searchParams.set("service", appointment.serviceId);
    link.searchParams.set("date", appointment.dateKey);
    link.searchParams.set("time", appointment.startTime);
  } else {
    link.searchParams.set("appointment", appointment.id);
  }
  return link;
};

const sendToDevice = async (accessToken, device, notification, appointment, event, siteUrl, linkOverride, extraData = {}) => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) return { status: "failed", error: "Missing FIREBASE_PROJECT_ID.", errorCode: "" };
  const link = linkOverride ? new URL(linkOverride) : buildNotificationLink(siteUrl, appointment, event);

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
            ...extraData,
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
  if (copy.clientPush !== false && appointment.userId) audiences.set(appointment.userId, "client");
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

const readDeliveryContext = async (accessToken, appointment, copy) => {
  const [owner, member] = await Promise.all([
    readDatabase("team/owner", accessToken),
    readDatabase(`team/barbers/${encodeURIComponent(appointment.barberId)}`, accessToken),
  ]);
  const ownerUid = String(owner?.userId || "");
  const barberUid = member?.active === true ? String(member?.userId || "") : "";
  const targetUserIds = new Set();
  if (copy.clientPush !== false && appointment.userId) targetUserIds.add(String(appointment.userId));
  if (copy.target === "barber" && barberUid) targetUserIds.add(barberUid);
  targetUserIds.delete(ownerUid);
  const targetTokens = await Promise.all(
    [...targetUserIds].map((uid) =>
      readDatabase(`notificationTokens/${encodeURIComponent(uid)}`, accessToken),
    ),
  );
  return {
    tokensByUser: Object.fromEntries(
      [...targetUserIds].map((uid, index) => [uid, targetTokens[index] ?? {}]),
    ),
    ownerUid,
    barber: {
      active: member?.active === true,
      userId: barberUid,
      name: String(member?.name || ""),
    },
  };
};

const resolveCopy = (value, appointment) =>
  typeof value === "function" ? value(appointment) : value;

const audienceNotification = (copy, appointment, audience) => audience === "client"
  ? {
      title: resolveCopy(copy.clientTitle || copy.title, appointment),
      body: resolveCopy(copy.clientBody || copy.body, appointment),
    }
  : { title: resolveCopy(copy.title, appointment), body: resolveCopy(copy.body, appointment) };

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
  const appointment = operation?.notificationPayload ?? operation?.appointment;
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

  const context = await readDeliveryContext(accessToken, appointment, copy);
  const appointmentWithBarber = { ...appointment, barberName: context.barber.name };
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
      audienceNotification(copy, appointmentWithBarber, device.audience),
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

  const failed = deviceResults.filter((result) => result.status === "failed");
  const invalid = deviceResults.filter((result) => result.status === "invalid");
  const delivered = deviceResults.filter((result) => result.status === "delivered");
  const deliveries = { devices: deviceDeliveries };

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
  const scanLimit = Math.max(1, Math.min(50, Number(options.limit) || 20));
  const jobs =
    (await readDatabaseQuery(
      "notificationOutbox",
      { orderBy: "nextAttemptAt", startAt: 0, endAt: now, limitToFirst: scanLimit },
      accessToken,
    )) ?? {};
  const due = Object.entries(jobs)
    .filter(([, job]) => {
      if (["delivered", "exhausted"].includes(job?.status)) return false;
      if (job?.status === "processing" && Number(job?.leaseUntil) > now) return false;
      return Number(job?.nextAttemptAt) <= now;
    })
    .sort(([, first], [, second]) => (Number(first?.nextAttemptAt) || Number(first?.createdAt) || 0) - (Number(second?.nextAttemptAt) || Number(second?.createdAt) || 0))
    .slice(0, scanLimit);

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

// A push that is not tied to a visit (the evening summary). Returns how many devices received it,
// so the caller can retry later when none did.
export const sendDirectPush = async ({ accessToken, uid, title, body, tag, siteUrl, event = "daily_summary", query, data }) => {
  const [tokensForUser, owner] = await Promise.all([
    readDatabase(`notificationTokens/${encodeURIComponent(uid)}`, accessToken),
    readDatabase("team/owner", accessToken),
  ]);
  if (!uid || uid === owner?.userId) return { targets: 0, sent: 0, failed: 0 };
  const devices = Object.entries(tokensForUser ?? {})
    .filter(([, device]) => device?.token && device.active !== false)
    .map(([deviceKey, device]) => ({ uid, deviceKey, token: device.token }));
  // With `query` the link carries ?event=...&<query>. Without it the app opens where the user left off.
  const link = new URL(siteUrl);
  if (query) {
    link.searchParams.set("event", event);
    for (const [key, value] of Object.entries(query)) link.searchParams.set(key, value);
  }
  const results = await Promise.all(devices.map((device) => sendToDevice(
    accessToken,
    device,
    { title, body },
    { id: tag, lastOperationId: "" },
    event,
    siteUrl,
    link.href,
    data,
  )));
  return {
    targets: devices.length,
    sent: results.filter((result) => result.status === "delivered").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
};

export const sendTestDeviceNotification = async ({ uid, appointment, siteUrl }) => {
  const accessToken = await getAccessToken();
  const [tokensForUser, owner] = await Promise.all([
    readDatabase(`notificationTokens/${encodeURIComponent(uid)}`, accessToken),
    readDatabase("team/owner", accessToken),
  ]);
  if (!uid || uid === owner?.userId) return { ok: false, sent: 0, targets: 0, failed: 0, error: "Owner notifications are disabled." };
  const devices = Object.entries(tokensForUser ?? {})
    .filter(([, device]) => device?.token && device.active !== false)
    .map(([deviceKey, device]) => ({ uid, deviceKey, token: device.token, audience: "client" }));
  const copy = eventCopy.test_push;
  const results = await Promise.all(devices.map((device) => sendToDevice(
    accessToken,
    device,
    { title: resolveCopy(copy.title, appointment), body: resolveCopy(copy.body, appointment) },
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
