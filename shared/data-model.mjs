const appointmentStatuses = new Set(["confirmed", "rescheduled", "cancelled", "completed"]);
const appointmentColors = new Set(["blue", "mint", "pink", "violet", "amber", "coral", "sky", "lime"]);
const firebaseKeyPattern = /[.#$\[\]/]/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const canonicalAccessSections = [
  "schedule",
  "clients",
  "analytics",
  "work",
  "services",
  "profile",
];

export const cleanText = (value, maxLength = 160) =>
  String(value ?? "").trim().slice(0, maxLength);

export const normalizeEmail = (value) => cleanText(value, 254).toLowerCase();

export const normalizePhone = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.startsWith("48") && digits.length >= 11 ? digits.slice(2, 11) : digits.slice(0, 9);
};

export const isFirebaseKeySafe = (value) => Boolean(value) && !firebaseKeyPattern.test(value);

export const normalizeAccess = (value = {}) =>
  Object.fromEntries(canonicalAccessSections.map((section) => [section, value?.[section] === true]));

export const normalizeServiceRecord = (id, value = {}, barberId, order = 0) => ({
  id: cleanText(id, 120),
  barberId: cleanText(barberId, 80),
  name: cleanText(value.name, 120),
  price: cleanText(value.price, 40),
  durationMinutes: Number(value.durationMinutes),
  order: Number.isFinite(Number(value.order)) ? Number(value.order) : order,
});

export const normalizeAvailabilityRecord = (id, value = {}, barberId) => ({
  id: cleanText(id, 10),
  barberId: cleanText(barberId, 80),
  dateKey: cleanText(id, 10),
  startTime: cleanText(value.startTime, 5),
  endTime: cleanText(value.endTime, 5),
});

export const normalizeSettlementRecord = (value, barberId) => {
  if (!value) return undefined;
  const settledAt = Number(value.settledAt);
  const amount = Number(value.amount);
  if (!Number.isFinite(settledAt) || !Number.isFinite(amount)) return undefined;
  return { barberId: cleanText(barberId, 80), settledAt, amount };
};

export const normalizeAppointmentRecord = (id, value = {}) => {
  const barberId = cleanText(value.barberId, 80);
  const canonicalValue = { ...value };
  const settlement = normalizeSettlementRecord(value.settlement, barberId);
  delete canonicalValue.settledAt;
  delete canonicalValue.settledAmount;
  return {
    ...canonicalValue,
    id: cleanText(id, 120),
    barberId,
    clientId: cleanText(value.clientId, 120),
    serviceId: cleanText(value.serviceId, 120),
    userId: cleanText(value.userId, 128),
    dateKey: cleanText(value.dateKey, 10),
    startTime: cleanText(value.startTime, 5),
    durationMinutes: Number(value.durationMinutes),
    clientName: cleanText(value.clientName, 120),
    clientEmail: normalizeEmail(value.clientEmail),
    clientPhotoUrl: cleanText(value.clientPhotoUrl, 500000),
    phone: normalizePhone(value.phone),
    serviceName: cleanText(value.serviceName, 120),
    price: cleanText(value.price, 40),
    color: appointmentColors.has(value.color) ? value.color : "blue",
    status: appointmentStatuses.has(value.status) ? value.status : "confirmed",
    version: Number.isInteger(Number(value.version)) && Number(value.version) > 0
      ? Number(value.version)
      : 1,
    lastOperationId: cleanText(value.lastOperationId, 120),
    createdAt: Number(value.createdAt) || undefined,
    updatedAt: Number(value.updatedAt) || undefined,
    ...(settlement ? { settlement } : {}),
  };
};

export const normalizeClientRecord = (id, value = {}) => ({
  ...value,
  id: cleanText(id, 120),
  firstName: cleanText(value.firstName, 80),
  lastName: cleanText(value.lastName, 80),
  email: normalizeEmail(value.email),
  phone: normalizePhone(value.phone),
  photoUrl: cleanText(value.photoUrl, 500000),
  ...(value.userId ? { userId: cleanText(value.userId, 128) } : {}),
  barberIds: Object.fromEntries(
    Object.entries(value.barberIds ?? {}).filter(([, enabled]) => enabled === true),
  ),
  hiddenFor: Object.fromEntries(
    Object.entries(value.hiddenFor ?? {}).filter(([, hidden]) => typeof hidden === "boolean"),
  ),
  createdAt: Number(value.createdAt) || undefined,
  updatedAt: Number(value.updatedAt) || undefined,
});

