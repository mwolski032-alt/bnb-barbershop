import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
  readDatabase,
  readDatabaseWithEtag,
  readTeamMember,
  verifyRequestUser,
  writeDatabaseIfUnchanged,
} from "./_firebase-admin.mjs";
import {
  cleanText,
  isFirebaseKeySafe,
  normalizeAppointmentRecord,
  normalizeClientRecord,
  upsertCanonicalClient,
} from "../../shared/data-model.mjs";
import {
  notificationEventByAction,
  processNotificationJob,
  resolveNotificationSiteUrl,
} from "./_notification-service.mjs";
import { isBookableStartTime } from "../../shared/booking-time.mjs";

const allowedActions = new Set([
  "create_client",
  "reschedule_client",
  "confirm_client",
  "confirm_admin",
  "cancel_client",
  "create_admin",
  "reschedule_admin",
  "cancel_admin",
  "settle_admin",
  "mark_no_show_admin",
  "upsert_admin_client",
  "hide_admin_client",
  "delete_admin_client",
]);
const scheduleAdminActions = new Set([
  "create_admin",
  "reschedule_admin",
  "confirm_admin",
  "cancel_admin",
  "settle_admin",
  "mark_no_show_admin",
]);

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const timeToMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};
const rangesOverlap = (firstStart, firstDuration, secondStart, secondDuration) =>
  firstStart < secondStart + secondDuration && secondStart < firstStart + firstDuration;

const normalizeAppointment = (id, value = {}) => normalizeAppointmentRecord(id, value);

const validateAppointmentTime = (appointment) => {
  if (!isFirebaseKeySafe(appointment.id) || !isFirebaseKeySafe(appointment.barberId)) {
    return "Brak identyfikatora wizyty lub barbera.";
  }
  if (!isFirebaseKeySafe(appointment.clientId) || !isFirebaseKeySafe(appointment.serviceId)) {
    return "Wizyta nie ma prawidłowej relacji z klientem lub usługą.";
  }
  if (!datePattern.test(appointment.dateKey) || !timePattern.test(appointment.startTime)) {
    return "Nieprawidłowa data lub godzina wizyty.";
  }
  if (!Number.isInteger(appointment.durationMinutes) || appointment.durationMinutes < 15) {
    return "Nieprawidłowy czas trwania wizyty.";
  }
  return "";
};

const hasConflict = (appointments, candidate, excludedId = "") =>
  Object.entries(appointments).some(([id, raw]) => {
    if (id === excludedId) return false;
    const appointment = normalizeAppointment(id, raw);
    if (appointment.status === "cancelled") return false;
    return (
      appointment.barberId === candidate.barberId &&
      appointment.dateKey === candidate.dateKey &&
      rangesOverlap(
        timeToMinutes(appointment.startTime),
        appointment.durationMinutes,
        timeToMinutes(candidate.startTime),
        candidate.durationMinutes,
      )
    );
  });

const canAdminAccess = (admin, section) =>
  admin.isOwner || (admin.isAdmin && admin.access?.[section] === true);

const canAdminManageAppointment = (admin, appointment) =>
  admin.isOwner ||
  (admin.isAdmin && admin.access?.schedule === true && admin.barberId === appointment.barberId);

const canReadAdminAppointments = (admin) =>
  admin.isOwner ||
  (admin.isAdmin && ["schedule", "clients", "analytics"].some((section) => admin.access?.[section]));

