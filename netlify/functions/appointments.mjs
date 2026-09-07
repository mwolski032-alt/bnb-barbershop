import {
  getAccessToken,
  DatabaseLeaseError,
  getAdminContext,
  jsonResponse,
  readDatabase,
  readDatabaseQuery,
  readTeamMember,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import { mutateScopedDatabase } from "./_scoped-database.mjs";
import { createAppointmentReadPlan } from "./lib/appointment-read-plan.mjs";
import { inspectClientMerge, mergeConfirmedClients } from "./lib/client-merge.mjs";
import {
  cleanText,
  isFirebaseKeySafe,
  normalizeAppointmentRecord,
  normalizeClientRecord,
  upsertCanonicalClient,
} from "../../shared/data-model.mjs";
import {
  notificationEventByAction,
} from "./_notification-service.mjs";
import { isBookableStartTime } from "../../shared/booking-time.mjs";
import {
  consumeMatchingWaitlistEntry,
  hasBlockingWaitlistOffer,
  offerWaitlistSlot,
} from "../../shared/waitlist.mjs";

const allowedActions = new Set([
  "create_client",
  "reschedule_client",
  "confirm_client",
  "confirm_admin",
  "cancel_client",
  "create_admin",
  "update_admin",
  "reschedule_admin",
  "cancel_admin",
  "settle_admin",
  "mark_no_show_admin",
  "upsert_admin_client",
  "merge_admin_clients",
  "hide_admin_client",
  "delete_admin_client",
  "join_waitlist",
  "leave_waitlist",
  "remove_waitlist_admin",
]);
const scheduleAdminActions = new Set([
  "create_admin",
  "update_admin",
  "reschedule_admin",
  "confirm_admin",
  "cancel_admin",
  "settle_admin",
  "mark_no_show_admin",
]);

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const waitlistTimePreferences = new Set(["any", "morning", "afternoon", "evening"]);
const maximumAppointmentPrice = 10_000;

const timeToMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};
const rangesOverlap = (firstStart, firstDuration, secondStart, secondDuration) =>
  firstStart < secondStart + secondDuration && secondStart < firstStart + firstDuration;

const parsePriceAmount = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!normalized) return Number.NaN;
  const decimalValue = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
  return Number(decimalValue);
};

const getAppointmentPriceAmount = (appointment) => {
  const storedAmount = Number(appointment.priceAmount);
  return Number.isFinite(storedAmount) ? storedAmount : parsePriceAmount(appointment.price);
};

const readRequestedPriceAmount = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { error: "Podaj cenę wizyty." };
  }
  const amount = Number(String(value).replace(",", "."));
  const roundedAmount = Math.round(amount * 100) / 100;
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > maximumAppointmentPrice ||
    Math.abs(amount - roundedAmount) > 0.000001
  ) {
    return { error: "Cena wizyty musi mieścić się w zakresie od 0 do 10 000 zł i mieć maksymalnie 2 miejsca po przecinku." };
  }
  return { amount: roundedAmount };
};

const formatAppointmentPrice = (amount) =>
  `${amount.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1").replace(".", ",")} zł`;

const applyServicePrice = (appointment, service) => {
  appointment.price = cleanText(service.price, 40);
  delete appointment.originalPriceAmount;
  delete appointment.priceAdjustedAt;
  delete appointment.priceAdjustedBy;
  const priceAmount = parsePriceAmount(appointment.price);
  if (Number.isFinite(priceAmount) && priceAmount >= 0) {
    appointment.priceAmount = Math.round(priceAmount * 100) / 100;
  }
};