const getClientIdentityKeys = (client) =>
  [
    client.userId ? `uid:${client.userId}` : "",
    client.email ? `email:${normalizeEmail(client.email)}` : "",
    normalizePhone(client.phone).length === 9 ? `phone:${normalizePhone(client.phone)}` : "",
  ].filter(Boolean);

const chooseCanonicalClientId = (records) => {
  const userOwned = records.find(({ id, client }) => client.userId && client.userId === id);
  if (userOwned) return userOwned.id;
  return [...records]
    .sort((first, second) => {
      if (Boolean(first.client.userId) !== Boolean(second.client.userId)) {
        return first.client.userId ? -1 : 1;
      }
      const firstCreated = Number(first.client.createdAt) || Number.MAX_SAFE_INTEGER;
      const secondCreated = Number(second.client.createdAt) || Number.MAX_SAFE_INTEGER;
      if (firstCreated !== secondCreated) return firstCreated - secondCreated;
      return first.id.localeCompare(second.id);
    })[0].id;
};

const mergeClientRecords = (canonicalId, records) => {
  const canonical = records.find(({ id }) => id === canonicalId)?.client ?? {};
  const firstValue = (field) =>
    canonical[field] || records.map(({ client }) => client[field]).find(Boolean) || "";
  const userIds = [...new Set(records.map(({ client }) => client.userId).filter(Boolean))];
  const barberIds = {};
  const hiddenFor = {};
  for (const { client } of records) {
    for (const [barberId, enabled] of Object.entries(client.barberIds ?? {})) {
      if (enabled === true) barberIds[barberId] = true;
    }
    for (const [barberId, hidden] of Object.entries(client.hiddenFor ?? {})) {
      if (!(barberId in hiddenFor) || hidden === false) hiddenFor[barberId] = hidden;
    }
  }

  const createdAtValues = records
    .map(({ client }) => Number(client.createdAt))
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    id: canonicalId,
    firstName: firstValue("firstName"),
    lastName: firstValue("lastName"),
    email: normalizeEmail(firstValue("email")),
    phone: normalizePhone(firstValue("phone")),
    photoUrl: firstValue("photoUrl"),
    ...(userIds.length === 1 ? { userId: userIds[0] } : {}),
    barberIds,
    hiddenFor,
    createdAt: createdAtValues.length > 0 ? Math.min(...createdAtValues) : undefined,
    updatedAt: Math.max(...records.map(({ client }) => Number(client.updatedAt) || 0)) || undefined,
  };
};

export const upsertCanonicalClient = (clients = {}, requestedId, value = {}) => {
  const clientId = cleanText(requestedId, 120);
  if (!isFirebaseKeySafe(clientId)) {
    return { error: "Nieprawidłowy identyfikator klienta." };
  }

  const normalizedClients = Object.fromEntries(
    Object.entries(clients).map(([id, client]) => [id, normalizeClientRecord(id, client)]),
  );
  normalizedClients[clientId] = normalizeClientRecord(clientId, {
    ...(normalizedClients[clientId] ?? {}),
    ...value,
  });
  const group = findDuplicateClientGroups(normalizedClients).find((ids) => ids.includes(clientId)) ?? [clientId];
  const records = group.map((id) => ({ id, client: normalizedClients[id] }));
  const mergeError = validateClientGroupCanMerge(records);
  if (mergeError) return { error: `Nie można bezpiecznie połączyć klientów: ${mergeError}.` };

  const canonicalId = chooseCanonicalClientId(records);
  const client = mergeClientRecords(canonicalId, records);
  const aliases = {};
  for (const id of group) {
    aliases[id] = canonicalId;
    if (id !== canonicalId) delete normalizedClients[id];
  }
  normalizedClients[canonicalId] = client;

  return { clients: normalizedClients, client, canonicalId, aliases };
};