const readClientBookingConfiguration = async (appointment, accessToken) => {
  const member = await readTeamMember(appointment.barberId, accessToken);
  if (!member?.userId || member.active !== true) throw new Error("Wybrany barber jest nieaktywny.");

  const service = await readDatabase(
    `barbers/${appointment.barberId}/services/${encodeURIComponent(appointment.serviceId)}`,
    accessToken,
  );
  if (
    !service ||
    cleanText(service.id, 120) !== appointment.serviceId ||
    cleanText(service.barberId, 80) !== appointment.barberId
  ) {
    throw new Error("Wybrana usługa nie jest już dostępna.");
  }
  appointment.serviceName = cleanText(service.name, 120);
  appointment.price = cleanText(service.price, 40);
  appointment.durationMinutes = Number(service.durationMinutes);

  const availability = await readDatabase(
    `barbers/${appointment.barberId}/workSettings/availability/${appointment.dateKey}`,
    accessToken,
  );
  if (
    !availability ||
    availability.id !== appointment.dateKey ||
    availability.dateKey !== appointment.dateKey ||
    availability.barberId !== appointment.barberId
  ) {
    throw new Error("Wybrany dzień nie jest dostępny.");
  }

  const start = timeToMinutes(appointment.startTime);
  const availabilityStart = timeToMinutes(availability.startTime);
  const availabilityEnd = timeToMinutes(availability.endTime);
  if (start < availabilityStart || start + appointment.durationMinutes > availabilityEnd) {
    throw new Error("Wybrana godzina jest poza dostępnością barbera.");
  }

  if (!isBookableStartTime(appointment.dateKey, appointment.startTime)) {
    throw new Error("Nie można zarezerwować minionego terminu.");
  }
};

const readAdminBookingConfiguration = async (appointment, accessToken) => {
  const member = await readTeamMember(appointment.barberId, accessToken);
  if (!member?.userId || member.active !== true) throw new Error("Wybrany barber jest nieaktywny.");
  const service = await readDatabase(
    `barbers/${appointment.barberId}/services/${encodeURIComponent(appointment.serviceId)}`,
    accessToken,
  );
  if (
    !service ||
    cleanText(service.id, 120) !== appointment.serviceId ||
    cleanText(service.barberId, 80) !== appointment.barberId
  ) {
    throw new Error("Wybrana usługa nie jest już dostępna.");
  }
  appointment.serviceName = cleanText(service.name, 120);
  appointment.price = cleanText(service.price, 40);
  appointment.durationMinutes = Number(service.durationMinutes);
};

const mutateDatabaseRoot = async (accessToken, mutation) => {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const { value, etag } = await readDatabaseWithEtag("", accessToken);
    const result = await mutation(structuredClone(value ?? {}));
    if (result.error) return result;
    if (result.idempotent) return result;
    if (await writeDatabaseIfUnchanged("", result.database, etag, accessToken)) return result;
    await new Promise((resolve) => setTimeout(resolve, 20 + attempt * 25));
  }
  return { error: "Dane zmieniły się w tym samym momencie. Spróbuj ponownie." };
};

const relinkClientAliases = (appointments, aliases, operationId) => {
  for (const [appointmentId, raw] of Object.entries(appointments ?? {})) {
    const appointment = normalizeAppointment(appointmentId, raw);
    const canonicalId = aliases[appointment.clientId];
    if (canonicalId && canonicalId !== appointment.clientId) {
      appointments[appointmentId] = updateAppointmentVersion(
        { ...appointment, clientId: canonicalId },
        operationId,
      );
    }
  }
};

const upsertClientIntoDatabase = (database, requestedId, value, barberId, operationId) => {
  const now = Date.now();
  const existing = database.clients?.[requestedId] ?? {};
  const result = upsertCanonicalClient(database.clients ?? {}, requestedId, {
    ...existing,
    ...value,
    barberIds: { ...(existing.barberIds ?? {}), ...(value.barberIds ?? {}), [barberId]: true },
    hiddenFor: { ...(existing.hiddenFor ?? {}), ...(value.hiddenFor ?? {}), [barberId]: false },
    createdAt: Number(existing.createdAt) || Number(value.createdAt) || now,
    updatedAt: now,
  });
  if (result.error) return result;
  database.clients = result.clients;
  database.appointments ??= {};
  relinkClientAliases(database.appointments, result.aliases, operationId);
  return result;
};

const enqueueAppointmentNotification = (database, event, appointment, operationId) => {
  if (!event) return;
  const now = Date.now();
  database.notificationOutbox ??= {};
  database.notificationOutbox[operationId] = {
    operationId,
    appointmentId: appointment.id,
    event,
    barberId: appointment.barberId,
    userId: appointment.userId,
    status: "pending",
    attempts: 0,
    maxAttempts: 6,
    nextAttemptAt: now,
    deduplicationKey: operationId,
    createdAt: now,
    updatedAt: now,
  };
};