const normalizeWaitlistEntry = (id, value = {}) => ({
  id: cleanText(value.id || id, 120),
  userId: cleanText(value.userId, 128),
  clientName: cleanText(value.clientName, 120),
  clientEmail: cleanText(value.clientEmail, 254).toLowerCase(),
  phone: cleanText(value.phone, 32),
  barberId: cleanText(value.barberId, 80),
  serviceId: cleanText(value.serviceId, 120),
  serviceName: cleanText(value.serviceName, 120),
  durationMinutes: Math.max(15, Number(value.durationMinutes) || 15),
  dateFrom: cleanText(value.dateFrom, 10),
  dateTo: cleanText(value.dateTo, 10),
  timePreference: waitlistTimePreferences.has(value.timePreference)
    ? value.timePreference
    : "any",
  status: value.status === "offered" ? "offered" : "waiting",
  offer: value.offer && typeof value.offer === "object" ? value.offer : null,
  version: Math.max(1, Number(value.version) || 1),
  createdAt: Number(value.createdAt) || 0,
  updatedAt: Number(value.updatedAt) || 0,
});

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const validateWaitlistEntry = (entry) => {
  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
  if (!isFirebaseKeySafe(entry.id) || !isFirebaseKeySafe(entry.barberId) || !isFirebaseKeySafe(entry.serviceId)) {
    return "Nieprawidłowy identyfikator listy, barbera lub usługi.";
  }
  if (entry.clientName.length < 3 || entry.phone.replace(/\D/g, "").length !== 9) {
    return "Podaj imię i nazwisko oraz prawidłowy numer telefonu.";
  }
  if (!datePattern.test(entry.dateFrom) || !datePattern.test(entry.dateTo)) {
    return "Nieprawidłowy zakres dat.";
  }
  if (entry.dateFrom < todayKey || entry.dateTo < entry.dateFrom) {
    return "Zakres listy rezerwowej nie może obejmować minionych dni.";
  }
  if (entry.dateTo > addDaysToDateKey(entry.dateFrom, 60)) {
    return "Zakres listy rezerwowej może obejmować maksymalnie 60 dni.";
  }
  return "";
};

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

const readClientBookingConfiguration = async (appointment, accessToken, { preservePrice = false } = {}) => {
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
  if (!preservePrice) applyServicePrice(appointment, service);
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
  applyServicePrice(appointment, service);
  appointment.durationMinutes = Number(service.durationMinutes);
};

const mutateDatabaseRoot = (accessToken, mutation, actorUid = "", readPlan = {}) =>
  mutateScopedDatabase(accessToken, mutation, { actorUid, ...readPlan });

const relinkClientAliases = (appointments, aliases, operationId, canonicalClient) => {
  for (const [appointmentId, raw] of Object.entries(appointments ?? {})) {
    const appointment = normalizeAppointment(appointmentId, raw);
    const canonicalId = aliases[appointment.clientId];
    if (canonicalId && canonicalId !== appointment.clientId) {
      appointments[appointmentId] = updateAppointmentVersion(
        {
          ...appointment,
          clientId: canonicalId,
          ...(canonicalClient?.userId ? { userId: canonicalClient.userId } : {}),
          ...(canonicalClient?.email && !appointment.clientEmail
            ? { clientEmail: canonicalClient.email }
            : {}),
          ...(canonicalClient?.photoUrl && !appointment.clientPhotoUrl
            ? { clientPhotoUrl: canonicalClient.photoUrl }
            : {}),
        },
        operationId,
      );
    }
  }
};