const findDuplicateClientGroups = (clients) => {
  const ids = Object.keys(clients);
  const parent = Object.fromEntries(ids.map((id) => [id, id]));
  const find = (id) => {
    if (parent[id] !== id) parent[id] = find(parent[id]);
    return parent[id];
  };
  const union = (first, second) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot;
  };
  const identityOwner = new Map();

  for (const [id, client] of Object.entries(clients)) {
    for (const identity of getClientIdentityKeys(client)) {
      const existing = identityOwner.get(identity);
      if (existing) union(existing, id);
      else identityOwner.set(identity, id);
    }
  }

  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
};

const validateClientGroupCanMerge = (records) => {
  const userIds = [...new Set(records.map(({ client }) => client.userId).filter(Boolean))];
  if (userIds.length > 1) return "powiązane rekordy mają różne userId";

  const phones = [...new Set(records.map(({ client }) => normalizePhone(client.phone)).filter(Boolean))];
  const emails = [...new Set(records.map(({ client }) => normalizeEmail(client.email)).filter(Boolean))];
  if (phones.length > 1 && emails.length === 1) {
    return "rekordy łączy wyłącznie e-mail, ale mają różne numery telefonu";
  }
  return "";
};

const createClientFromAppointment = (clientId, appointment) => {
  const nameParts = cleanText(appointment.clientName, 120).split(/\s+/).filter(Boolean);
  return normalizeClientRecord(clientId, {
    firstName: nameParts[0] ?? "",
    lastName: nameParts.slice(1).join(" "),
    email: appointment.clientEmail,
    phone: appointment.phone,
    photoUrl: appointment.clientPhotoUrl,
    userId: appointment.userId,
    barberIds: { [appointment.barberId]: true },
    hiddenFor: { [appointment.barberId]: false },
  });
};

const clone = (value) => structuredClone(value ?? {});