const getWarsawDateTimeParts = (now = new Date()) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]));

const isSettlementAvailable = (appointment, now = new Date()) => {
  const parts = getWarsawDateTimeParts(now);
  const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (appointment.dateKey < todayKey) return true;
  if (appointment.dateKey > todayKey) return false;
  return timeToMinutes(`${parts.hour}:${parts.minute}`) >= timeToMinutes(appointment.startTime) + 1;
};

const isNoShowAvailable = (appointment, now = new Date()) => {
  const parts = getWarsawDateTimeParts(now);
  const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
  if (appointment.dateKey < todayKey) return true;
  if (appointment.dateKey > todayKey) return false;
  return (
    timeToMinutes(`${parts.hour}:${parts.minute}`) >=
    timeToMinutes(appointment.startTime) + appointment.durationMinutes
  );
};

const readOperation = (body) => {
  const operationId = cleanText(body.operationId, 120);
  const expectedVersion = Number(body.expectedVersion);
  if (!isFirebaseKeySafe(operationId)) {
    return { error: "Brak prawidłowego identyfikatora operacji.", status: 400 };
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return { error: "Brak prawidłowej wersji bazowej operacji.", status: 400 };
  }
  return { operationId, expectedVersion };
};

const createAppointmentVersion = (appointment, operationId) => {
  const now = Date.now();
  return {
    ...appointment,
    version: 1,
    lastOperationId: operationId,
    createdAt: Number(appointment.createdAt) || now,
    updatedAt: now,
  };
};

const updateAppointmentVersion = (appointment, operationId) => ({
  ...appointment,
  version: Math.max(1, Number(appointment.version) || 1) + 1,
  lastOperationId: operationId,
  updatedAt: Date.now(),
});

const staleVersionError = (operation, currentAppointment) => ({
  error: "Wizyta została w międzyczasie zmieniona. Pokazujemy jej najnowszy stan.",
  code: "stale_version",
  status: 409,
  operationId: operation.operationId,
  currentAppointment,
});

const requireCurrentVersion = (operation, appointment) =>
  Number(appointment.version) === operation.expectedVersion
    ? null
    : staleVersionError(operation, appointment);

const mutateAppointmentOperation = async (accessToken, operation, action, user, mutation) =>
  mutateDatabaseRoot(accessToken, async (database) => {
    database.appointmentOperations ??= {};
    const existingOperation = database.appointmentOperations[operation.operationId];
    if (existingOperation) {
      if (existingOperation.actorUid !== user.uid || existingOperation.action !== action) {
        return {
          error: "Identyfikator operacji został już użyty przez inną operację.",
          code: "operation_conflict",
          status: 409,
        };
      }
      return {
        database,
        operationId: operation.operationId,
        appointment: existingOperation.appointment,
        client: existingOperation.client,
        syncRevision: Number(existingOperation.syncRevision) || 0,
        idempotent: true,
      };
    }

    const result = await mutation(database);
    if (result.error) return result;

    const syncRevision = (Number(database.appointmentSync?.revision) || 0) + 1;
    database.appointmentSync = { revision: syncRevision, updatedAt: Date.now() };
    database.appointmentOperations[operation.operationId] = {
      operationId: operation.operationId,
      action,
      actorUid: user.uid,
      appointmentId: result.appointment?.id ?? "",
      appointment: result.appointment,
      client: result.client,
      syncRevision,
      createdAt: Date.now(),
    };

    return {
      ...result,
      database,
      operationId: operation.operationId,
      syncRevision,
      idempotent: false,
    };
  });