const applyCanonicalClientResult = (database, result) => {
  database.clients ??= {};
  for (const [id, canonicalId] of Object.entries(result.aliases ?? {})) {
    if (id !== canonicalId) delete database.clients[id];
  }
  database.clients[result.canonicalId] = result.client;
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
  applyCanonicalClientResult(database, result);
  database.appointments ??= {};
  relinkClientAliases(database.appointments, result.aliases, operationId, result.client);
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

const mutateAppointmentOperation = async (accessToken, operation, action, user, mutation, requestIdentity = "") => {
  const readPlan = await createAppointmentReadPlan(accessToken, operation, action, user);
  const result = await mutateDatabaseRoot(accessToken, async (database) => {
    database.appointmentOperations ??= {};
    const existingOperation = database.appointmentOperations[operation.operationId];
    if (existingOperation) {
      if (existingOperation.actorUid !== user.uid || existingOperation.action !== action ||
        (requestIdentity && existingOperation.requestIdentity !== requestIdentity)) {
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
        waitlistEntry: existingOperation.waitlistEntry,
        notificationPayload: existingOperation.notificationPayload,
        notificationOperationIds: existingOperation.notificationOperationIds ?? [],
        syncRevision: Number(existingOperation.syncRevision) || 0,
        idempotent: true,
      };
    }

    const result = await mutation(database);
    if (result.error) return result;

    database.appointmentOperations[operation.operationId] = {
      operationId: operation.operationId,
      action,
      actorUid: user.uid,
      appointmentId: result.appointment?.id ?? result.notificationPayload?.id ?? "",
      appointment: result.appointment,
      client: result.client,
      ...(result.clientMergeAudit ? { clientMergeAudit: result.clientMergeAudit, requestIdentity } : {}),
      waitlistEntry: result.waitlistEntry,
      notificationPayload: result.notificationPayload,
      notificationOperationIds: result.notificationOperationIds ?? [],
      syncRevision: 0,
      createdAt: Date.now(),
    };

    return {
      ...result,
      database,
      operationId: operation.operationId,
      syncRevision: 0,
      idempotent: false,
    };
  }, user.uid, readPlan);
  return { ...result, minimalResponse: operation.input?.responseMode === "minimal" };
};

const mergeRecords = (...collections) => Object.assign({}, ...collections.filter(Boolean));

const readScopedAppointmentData = async (
  user,
  admin,
  accessToken,
  requestedBarberId,
  databaseSnapshot,
) => {
  if (databaseSnapshot && !databaseSnapshot.partial) {
    const snapshot = { ...databaseSnapshot, occupancyBarberId: requestedBarberId };
    if (!snapshot.appointmentSync?.users?.[user.uid]?.revision) {
      const userSync = await readDatabase(
        `appointmentSync/users/${encodeURIComponent(user.uid)}`,
        accessToken,
      );
      snapshot.appointmentSync = {
        ...(snapshot.appointmentSync ?? {}),
        users: { ...(snapshot.appointmentSync?.users ?? {}), [user.uid]: userSync ?? {} },
      };
    }
    return snapshot;
  }

  const rawTeam = (await readDatabase("team/barbers", accessToken)) ?? {};
  const activeBarberIds = Object.entries(rawTeam)
    .filter(([, member]) => member?.active === true && member?.userId)
    .map(([id]) => id);
  const occupancyBarberId = activeBarberIds.includes(requestedBarberId)
    ? requestedBarberId
    : admin.barberId || activeBarberIds[0] || "";
  const reads = new Map();
  const read = (path, query) => {
    const key = JSON.stringify([path, query]);
    if (!reads.has(key)) reads.set(key, query ? readDatabaseQuery(path, query, accessToken) : readDatabase(path, accessToken));
    return reads.get(key);
  };
  const queryBy = (path, child, value) => {
    if (!value) return Promise.resolve({});
    if (admin.isOwner && (path === "appointments" || path === "waitlistEntries")) {
      return read(path).then(records => Object.fromEntries(Object.entries(records ?? {}).filter(([, record]) => record?.[child] === value)));
    }
    return read(path, { orderBy: child, equalTo: value });
  };
  // Read version markers BEFORE data: never label an older snapshot with a
  // notification that arrived while data was being fetched.
  const [userSync, barberSync, legacyRevision] = await Promise.all([
    read(`appointmentSync/users/${encodeURIComponent(user.uid)}`),
    occupancyBarberId ? read(`appointmentSync/barbers/${encodeURIComponent(occupancyBarberId)}`) : null,
    read("appointmentSync/revision"),
  ]);

  const [
    ownAppointments,
    adminAppointments,
    occupancyAppointments,
    ownWaitlist,
    adminWaitlist,
    occupancyWaitlist,
    adminClients,
  ] = await Promise.all([
    queryBy("appointments", "userId", user.uid),
    admin.isOwner
      ? read("appointments")
      : canReadAdminAppointments(admin)
        ? queryBy("appointments", "barberId", admin.barberId)
        : Promise.resolve({}),
    queryBy("appointments", "barberId", occupancyBarberId),
    queryBy("waitlistEntries", "userId", user.uid),
    admin.isOwner
      ? read("waitlistEntries")
      : canReadAdminAppointments(admin)
        ? queryBy("waitlistEntries", "barberId", admin.barberId)
        : Promise.resolve({}),
    queryBy("waitlistEntries", "barberId", occupancyBarberId),
    canAdminAccess(admin, "clients")
      ? admin.isOwner
        ? read("clients")
        : queryBy("clients", `barberIds/${admin.barberId}`, true)
      : Promise.resolve({}),
  ]);

  return {
    team: { barbers: rawTeam },
    appointments: mergeRecords(ownAppointments, adminAppointments, occupancyAppointments),
    waitlistEntries: mergeRecords(ownWaitlist, adminWaitlist, occupancyWaitlist),
    clients: adminClients ?? {},
    appointmentSync: {
      users: { [user.uid]: userSync ?? {} },
      barbers: occupancyBarberId ? { [occupancyBarberId]: barberSync ?? {} } : {},
      revision: Number(legacyRevision) || 0,
    },
    occupancyBarberId,
  };
};

const getAppointmentData = async (
  user,
  admin,
  accessToken,
  databaseSnapshot = null,
  requestedBarberId = "",
) => {
  const database = await readScopedAppointmentData(
    user,
    admin,
    accessToken,
    requestedBarberId,
    databaseSnapshot,
  );
  const sync = {
    uid: user.uid,
    barberId: database.occupancyBarberId || "",
    userRevision: Number(database.appointmentSync?.users?.[user.uid]?.revision) || 0,
    barberRevision: Number(database.appointmentSync?.barbers?.[database.occupancyBarberId]?.revision) || 0,
  };
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
  const rawWaitlistEntries = database.waitlistEntries ?? {};
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
      (!database.occupancyBarberId || appointment.barberId === database.occupancyBarberId) &&
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

  const waitlistEntries = Object.entries(rawWaitlistEntries)
    .map(([id, entry]) => normalizeWaitlistEntry(id, entry))
    .filter((entry) => ["waiting", "offered"].includes(entry.status))
    .sort(
      (first, second) =>
        first.dateFrom.localeCompare(second.dateFrom) ||
        (Number(first.createdAt) || 0) - (Number(second.createdAt) || 0),
    );
  const clientWaitlist = waitlistEntries.filter((entry) => entry.userId === user.uid);
  const now = Date.now();
  for (const entry of waitlistEntries) {
    if (
      entry.status !== "offered" ||
      entry.userId === user.uid ||
      Number(entry.offer?.expiresAt) <= now ||
      (database.occupancyBarberId && entry.offer?.barberId !== database.occupancyBarberId)
    ) {
      continue;
    }
    occupancy.push({
      id: `waitlist-hold-${entry.id}`,
      barberId: entry.offer.barberId,
      dateKey: entry.offer.dateKey,
      startTime: entry.offer.startTime,
      durationMinutes: Number(entry.offer.durationMinutes) || entry.durationMinutes,
    });
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
      sync,
      teamMembers,
      adminAppointments,
      clientAppointments,
      adminClients,
      clientWaitlist,
      adminWaitlist: waitlistEntries.filter(
        (entry) => admin.isOwner || entry.barberId === admin.barberId,
      ),
      syncRevision: Math.max(
        Number(database.appointmentSync?.users?.[user.uid]?.revision) || 0,
        Number(database.appointmentSync?.barbers?.[database.occupancyBarberId]?.revision) || 0,
        Number(database.appointmentSync?.revision) || 0,
      ),
      occupancy,
    };
  }

  return {
    context: admin,
    sync,
    teamMembers,
    occupancy,
    clientAppointments,
    clientWaitlist,
    syncRevision: Math.max(
      Number(database.appointmentSync?.users?.[user.uid]?.revision) || 0,
      Number(database.appointmentSync?.barbers?.[database.occupancyBarberId]?.revision) || 0,
      Number(database.appointmentSync?.revision) || 0,
    ),
  };
};