export const validateCanonicalDatabase = (database) => {
  const errors = [];
  const warnings = [];
  const team = database.team ?? {};
  const teamBarbers = team.barbers ?? {};
  const barberIds = new Set(Object.keys(teamBarbers));
  const clients = database.clients ?? {};

  if (!team.owner?.userId || team.owner.active !== true) {
    errors.push({ path: "team/owner", code: "invalid_owner", message: "Brak aktywnego właściciela." });
  }
  const assignedUserIds = new Map();
  for (const [barberId, member] of Object.entries(teamBarbers)) {
    if (!isFirebaseKeySafe(barberId) || !member?.userId || typeof member.active !== "boolean") {
      errors.push({ path: `team/barbers/${barberId}`, code: "invalid_barber", message: "Niepełny rekord barbera." });
    }
    if (member?.userId) {
      const previousBarberId = assignedUserIds.get(member.userId);
      if (previousBarberId) {
        errors.push({ path: `team/barbers/${barberId}/userId`, code: "duplicate_barber_user", message: `Konto jest już przypisane do barbera ${previousBarberId}.` });
      } else {
        assignedUserIds.set(member.userId, barberId);
      }
    }
    for (const section of canonicalAccessSections) {
      if (typeof member?.access?.[section] !== "boolean") {
        errors.push({ path: `team/barbers/${barberId}/access/${section}`, code: "missing_access", message: "Brak jawnego zakresu dostępu." });
      }
    }
  }

  if (database.services !== undefined || database.workSettings !== undefined) {
    errors.push({ path: "/", code: "legacy_paths", message: "Pozostały stare główne ścieżki usług lub dostępności." });
  }

  for (const barberId of barberIds) {
    const barber = database.barbers?.[barberId] ?? {};
    for (const [serviceId, service] of Object.entries(barber.services ?? {})) {
      if (!isFirebaseKeySafe(serviceId) || service.id !== serviceId || service.barberId !== barberId) {
        errors.push({ path: `barbers/${barberId}/services/${serviceId}`, code: "invalid_service_relation", message: "Usługa ma niespójne id lub barberId." });
      }
      if (!service.name || !Number.isFinite(Number(service.durationMinutes)) || Number(service.durationMinutes) < 15) {
        errors.push({ path: `barbers/${barberId}/services/${serviceId}`, code: "invalid_service", message: "Usługa ma niepełne dane." });
      }
    }
    for (const [dateKey, availability] of Object.entries(barber.workSettings?.availability ?? {})) {
      if (availability.id !== dateKey || availability.dateKey !== dateKey || availability.barberId !== barberId) {
        errors.push({ path: `barbers/${barberId}/workSettings/availability/${dateKey}`, code: "invalid_availability_relation", message: "Dostępność ma niespójne id, dateKey lub barberId." });
      }
      if (!datePattern.test(dateKey) || !timePattern.test(availability.startTime) || !timePattern.test(availability.endTime)) {
        errors.push({ path: `barbers/${barberId}/workSettings/availability/${dateKey}`, code: "invalid_availability", message: "Dostępność ma nieprawidłową datę lub godzinę." });
      } else if (availability.startTime >= availability.endTime) {
        errors.push({ path: `barbers/${barberId}/workSettings/availability/${dateKey}`, code: "invalid_availability_range", message: "Koniec dostępności nie może być wcześniejszy niż początek." });
      }
    }
  }

  for (const [clientId, client] of Object.entries(clients)) {
    if (client.id !== clientId || !isFirebaseKeySafe(clientId)) {
      errors.push({ path: `clients/${clientId}`, code: "invalid_client_id", message: "Klient ma niespójny identyfikator." });
    }
    for (const barberId of Object.keys(client.barberIds ?? {})) {
      if (!barberIds.has(barberId)) {
        errors.push({ path: `clients/${clientId}/barberIds/${barberId}`, code: "invalid_client_barber", message: "Klient wskazuje nieistniejącego barbera." });
      }
    }
  }

  for (const group of findDuplicateClientGroups(clients)) {
    errors.push({ path: `clients/${group.join(",")}`, code: "duplicate_clients", message: "Pozostały zduplikowane rekordy klienta." });
  }

  for (const [appointmentId, appointment] of Object.entries(database.appointments ?? {})) {
    const path = `appointments/${appointmentId}`;
    if (appointment.id !== appointmentId || !isFirebaseKeySafe(appointmentId)) {
      errors.push({ path, code: "invalid_appointment_id", message: "Wizyta ma niespójny identyfikator." });
    }
    if (!barberIds.has(appointment.barberId)) {
      errors.push({ path, code: "invalid_appointment_barber", message: "Wizyta wskazuje nieistniejącego barbera." });
      continue;
    }
    if (!clients[appointment.clientId]) {
      errors.push({ path, code: "missing_client_relation", message: "Wizyta nie ma istniejącej relacji z klientem." });
    } else if (clients[appointment.clientId].barberIds?.[appointment.barberId] !== true) {
      errors.push({ path, code: "missing_client_barber_relation", message: "Klient nie jest przypisany do barbera wizyty." });
    }
    if (!database.barbers?.[appointment.barberId]?.services?.[appointment.serviceId]) {
      errors.push({ path, code: "missing_service_relation", message: "Wizyta nie wskazuje istniejącej usługi barbera." });
    }
    if (!datePattern.test(appointment.dateKey) || !timePattern.test(appointment.startTime)) {
      errors.push({ path, code: "invalid_appointment_time", message: "Wizyta ma nieprawidłową datę lub godzinę." });
    }
    if (!Number.isInteger(Number(appointment.durationMinutes)) || Number(appointment.durationMinutes) < 15) {
      errors.push({ path, code: "invalid_appointment_duration", message: "Wizyta ma nieprawidłowy czas trwania." });
    }
    if (!Number.isInteger(Number(appointment.version)) || Number(appointment.version) < 1) {
      errors.push({ path, code: "invalid_appointment_version", message: "Wizyta nie ma prawidłowej wersji." });
    }
    if (appointment.status === "completed" && !appointment.settlement) {
      errors.push({ path, code: "missing_settlement", message: "Rozliczona wizyta nie ma rozliczenia." });
    }
    if (appointment.settlement) {
      if (
        appointment.settlement.barberId !== appointment.barberId ||
        !Number.isFinite(Number(appointment.settlement.settledAt)) ||
        !Number.isFinite(Number(appointment.settlement.amount)) ||
        Number(appointment.settlement.amount) < 0
      ) {
        errors.push({ path: `${path}/settlement`, code: "invalid_settlement", message: "Rozliczenie jest niespójne z wizytą." });
      }
    }
    if (appointment.settledAt !== undefined || appointment.settledAmount !== undefined) {
      errors.push({ path, code: "legacy_settlement", message: "Wizyta zawiera stare pola rozliczenia." });
    }
  }

  const syncRevision = Number(database.appointmentSync?.revision ?? 0);
  if (!Number.isInteger(syncRevision) || syncRevision < 0) {
    errors.push({ path: "appointmentSync/revision", code: "invalid_sync_revision", message: "Nieprawidłowa globalna rewizja wizyt." });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      barbers: barberIds.size,
      appointments: Object.keys(database.appointments ?? {}).length,
      clients: Object.keys(clients).length,
      services: [...barberIds].reduce(
        (sum, barberId) => sum + Object.keys(database.barbers?.[barberId]?.services ?? {}).length,
        0,
      ),
      availability: [...barberIds].reduce(
        (sum, barberId) => sum + Object.keys(database.barbers?.[barberId]?.workSettings?.availability ?? {}).length,
        0,
      ),
    },
  };
};