const getAppointmentData = async (user, admin, accessToken) => {
  const database = (await readDatabase("", accessToken)) ?? {};
  const rawTeam = database.team?.barbers ?? {};
  const teamMembers = Object.entries(rawTeam)
    .filter(([, member]) => admin.isOwner || (member?.active === true && member?.userId))
    .map(([id, member]) => ({
      id: cleanText(id, 80),
      name: cleanText(member?.name, 80),
      label: cleanText(member?.label, 80),
      accent: member?.accent === "mint" ? "mint" : "blue",
      active: member?.active === true,
      ...(admin.isOwner
        ? {
            userId: cleanText(member?.userId, 128),
            email: cleanText(member?.email, 254).toLowerCase(),
            access: Object.fromEntries(
              ["schedule", "clients", "analytics", "work", "services", "profile"].map(
                (section) => [section, member?.access?.[section] === true],
              ),
            ),
            createdAt: Number(member?.createdAt) || undefined,
            updatedAt: Number(member?.updatedAt) || undefined,
          }
        : {}),
    }));
  const rawAppointments = database.appointments ?? {};
  const occupancy = [];
  const clientAppointments = [];
  const adminAppointments = [];
  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());

  for (const [id, raw] of Object.entries(rawAppointments)) {
    const appointment = normalizeAppointment(id, raw);
    if (
      canReadAdminAppointments(admin) &&
      (admin.isOwner || appointment.barberId === admin.barberId)
    ) {
      adminAppointments.push(appointment);
    }
    if (
      appointment.status !== "cancelled" &&
      appointment.status !== "completed" &&
      appointment.status !== "no_show" &&
      appointment.dateKey >= todayKey
    ) {
      occupancy.push({
        id: appointment.id,
        barberId: appointment.barberId,
        dateKey: appointment.dateKey,
        startTime: appointment.startTime,
        durationMinutes: appointment.durationMinutes,
      });
    }
    if (appointment.userId === user.uid) clientAppointments.push(appointment);
  }

  if (canReadAdminAppointments(admin)) {
    const rawClients = canAdminAccess(admin, "clients") ? database.clients ?? {} : {};
    const appointmentClientIds = new Set(
      adminAppointments.flatMap((appointment) =>
        [appointment.clientId, appointment.userId].filter(Boolean),
      ),
    );
    const adminClients = Object.entries(rawClients)
      .filter(
        ([id, client]) =>
          admin.isOwner ||
          client?.barberIds?.[admin.barberId] === true ||
          appointmentClientIds.has(id),
      )
      .map(([id, client]) => ({ ...client, id: cleanText(client?.id || id, 120) }));

    return {
      context: admin,
      teamMembers,
      adminAppointments,
      clientAppointments,
      adminClients,
      syncRevision: Number(database.appointmentSync?.revision) || 0,
      occupancy,
    };
  }

  return {
    context: admin,
    teamMembers,
    occupancy,
    clientAppointments,
    syncRevision: Number(database.appointmentSync?.revision) || 0,
  };
};

const synchronizedOperationResponse = async (
  result,
  user,
  admin,
  accessToken,
  ok = true,
  request = null,
  notificationEvent = "",
) => {
  let notification = null;
  if (ok && notificationEvent && result.operationId && request) {
    try {
      notification = await processNotificationJob(result.operationId, {
        accessToken,
        force: true,
        siteUrl: resolveNotificationSiteUrl(request),
      });
    } catch (error) {
      notification = {
        ok: false,
        state: "queued",
        error: error instanceof Error ? error.message : "Notification delivery was queued.",
      };
    }
  }
  const snapshot = await getAppointmentData(user, admin, accessToken);
  return jsonResponse(
    {
      ok,
      ...(result.error ? { error: result.error } : {}),
      ...(result.code ? { code: result.code } : {}),
      operationId: result.operationId ?? "",
      idempotent: result.idempotent === true,
      appointment: result.appointment,
      currentAppointment: result.currentAppointment,
      client: result.client,
      notification,
      ...snapshot,
    },
    ok ? 200 : result.status ?? 409,
  );
};

const resolveManagedBarberId = async (admin, requestedBarberId, accessToken) => {
  const barberId = admin.isOwner ? cleanText(requestedBarberId, 80) : admin.barberId;
  const member = barberId ? await readTeamMember(barberId, accessToken) : null;
  if (!barberId || !member?.userId || member.active !== true) return "";
  return barberId;
};