const synchronizedOperationResponse = async (
  result,
  user,
  admin,
  accessToken,
  ok = true,
  notificationEvent = "",
) => {
  const notificationOperationIds = [
    ...(notificationEvent && result.operationId ? [result.operationId] : []),
    ...(Array.isArray(result.notificationOperationIds) ? result.notificationOperationIds : []),
  ].filter((operationId, index, values) => operationId && values.indexOf(operationId) === index);
  const snapshotBarberId =
    result.appointment?.barberId ||
    result.waitlistEntry?.barberId ||
    result.notificationPayload?.barberId ||
    admin.barberId ||
    "";
  // A committed write must not depend on a second, potentially slow/failing read.
  // Older installed PWAs retain their complete snapshot response until updated.
  const snapshot = ok && result.minimalResponse ? { refreshRequired: true } : await getAppointmentData(
    user,
    admin,
    accessToken,
    result.database,
    snapshotBarberId,
  );
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
      waitlistEntry: result.waitlistEntry,
      notificationQueued: ok && notificationOperationIds.length > 0,
      notificationOperationIds,
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

const upsertAdminClient = async (body, admin, user, accessToken, operation) => {
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
    const existingClient = database.clients?.[clientId];
    if (existingClient && !admin.isOwner && existingClient.barberIds?.[barberId] !== true) {
      return { error: "Brak dostępu do tej karty klienta.", status: 403 };
    }
    if (clientValue.userId && clientValue.userId !== existingClient?.userId) {
      return { error: "Przypisanie konta wymaga zatwierdzonego scalenia.", status: 403 };
    }
    if (existingClient?.userId) {
      clientValue.userId = existingClient.userId;
      clientValue.email = existingClient.email;
    } else {
      delete clientValue.userId;
    }
    for (const appointmentId of appointmentIds) {
      const current = database.appointments[appointmentId]
        ? normalizeAppointment(appointmentId, database.appointments[appointmentId])
        : null;
      if (!current || current.barberId !== barberId) {
        return { error: "Brak dostępu do jednej z wizyt klienta.", status: 403 };
      }
      if ((current.clientId !== clientId && database.clients?.[current.clientId]) ||
        (current.userId && current.userId !== existingClient?.userId)) {
        return { error: "Przeniesienie historii wymaga zatwierdzonego scalenia.", status: 403 };
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
      proposed.userId = clientResult.client.userId || "";
      proposed.clientEmail = clientResult.client.email || "";
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
      if (hasBlockingWaitlistOffer(database, candidate, candidate.userId || "")) {
        return { error: "Ten termin jest chwilowo zarezerwowany dla osoby z listy oczekujących." };
      }
      database.appointments[candidate.id] = candidate;
      if (candidate.userId) consumeMatchingWaitlistEntry(database, candidate, candidate.userId);
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

const joinWaitlist = async (body, admin, user, accessToken, operation) => {
  const requested = normalizeWaitlistEntry(body.waitlistEntry?.id, {
    ...body.waitlistEntry,
    userId: user.uid,
    clientEmail: user.email,
    status: "waiting",
    offer: null,
  });
  const validationError = validateWaitlistEntry(requested);
  if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);

  const member = await readTeamMember(requested.barberId, accessToken);
  if (!member?.userId || member.active !== true) {
    return jsonResponse({ ok: false, error: "Wybrany barber jest nieaktywny." }, 409);
  }
  const service = await readDatabase(
    `barbers/${requested.barberId}/services/${encodeURIComponent(requested.serviceId)}`,
    accessToken,
  );
  if (
    !service ||
    cleanText(service.id, 120) !== requested.serviceId ||
    cleanText(service.barberId, 80) !== requested.barberId
  ) {
    return jsonResponse({ ok: false, error: "Wybrana usługa nie jest już dostępna." }, 409);
  }
  requested.serviceName = cleanText(service.name, 120);
  requested.durationMinutes = Number(service.durationMinutes);

  const result = await mutateAppointmentOperation(
    accessToken,
    operation,
    "join_waitlist",
    user,
    (database) => {
      database.waitlistEntries ??= {};
      if (database.waitlistEntries[requested.id]) {
        return { error: "Ten zapis na listę rezerwową już istnieje.", status: 409 };
      }
      const duplicate = Object.values(database.waitlistEntries).some(
        (entry) =>
          entry?.userId === user.uid &&
          entry.barberId === requested.barberId &&
          entry.serviceId === requested.serviceId &&
          ["waiting", "offered"].includes(entry.status),
      );
      if (duplicate) {
        return { error: "Masz już aktywny zapis na tę usługę u wybranego barbera.", status: 409 };
      }
      const now = Date.now();
      const waitlistEntry = {
        ...requested,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      database.waitlistEntries[waitlistEntry.id] = waitlistEntry;
      const notificationPayload = {
        id: waitlistEntry.id,
        waitlistId: waitlistEntry.id,
        barberId: waitlistEntry.barberId,
        serviceId: waitlistEntry.serviceId,
        userId: waitlistEntry.userId,
        clientName: waitlistEntry.clientName,
        clientEmail: waitlistEntry.clientEmail,
        phone: waitlistEntry.phone,
        serviceName: waitlistEntry.serviceName,
        dateFrom: waitlistEntry.dateFrom,
        dateTo: waitlistEntry.dateTo,
        timePreference: waitlistEntry.timePreference,
        lastOperationId: operation.operationId,
      };
      enqueueAppointmentNotification(
        database,
        notificationEventByAction.join_waitlist,
        notificationPayload,
        operation.operationId,
      );
      return { database, waitlistEntry, notificationPayload };
    },
  );
  return synchronizedOperationResponse(
    result,
    user,
    admin,
    accessToken,
    !result.error,
    notificationEventByAction.join_waitlist,
  );
};

const removeWaitlistEntry = async (body, admin, user, accessToken, operation, asAdmin) => {
  const waitlistId = cleanText(body.waitlistId, 120);
  if (!isFirebaseKeySafe(waitlistId)) {
    return jsonResponse({ ok: false, error: "Nieprawidłowy zapis na listę rezerwową." }, 400);
  }

  const result = await mutateAppointmentOperation(
    accessToken,
    operation,
    asAdmin ? "remove_waitlist_admin" : "leave_waitlist",
    user,
    (database) => {
      const rawEntry = database.waitlistEntries?.[waitlistId];
      if (!rawEntry) return { error: "Zapis na listę już nie istnieje.", status: 404 };
      const entry = normalizeWaitlistEntry(waitlistId, rawEntry);
      if (asAdmin) {
        if (
          !admin.isAdmin ||
          (!canAdminAccess(admin, "schedule") && !canAdminAccess(admin, "clients")) ||
          (!admin.isOwner && admin.barberId !== entry.barberId)
        ) {
          return { error: "Brak dostępu do tej listy rezerwowej.", status: 403 };
        }
      } else if (entry.userId !== user.uid) {
        return { error: "Brak dostępu do tego zapisu.", status: 403 };
      }
      if (Number(entry.version) !== operation.expectedVersion) {
        return {
          error: "Lista rezerwowa została w międzyczasie zmieniona. Odśwież widok.",
          code: "stale_version",
          status: 409,
        };
      }
      delete database.waitlistEntries[waitlistId];
      return { database, waitlistEntry: { ...entry, deleted: true } };
    },
  );
  return synchronizedOperationResponse(result, user, admin, accessToken, !result.error);
};

const handler = async (request, timings = {}) => {
  try {
    let phaseStarted = performance.now();
    const user = await verifyRequestUser(request);
    timings.auth = performance.now() - phaseStarted;
    if (!user) return jsonResponse({ ok: false, error: "Brak ważnej sesji." }, 401);
    phaseStarted = performance.now();
    const accessToken = await getAccessToken();
    timings.credentials = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    const admin = await getAdminContext(user, accessToken);
    timings.permissions = performance.now() - phaseStarted;

    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if (params.has("mergeSourceId") || params.has("mergeTargetId")) {
        if (!canAdminAccess(admin, "clients") || !canAdminAccess(admin, "schedule")) {
          return jsonResponse({ ok: false, error: "Brak uprawnień do scalania klientów." }, 403);
        }
        const sourceId = cleanText(params.get("mergeSourceId"), 120);
        const targetId = cleanText(params.get("mergeTargetId"), 120);
        if (![sourceId, targetId].every(isFirebaseKeySafe)) {
          return jsonResponse({ ok: false, error: "Wybierz dwie karty klientów." }, 400);
        }
        const [source, target, appointments, waitlistEntries, team] = await Promise.all([
          readDatabase(`clients/${encodeURIComponent(sourceId)}`, accessToken),
          readDatabase(`clients/${encodeURIComponent(targetId)}`, accessToken),
          readDatabaseQuery("appointments", { orderBy: "clientId", equalTo: sourceId }, accessToken),
          readDatabase("waitlistEntries", accessToken),
          readDatabase("team", accessToken),
        ]);
        const result = inspectClientMerge({
          clients: { [sourceId]: source, [targetId]: target }, appointments, waitlistEntries, team,
        }, user.uid, sourceId, targetId);
        return result.error
          ? jsonResponse({ ok: false, error: result.error }, result.status)
          : jsonResponse({ ok: true, mergePreview: result.preview });
      }
      const requestedBarberId = cleanText(params.get("barberId"), 80);
      return jsonResponse({
        ok: true,
        ...(await getAppointmentData(
          user,
          admin,
          accessToken,
          null,
          requestedBarberId,
        )),
      });
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);

    const body = await request.json();
    const action = cleanText(body.action, 40);
    if (!allowedActions.has(action)) return jsonResponse({ ok: false, error: "Nieznana operacja." }, 400);
    const operation = readOperation(body);
    operation.input = body;
    if (operation.error) {
      return jsonResponse({ ok: false, error: operation.error }, operation.status);
    }
    if (scheduleAdminActions.has(action) && !canAdminAccess(admin, "schedule")) {
      return jsonResponse({ ok: false, error: "Brak uprawnień do terminarza." }, 403);
    }

    if (action === "merge_admin_clients") {
      if (!canAdminAccess(admin, "clients") || !canAdminAccess(admin, "schedule")) {
        return jsonResponse({ ok: false, error: "Brak uprawnień do scalania klientów." }, 403);
      }
      const result = await mutateAppointmentOperation(accessToken, operation, action, user,
        database => mergeConfirmedClients(database, user.uid, body, operation.operationId),
        JSON.stringify([body.sourceClientId, body.targetClientId]));
      return synchronizedOperationResponse(result, user, admin, accessToken, !result.error);
    }

    if (action === "upsert_admin_client") {
      return upsertAdminClient(body, admin, user, accessToken, operation);
    }
    if (action === "hide_admin_client") {
      return hideAdminClient(body, admin, user, accessToken, operation);
    }
    if (action === "delete_admin_client") {
      return deleteAdminClient(body, admin, user, accessToken, operation);
    }
    if (action === "join_waitlist") {
      return joinWaitlist(body, admin, user, accessToken, operation);
    }
    if (action === "leave_waitlist") {
      return removeWaitlistEntry(body, admin, user, accessToken, operation, false);
    }
    if (action === "remove_waitlist_admin") {
      return removeWaitlistEntry(body, admin, user, accessToken, operation, true);
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
        if (hasBlockingWaitlistOffer(database, candidate, user.uid)) {
          return { error: "Ten termin jest chwilowo zarezerwowany dla osoby z listy oczekujących." };
        }
        database.appointments[candidate.id] = candidate;
        consumeMatchingWaitlistEntry(database, candidate, user.uid);
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
      proposed.userId = client.userId || "";
      proposed.clientEmail = client.email || "";
    }

    const result = await mutateAppointmentOperation(
      accessToken,
      operation,
      action,
      user,
      async (database) => {
      const appointments = database.appointments ?? {};
      if (action === "create_client" || action === "create_admin") {
        if (action === "create_admin") {
          const client = database.clients?.[proposed.clientId];
          if (!client || client.barberIds?.[proposed.barberId] !== true) {
            return { error: "Karta klienta zmieniła się. Odśwież kartotekę i spróbuj ponownie.", status: 409 };
          }
          proposed.userId = client.userId || "";
          proposed.clientEmail = client.email || "";
        }
        if (appointments[proposed.id]) return { error: "Ta wizyta już istnieje." };
        if (operation.expectedVersion !== 0) return staleVersionError(operation, null);
        const candidate = createAppointmentVersion(proposed, operation.operationId);
        if (hasConflict(appointments, candidate)) return { error: "Ten termin został właśnie zajęty." };
        if (hasBlockingWaitlistOffer(database, candidate, candidate.userId || "")) {
          return { error: "Ten termin jest chwilowo zarezerwowany dla osoby z listy oczekujących." };
        }
        appointments[candidate.id] = candidate;
        database.appointments = appointments;
        if (candidate.userId) consumeMatchingWaitlistEntry(database, candidate, candidate.userId);
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
      const isCompletedPriceCorrection = action === "update_admin" && current.status === "completed";
      if (["cancelled", "completed", "no_show"].includes(current.status) && !isCompletedPriceCorrection) {
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
      let notificationPayload;
      if (action === "reschedule_client" || action === "reschedule_admin") {
        next.dateKey = cleanText(body.dateKey, 10);
        next.startTime = cleanText(body.startTime, 5);
        next.status = "rescheduled";
        next.rescheduledAt = Date.now();
        next.rescheduledBy = action === "reschedule_client" ? "client" : "admin";
        const validationError = validateAppointmentTime(next);
        if (validationError) return { error: validationError };
        if (action === "reschedule_client") {
          await readClientBookingConfiguration(next, accessToken, { preservePrice: true });
        }
        if (hasConflict(appointments, next, appointmentId)) {
          return { error: "Ten termin został właśnie zajęty." };
        }
      } else if (action === "update_admin") {
        const nextDateKey = cleanText(body.dateKey, 10);
        const nextStartTime = cleanText(body.startTime, 5);
        const requestedPrice = readRequestedPriceAmount(body.priceAmount);
        if (requestedPrice.error) return { error: requestedPrice.error, status: 400 };

        const currentPriceAmount =
          current.status === "completed" && Number.isFinite(Number(current.settlement?.amount))
            ? Number(current.settlement.amount)
            : getAppointmentPriceAmount(current);
        if (!Number.isFinite(currentPriceAmount)) {
          return { error: "Nie udało się odczytać obecnej ceny wizyty.", status: 409 };
        }
        const scheduleChanged =
          nextDateKey !== current.dateKey || nextStartTime !== current.startTime;
        const priceChanged =
          Math.round(currentPriceAmount * 100) !== Math.round(requestedPrice.amount * 100);
        if (!scheduleChanged && !priceChanged) {
          return { error: "Nie wprowadzono żadnych zmian.", status: 409 };
        }

        if (scheduleChanged) {
          if (current.status === "completed") {
            return { error: "W rozliczonej wizycie można skorygować tylko cenę.", status: 409 };
          }
          next.dateKey = nextDateKey;
          next.startTime = nextStartTime;
          next.status = "rescheduled";
          next.rescheduledAt = Date.now();
          next.rescheduledBy = "admin";
          const validationError = validateAppointmentTime(next);
          if (validationError) return { error: validationError, status: 400 };
          if (hasConflict(appointments, next, appointmentId)) {
            return { error: "Ten termin został właśnie zajęty." };
          }
        }

        if (priceChanged) {
          next.originalPriceAmount = Number.isFinite(Number(current.originalPriceAmount))
            ? Number(current.originalPriceAmount)
            : Math.round(currentPriceAmount * 100) / 100;
          next.priceAmount = requestedPrice.amount;
          next.price = formatAppointmentPrice(requestedPrice.amount);
          next.priceAdjustedAt = Date.now();
          next.priceAdjustedBy = "admin";
          if (current.status === "completed" && next.settlement) {
            next.settlement = { ...next.settlement, amount: requestedPrice.amount };
          }
        }

        notificationPayload = {
          ...next,
          appointmentWasCompleted: current.status === "completed",
          scheduleChanged,
          priceChanged,
          previousPrice: current.price,
          previousPriceAmount: Math.round(currentPriceAmount * 100) / 100,
        };
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
        const amount = getAppointmentPriceAmount(next);
        if (!Number.isFinite(amount) || amount < 0 || amount > maximumAppointmentPrice) {
          return { error: "Wizyta nie ma prawidłowej ceny do rozliczenia.", status: 409 };
        }
        const settledAt = Date.now();
        next.status = "completed";
        next.settlement = {
          barberId: next.barberId,
          settledAt,
          amount: Math.round(amount * 100) / 100,
        };
      } else if (action === "mark_no_show_admin") {
        if (!isNoShowAvailable(next)) {
          return { error: "Nieobecność można oznaczyć dopiero po zakończeniu wizyty.", status: 409 };
        }
        next.status = "no_show";
        next.noShowAt = Date.now();
        next.noShowBy = "admin";
      }

      next = updateAppointmentVersion(next, operation.operationId);
      if (notificationPayload) {
        notificationPayload = {
          ...notificationPayload,
          version: next.version,
          lastOperationId: next.lastOperationId,
          updatedAt: next.updatedAt,
        };
      }
      const removesClientHistory = ["cancel_client", "cancel_admin", "mark_no_show_admin"].includes(action);
      const notificationOperationIds = [];
      if (action === "cancel_client" || action === "cancel_admin") {
        const waitlistOffer = offerWaitlistSlot(database, current, {
          sourceOperationId: operation.operationId,
          actorUid: user.uid,
          excludeUserId: current.userId,
        });
        if (waitlistOffer.operationId) notificationOperationIds.push(waitlistOffer.operationId);
      }
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
        notificationPayload ?? next,
        operation.operationId,
      );
      return { database, appointment: next, notificationPayload, notificationOperationIds };
      },
    );

    return synchronizedOperationResponse(
      result,
      user,
      admin,
      accessToken,
      !result.error,
      notificationEventByAction[action] ?? "",
    );
  } catch (error) {
    if (error instanceof DatabaseLeaseError) {
      return jsonResponse({ ok: false, error: error.message, code: error.code }, 409);
    }
    const message = error instanceof Error ? error.message : "Nieznany błąd serwera.";
    const status = /nieaktywny|dostępn|godzina|minionego/i.test(message) ? 409 : 500;
    return jsonResponse({ ok: false, error: message }, status);
  }
};

export default async function timedHandler(request) {
  const started = performance.now();
  const timings = {};
  const response = await handler(request, timings);
  timings.total = performance.now() - started;
  response.headers.set("Server-Timing", Object.entries(timings)
    .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`).join(", "));
  return response;
}