export const buildCanonicalMigration = (source, options = {}) => {
  const legacyBarberId = cleanText(options.legacyBarberId || "mateusz", 80);
  const data = clone(source);
  const changes = [];
  const migrationErrors = [];
  const recordChange = (action, path, message) => changes.push({ action, path, message });
  const differs = (first, second) => JSON.stringify(first) !== JSON.stringify(second);

  data.team ??= {};
  data.team.owner ??= {};
  const originalOwner = { ...data.team.owner };
  data.team.owner.active = data.team.owner.active === false ? false : true;
  if (differs(originalOwner, data.team.owner)) {
    recordChange("normalize", "team/owner", "Uzupełniono jawny status właściciela.");
  }
  data.team.barbers ??= {};
  for (const [barberId, member] of Object.entries(data.team.barbers)) {
    const normalizedMember = {
      ...member,
      id: barberId,
      active: member?.active === false ? false : true,
      access: Object.fromEntries(
        canonicalAccessSections.map((section) => [section, member?.access?.[section] !== false]),
      ),
    };
    data.team.barbers[barberId] = normalizedMember;
    if (differs(member, normalizedMember)) {
      recordChange("normalize", `team/barbers/${barberId}`, "Ujednolicono id, status i zakres dostępu.");
    }
  }

  const barberIds = new Set(Object.keys(data.team.barbers));
  data.barbers ??= {};
  for (const barberId of barberIds) data.barbers[barberId] ??= {};

  if (data.services !== undefined) {
    if (!barberIds.has(legacyBarberId)) {
      migrationErrors.push({ path: "services", code: "missing_legacy_barber", message: `Nie istnieje barber ${legacyBarberId}.` });
    } else {
      data.barbers[legacyBarberId].services ??= {};
      for (const [serviceId, service] of Object.entries(data.services ?? {})) {
        if (!data.barbers[legacyBarberId].services[serviceId]) {
          data.barbers[legacyBarberId].services[serviceId] = service;
          recordChange("move", `services/${serviceId}`, `Przeniesiono do barbers/${legacyBarberId}/services.`);
        } else {
          recordChange("keep_canonical", `services/${serviceId}`, "Istniejąca usługa kanoniczna ma pierwszeństwo.");
        }
      }
    }
    delete data.services;
    recordChange("remove_legacy", "services", "Usunięto starą ścieżkę po skopiowaniu danych.");
  }

  if (data.workSettings !== undefined) {
    if (!barberIds.has(legacyBarberId)) {
      migrationErrors.push({ path: "workSettings", code: "missing_legacy_barber", message: `Nie istnieje barber ${legacyBarberId}.` });
    } else {
      const canonical = data.barbers[legacyBarberId].workSettings ?? { availability: {} };
      canonical.availability ??= {};
      for (const [dateKey, availability] of Object.entries(data.workSettings?.availability ?? {})) {
        if (!canonical.availability[dateKey]) {
          canonical.availability[dateKey] = availability;
          recordChange("move", `workSettings/availability/${dateKey}`, `Przeniesiono do barbers/${legacyBarberId}/workSettings.`);
        } else {
          recordChange("keep_canonical", `workSettings/availability/${dateKey}`, "Istniejąca dostępność kanoniczna ma pierwszeństwo.");
        }
      }
      data.barbers[legacyBarberId].workSettings = canonical;
    }
    delete data.workSettings;
    recordChange("remove_legacy", "workSettings", "Usunięto starą ścieżkę po skopiowaniu danych.");
  }

  for (const barberId of barberIds) {
    const barber = data.barbers[barberId];
    barber.services = Object.fromEntries(
      Object.entries(barber.services ?? {}).map(([serviceId, service], index) => {
        const normalized = normalizeServiceRecord(serviceId, service, barberId, index);
        if (differs(service, normalized)) {
          recordChange("normalize", `barbers/${barberId}/services/${serviceId}`, "Ujednolicono relację usługi.");
        }
        return [serviceId, normalized];
      }),
    );
    barber.workSettings = {
      ...(barber.workSettings ?? {}),
      availability: Object.fromEntries(
        Object.entries(barber.workSettings?.availability ?? {}).map(([dateKey, availability]) => {
          const normalized = normalizeAvailabilityRecord(dateKey, availability, barberId);
          if (differs(availability, normalized)) {
            recordChange("normalize", `barbers/${barberId}/workSettings/availability/${dateKey}`, "Ujednolicono relację dostępności.");
          }
          return [dateKey, normalized];
        }),
      ),
    };
  }

  data.clients = Object.fromEntries(
    Object.entries(data.clients ?? {}).map(([clientId, client]) => {
      const normalized = normalizeClientRecord(clientId, client);
      if (differs(client, normalized)) {
        recordChange("normalize", `clients/${clientId}`, "Ujednolicono dane i relacje klienta.");
      }
      return [clientId, normalized];
    }),
  );
  data.appointments = Object.fromEntries(
    Object.entries(data.appointments ?? {}).map(([appointmentId, raw]) => {
      const migrated = { ...raw };
      if (!migrated.barberId) {
        migrated.barberId = legacyBarberId;
        recordChange("assign", `appointments/${appointmentId}/barberId`, `Przypisano legacy barberId ${legacyBarberId}.`);
      }
      if (!migrated.settlement && (migrated.settledAt !== undefined || migrated.settledAmount !== undefined)) {
        migrated.settlement = {
          barberId: migrated.barberId,
          settledAt: Number(migrated.settledAt),
          amount: Number(migrated.settledAmount),
        };
        recordChange("normalize", `appointments/${appointmentId}/settlement`, "Przeniesiono stare pola rozliczenia.");
      }
      delete migrated.settledAt;
      delete migrated.settledAmount;
      const appointment = normalizeAppointmentRecord(appointmentId, migrated);
      if (appointment.settlement) {
        appointment.settlement = normalizeSettlementRecord(appointment.settlement, appointment.barberId);
      }
      if (differs(raw, appointment)) {
        recordChange("normalize", `appointments/${appointmentId}`, "Ujednolicono dane i relacje wizyty.");
      }
      return [appointmentId, appointment];
    }),
  );
  const existingRevision = Number(data.appointmentSync?.revision);
  data.appointmentSync = {
    ...(data.appointmentSync ?? {}),
    revision: Number.isInteger(existingRevision) && existingRevision >= 0
      ? existingRevision
      : Object.keys(data.appointments).length > 0
        ? 1
        : 0,
  };

  const clientsByIdentity = () => {
    const index = new Map();
    for (const [clientId, client] of Object.entries(data.clients)) {
      for (const identity of getClientIdentityKeys(client)) {
        index.set(identity, [...(index.get(identity) ?? []), clientId]);
      }
    }
    return index;
  };

  let identityIndex = clientsByIdentity();
  for (const [appointmentId, appointment] of Object.entries(data.appointments)) {
    const explicitClientExists = appointment.clientId && data.clients[appointment.clientId];
    if (!explicitClientExists) {
      const identities = getClientIdentityKeys({
        userId: appointment.userId,
        email: appointment.clientEmail,
        phone: appointment.phone,
      });
      const matches = [...new Set(identities.flatMap((identity) => identityIndex.get(identity) ?? []))];
      if (matches.length === 1) {
        appointment.clientId = matches[0];
        recordChange("link", `appointments/${appointmentId}/clientId`, `Połączono z klientem ${matches[0]}.`);
      } else if (matches.length === 0) {
        const preferredId = isFirebaseKeySafe(appointment.userId)
          ? appointment.userId
          : isFirebaseKeySafe(appointment.clientId)
            ? appointment.clientId
            : `legacy-client-${appointmentId}`;
        appointment.clientId = preferredId;
        data.clients[preferredId] = createClientFromAppointment(preferredId, appointment);
        recordChange("create", `clients/${preferredId}`, `Utworzono rekord z wizyty ${appointmentId}.`);
        identityIndex = clientsByIdentity();
      } else {
        migrationErrors.push({ path: `appointments/${appointmentId}/clientId`, code: "ambiguous_client", message: `Wizyta pasuje do wielu klientów: ${matches.join(", ")}.` });
      }
    }
  }

  const aliases = new Map();
  for (const group of findDuplicateClientGroups(data.clients)) {
    const records = group.map((id) => ({ id, client: data.clients[id] }));
    const mergeError = validateClientGroupCanMerge(records);
    if (mergeError) {
      migrationErrors.push({ path: `clients/${group.join(",")}`, code: "ambiguous_duplicate", message: mergeError });
      continue;
    }
    const canonicalId = chooseCanonicalClientId(records);
    data.clients[canonicalId] = mergeClientRecords(canonicalId, records);
    for (const id of group) {
      aliases.set(id, canonicalId);
      if (id !== canonicalId) delete data.clients[id];
    }
    recordChange("merge", `clients/${canonicalId}`, `Połączono rekordy: ${group.join(", ")}.`);
  }

  for (const [appointmentId, appointment] of Object.entries(data.appointments)) {
    const canonicalClientId = aliases.get(appointment.clientId) ?? appointment.clientId;
    if (canonicalClientId !== appointment.clientId) {
      appointment.clientId = canonicalClientId;
      recordChange("relink", `appointments/${appointmentId}/clientId`, `Zmieniono relację na ${canonicalClientId}.`);
    }
    const client = data.clients[appointment.clientId];
    if (client && barberIds.has(appointment.barberId)) {
      client.barberIds[appointment.barberId] = true;
      if (!(appointment.barberId in client.hiddenFor)) client.hiddenFor[appointment.barberId] = false;
    }

    const services = data.barbers?.[appointment.barberId]?.services ?? {};
    if (!services[appointment.serviceId]) {
      const matchingServices = Object.entries(services).filter(
        ([, service]) => normalizeEmail(service.name) === normalizeEmail(appointment.serviceName),
      );
      if (matchingServices.length === 1) {
        appointment.serviceId = matchingServices[0][0];
        recordChange("link", `appointments/${appointmentId}/serviceId`, `Połączono z usługą ${appointment.serviceId}.`);
      }
    }
  }

  for (const [clientId, client] of Object.entries(data.clients)) {
    client.barberIds = Object.fromEntries(
      Object.entries(client.barberIds ?? {}).filter(([barberId, enabled]) => barberIds.has(barberId) && enabled === true),
    );
    client.hiddenFor = Object.fromEntries(
      Object.entries(client.hiddenFor ?? {}).filter(([barberId]) => barberIds.has(barberId)),
    );
    data.clients[clientId] = normalizeClientRecord(clientId, client);
  }

  const validation = validateCanonicalDatabase(data);
  const errors = [...migrationErrors, ...validation.errors];
  return {
    data,
    report: {
      mode: "dry-run",
      generatedAt: new Date().toISOString(),
      legacyBarberId,
      canApply: errors.length === 0,
      changes,
      changeCounts: changes.reduce(
        (counts, change) => ({ ...counts, [change.action]: (counts[change.action] ?? 0) + 1 }),
        {},
      ),
      errors,
      warnings: validation.warnings,
      statsBefore: {
        appointments: Object.keys(source?.appointments ?? {}).length,
        clients: Object.keys(source?.clients ?? {}).length,
      },
      statsAfter: validation.stats,
    },
  };
};