const upsertAdminClient = async (body, admin, user, accessToken, operation, request) => {
  if (!canAdminAccess(admin, "clients")) {
    return jsonResponse({ ok: false, error: "Brak dostępu do bazy klientów." }, 403);
  }

  const clientId = cleanText(body.client?.id, 120);
  if (!isFirebaseKeySafe(clientId)) {
    return jsonResponse({ ok: false, error: "Nieprawidłowy identyfikator klienta." }, 400);
  }
  const barberId = await resolveManagedBarberId(admin, body.barberId, accessToken);
  if (!barberId) return jsonResponse({ ok: false, error: "Brak dostępu do wybranego barbera." }, 403);

  const clientValue = normalizeClientRecord(clientId, body.client);
  const appointmentIds = Array.isArray(body.appointmentIds)
    ? body.appointmentIds.map((id) => cleanText(id, 120)).filter(Boolean).slice(0, 100)
    : [];
  const proposed = body.appointment
    ? normalizeAppointment(body.appointment.id, body.appointment)
    : null;

  if (proposed) {
    if (!canAdminAccess(admin, "schedule")) {
      return jsonResponse({ ok: false, error: "Brak uprawnień do umawiania wizyt." }, 403);
    }
    proposed.clientId = clientId;
    if (!canAdminManageAppointment(admin, proposed) || proposed.barberId !== barberId) {
      return jsonResponse({ ok: false, error: "Brak uprawnień do tego terminarza." }, 403);
    }
    const validationError = validateAppointmentTime(proposed);
    if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);
    await readAdminBookingConfiguration(proposed, accessToken);
  }

  const result = await mutateAppointmentOperation(
    accessToken,
    operation,
    "upsert_admin_client",
    user,
    (database) => {
    database.appointments ??= {};
    for (const appointmentId of appointmentIds) {
      const current = database.appointments[appointmentId]
        ? normalizeAppointment(appointmentId, database.appointments[appointmentId])
        : null;
      if (!current || current.barberId !== barberId) {
        return { error: "Brak dostępu do jednej z wizyt klienta.", status: 403 };
      }
    }

    const clientResult = upsertClientIntoDatabase(
      database,
      clientId,
      clientValue,
      barberId,
      operation.operationId,
    );
    if (clientResult.error) return clientResult;

    for (const appointmentId of appointmentIds) {
      database.appointments[appointmentId] = {
        ...updateAppointmentVersion(
          normalizeAppointment(appointmentId, database.appointments[appointmentId]),
          operation.operationId,
        ),
        clientId: clientResult.canonicalId,
      };
    }

    let savedAppointment;
    if (proposed) {
      if (database.appointments[proposed.id]) return { error: "Ta wizyta już istnieje." };
      if (operation.expectedVersion !== 0) {
        return staleVersionError(operation, null);
      }
      const candidate = createAppointmentVersion(
        { ...proposed, clientId: clientResult.canonicalId },
        operation.operationId,
      );
      if (hasConflict(database.appointments, candidate)) {
        return { error: "Ten termin został właśnie zajęty." };
      }
      database.appointments[candidate.id] = candidate;
      enqueueAppointmentNotification(database, "new_booking", candidate, operation.operationId);
      savedAppointment = candidate;
    }

    return {
      database,
      client: clientResult.client,
      appointment: savedAppointment,
    };
    },
  );

  return synchronizedOperationResponse(
    result,
    user,
    admin,
    accessToken,
    !result.error,
    request,
    proposed ? "new_booking" : "",
  );
};

const hideAdminClient = async (body, admin, user, accessToken, operation) => {
  if (!canAdminAccess(admin, "clients")) {
    return jsonResponse({ ok: false, error: "Brak dostępu do bazy klientów." }, 403);
  }

  const clientId = cleanText(body.clientId, 120);
  if (!isFirebaseKeySafe(clientId)) {
    return jsonResponse({ ok: false, error: "Nieprawidłowy identyfikator klienta." }, 400);
  }
  const barberId = await resolveManagedBarberId(admin, body.barberId, accessToken);
  if (!barberId) return jsonResponse({ ok: false, error: "Brak dostępu do wybranego barbera." }, 403);

  const result = await mutateAppointmentOperation(
    accessToken,
    operation,
    "hide_admin_client",
    user,
    (database) => {
      const existing = database.clients?.[clientId];
      if (!existing || (!admin.isOwner && existing.barberIds?.[barberId] !== true)) {
        return { error: "Klient nie istnieje w tej kartotece.", status: 404 };
      }
      const client = {
        ...normalizeClientRecord(clientId, existing),
        hiddenFor: { ...(existing.hiddenFor ?? {}), [barberId]: true },
        updatedAt: Date.now(),
      };
      database.clients[clientId] = client;
      return { database, client };
    },
  );
  return synchronizedOperationResponse(result, user, admin, accessToken, !result.error);
};

const deleteAdminClient = async (body, admin, user, accessToken, operation) => {
  if (!canAdminAccess(admin, "clients")) {
    return jsonResponse({ ok: false, error: "Brak dostępu do bazy klientów." }, 403);
  }

  const clientId = cleanText(body.clientId, 120);
  if (!isFirebaseKeySafe(clientId)) {
    return jsonResponse({ ok: false, error: "Nieprawidłowy identyfikator klienta." }, 400);
  }
  const barberId = await resolveManagedBarberId(admin, body.barberId, accessToken);
  if (!barberId) return jsonResponse({ ok: false, error: "Brak dostępu do wybranego barbera." }, 403);

  const result = await mutateAppointmentOperation(
    accessToken,
    operation,
    "delete_admin_client",
    user,
    (database) => {
      const existing = database.clients?.[clientId];
      if (!existing || (!admin.isOwner && existing.barberIds?.[barberId] !== true)) {
        return { error: "Klient nie istnieje w tej kartotece.", status: 404 };
      }

      const normalizedClient = normalizeClientRecord(clientId, existing);
      const linkedAppointments = Object.entries(database.appointments ?? {}).filter(([id, raw]) => {
        const appointment = normalizeAppointment(id, raw);
        return (
          appointment.clientId === clientId ||
          Boolean(normalizedClient.userId && appointment.userId === normalizedClient.userId)
        );
      });
      if (!admin.isOwner && linkedAppointments.some(([, raw]) => raw?.barberId !== barberId)) {
        return {
          error: "Klient ma wizyty także u innego barbera. Tylko właściciel może usunąć całą kartę.",
          status: 409,
        };
      }

      const removedAppointmentIds = new Set(linkedAppointments.map(([id]) => id));
      for (const appointmentId of removedAppointmentIds) {
        delete database.appointments[appointmentId];
      }
      delete database.clients[clientId];

      for (const [operationId, savedOperation] of Object.entries(database.appointmentOperations ?? {})) {
        const savedClient = savedOperation?.client;
        if (
          removedAppointmentIds.has(savedOperation?.appointmentId) ||
          savedClient?.id === clientId ||
          Boolean(normalizedClient.userId && savedClient?.userId === normalizedClient.userId)
        ) {
          delete database.appointmentOperations[operationId];
          if (database.notificationOutbox) delete database.notificationOutbox[operationId];
        }
      }

      return {
        database,
        client: { id: clientId, deleted: true },
      };
    },
  );
  return synchronizedOperationResponse(result, user, admin, accessToken, !result.error);
};

const handler = async (request) => {
  try {
    const user = await verifyRequestUser(request);
    if (!user) return jsonResponse({ ok: false, error: "Brak ważnej sesji." }, 401);
    const accessToken = await getAccessToken();
    const admin = await getAdminContext(user, accessToken);

    if (request.method === "GET") {
      return jsonResponse({ ok: true, ...(await getAppointmentData(user, admin, accessToken)) });
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);

    const body = await request.json();
    const action = cleanText(body.action, 40);
    if (!allowedActions.has(action)) return jsonResponse({ ok: false, error: "Nieznana operacja." }, 400);
    const operation = readOperation(body);
    if (operation.error) {
      return jsonResponse({ ok: false, error: operation.error }, operation.status);
    }
    if (scheduleAdminActions.has(action) && !canAdminAccess(admin, "schedule")) {
      return jsonResponse({ ok: false, error: "Brak uprawnień do terminarza." }, 403);
    }

    if (action === "upsert_admin_client") {
      return upsertAdminClient(body, admin, user, accessToken, operation, request);
    }
    if (action === "hide_admin_client") {
      return hideAdminClient(body, admin, user, accessToken, operation);
    }
    if (action === "delete_admin_client") {
      return deleteAdminClient(body, admin, user, accessToken, operation);
    }

    const proposed = body.appointment
      ? normalizeAppointment(body.appointment.id, body.appointment)
      : null;
    const appointmentId = cleanText(body.appointmentId || proposed?.id, 120);

    if (action === "create_client") {
      if (!proposed || proposed.userId && proposed.userId !== user.uid) {
        return jsonResponse({ ok: false, error: "Nieprawidłowy właściciel wizyty." }, 403);
      }
      proposed.userId = user.uid;
      proposed.clientId = user.uid;
      proposed.clientEmail = user.email;
      proposed.clientPhotoUrl = user.photoUrl;
      proposed.status = "confirmed";
      if (proposed.clientName.length < 3 || proposed.phone.replace(/\D/g, "").length !== 9) {
        return jsonResponse({ ok: false, error: "Nieprawidłowe dane klienta." }, 400);
      }
      const validationError = validateAppointmentTime(proposed);
      if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);
      await readClientBookingConfiguration(proposed, accessToken);

      const nameParts = proposed.clientName.split(/\s+/).filter(Boolean);
      const clientValue = normalizeClientRecord(user.uid, {
        firstName: cleanText(body.client?.firstName || nameParts[0], 80),
        lastName: cleanText(body.client?.lastName || nameParts.slice(1).join(" "), 80),
        email: user.email,
        phone: cleanText(body.client?.phone || proposed.phone, 32),
        photoUrl: user.photoUrl,
        userId: user.uid,
      });
      const createResult = await mutateAppointmentOperation(
        accessToken,
        operation,
        action,
        user,
        (database) => {
        database.appointments ??= {};
        if (database.appointments[proposed.id]) return { error: "Ta wizyta już istnieje." };
        if (operation.expectedVersion !== 0) return staleVersionError(operation, null);

        const clientResult = upsertClientIntoDatabase(
          database,
          user.uid,
          clientValue,
          proposed.barberId,
          operation.operationId,
        );
        if (clientResult.error) return clientResult;
        const candidate = createAppointmentVersion(
          { ...proposed, clientId: clientResult.canonicalId },
          operation.operationId,
        );
        if (hasConflict(database.appointments, candidate)) {
          return { error: "Ten termin został właśnie zajęty." };
        }
        database.appointments[candidate.id] = candidate;
        enqueueAppointmentNotification(database, "new_booking", candidate, operation.operationId);
        return { database, appointment: candidate, client: clientResult.client };
        },
      );

      return synchronizedOperationResponse(
        createResult,
        user,
        admin,
        accessToken,
        !createResult.error,
        request,
        "new_booking",
      );
    }

    if (action === "create_admin") {
      if (!admin.isAdmin || !proposed || !canAdminManageAppointment(admin, proposed)) {
        return jsonResponse({ ok: false, error: "Brak uprawnień do tego terminarza." }, 403);
      }
      const validationError = validateAppointmentTime(proposed);
      if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);
      await readAdminBookingConfiguration(proposed, accessToken);
      const client = await readDatabase(
        `clients/${encodeURIComponent(proposed.clientId)}`,
        accessToken,
      );
      if (!client || client.barberIds?.[proposed.barberId] !== true) {
        return jsonResponse({ ok: false, error: "Klient nie jest przypisany do tego barbera." }, 400);
      }
    }

    const result = await mutateAppointmentOperation(
      accessToken,
      operation,
      action,
      user,
      async (database) => {
      const appointments = database.appointments ?? {};
      if (action === "create_client" || action === "create_admin") {
        if (appointments[proposed.id]) return { error: "Ta wizyta już istnieje." };
        if (operation.expectedVersion !== 0) return staleVersionError(operation, null);
        const candidate = createAppointmentVersion(proposed, operation.operationId);
        if (hasConflict(appointments, candidate)) return { error: "Ten termin został właśnie zajęty." };
        appointments[candidate.id] = candidate;
        database.appointments = appointments;
        enqueueAppointmentNotification(
          database,
          notificationEventByAction[action],
          candidate,
          operation.operationId,
        );
        return { database, appointment: candidate };
      }

      const currentRaw = appointments[appointmentId];
      if (!currentRaw) return { error: "Wizyta nie istnieje.", status: 404 };
      const current = normalizeAppointment(appointmentId, currentRaw);
      const isClientAction = action.endsWith("_client");
      if (isClientAction && current.userId !== user.uid) {
        return { error: "Brak dostępu do wizyty.", status: 403 };
      }
      if (!isClientAction && (!admin.isAdmin || !canAdminManageAppointment(admin, current))) {
        return { error: "Brak uprawnień do tego terminarza.", status: 403 };
      }
      const versionError = requireCurrentVersion(operation, current);
      if (versionError) return versionError;
      if (["cancelled", "completed", "no_show"].includes(current.status)) {
        return { error: "Zamkniętej wizyty nie można już zmieniać.", status: 409 };
      }
      if (
        (action === "confirm_client" || action === "confirm_admin") &&
        (current.status !== "rescheduled" ||
          (action === "confirm_client" && current.rescheduledBy === "client") ||
          (action === "confirm_admin" && current.rescheduledBy === "admin"))
      ) {
        return { error: "Ta zmiana terminu została już potwierdzona.", status: 409 };
      }

      let next = { ...current };
      if (action === "reschedule_client" || action === "reschedule_admin") {
        next.dateKey = cleanText(body.dateKey, 10);
        next.startTime = cleanText(body.startTime, 5);
        next.status = "rescheduled";
        next.rescheduledAt = Date.now();
        next.rescheduledBy = action === "reschedule_client" ? "client" : "admin";
        const validationError = validateAppointmentTime(next);
        if (validationError) return { error: validationError };
        if (action === "reschedule_client") await readClientBookingConfiguration(next, accessToken);
        if (hasConflict(appointments, next, appointmentId)) {
          return { error: "Ten termin został właśnie zajęty." };
        }
      } else if (action === "confirm_client" || action === "confirm_admin") {
        next.status = "confirmed";
        next.confirmedAt = Date.now();
        next.confirmedBy = action === "confirm_client" ? "client" : "admin";
      } else if (action === "cancel_client" || action === "cancel_admin") {
        next.status = "cancelled";
        next.cancelledAt = Date.now();
        next.cancelledBy = action === "cancel_client" ? "client" : "admin";
      } else if (action === "settle_admin") {
        if (!isSettlementAvailable(next)) {
          return { error: "Tej wizyty nie można jeszcze rozliczyć.", status: 409 };
        }
        const amount = Math.max(0, Number(body.amount) || 0);
        const settledAt = Date.now();
        next.status = "completed";
        next.settlement = { barberId: next.barberId, settledAt, amount };
      } else if (action === "mark_no_show_admin") {
        if (!isNoShowAvailable(next)) {
          return { error: "Nieobecność można oznaczyć dopiero po zakończeniu wizyty.", status: 409 };
        }
        next.status = "no_show";
        next.noShowAt = Date.now();
        next.noShowBy = "admin";
      }

      next = updateAppointmentVersion(next, operation.operationId);
      const removesClientHistory = ["cancel_client", "cancel_admin", "mark_no_show_admin"].includes(action);
      if (removesClientHistory) {
        delete appointments[appointmentId];
        const client = database.clients?.[current.clientId];
        const hasRemainingClientHistory = Object.entries(appointments).some(([id, raw]) => {
          const appointment = normalizeAppointment(id, raw);
          return (
            (appointment.clientId === current.clientId ||
              Boolean(current.userId && appointment.userId === current.userId)) &&
            !["cancelled", "no_show"].includes(appointment.status)
          );
        });
        if (client?.userId && !hasRemainingClientHistory) {
          delete database.clients[current.clientId];
        }
      } else {
        appointments[appointmentId] = next;
      }
      database.appointments = appointments;
      enqueueAppointmentNotification(
        database,
        notificationEventByAction[action],
        next,
        operation.operationId,
      );
      return { database, appointment: next };
      },
    );

    return synchronizedOperationResponse(
      result,
      user,
      admin,
      accessToken,
      !result.error,
      request,
      notificationEventByAction[action] ?? "",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nieznany błąd serwera.";
    const status = /nieaktywny|dostępn|godzina|minionego/i.test(message) ? 409 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
};

export default handler;
