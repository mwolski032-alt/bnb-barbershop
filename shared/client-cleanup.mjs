import {
  cleanText,
  isFirebaseKeySafe,
  normalizeAppointmentRecord,
  normalizeClientRecord,
} from "./data-model.mjs";

const retainedAppointmentStatuses = new Set(["confirmed", "completed"]);
const normalizeName = (value) => cleanText(value, 160).toLocaleLowerCase("pl");
const clientName = (client) => [client?.firstName, client?.lastName].filter(Boolean).join(" ");

const matchesIdentity = (appointment, clientIds, userIds) =>
  clientIds.has(appointment.clientId) || userIds.has(appointment.userId);

export const buildClientDatabaseCleanup = (source, options = {}) => {
  const data = structuredClone(source ?? {});
  const keepNames = new Set((options.keepNames ?? []).map(normalizeName).filter(Boolean));
  if (keepNames.size === 0) throw new Error("Podaj co najmniej jednego klienta do zachowania.");

  const originalClients = data.clients ?? {};
  const originalAppointments = data.appointments ?? {};
  const keptClientIds = new Set();
  const keptUserIds = new Set();

  for (const [id, raw] of Object.entries(originalClients)) {
    const client = normalizeClientRecord(id, raw);
    if (!keepNames.has(normalizeName(clientName(client)))) continue;
    keptClientIds.add(id);
    if (client.userId) keptUserIds.add(client.userId);
  }

  for (const [id, raw] of Object.entries(originalAppointments)) {
    const appointment = normalizeAppointmentRecord(id, raw);
    if (!keepNames.has(normalizeName(appointment.clientName))) continue;
    if (appointment.clientId) keptClientIds.add(appointment.clientId);
    if (appointment.userId) keptUserIds.add(appointment.userId);
  }

  const appointments = {};
  for (const [id, raw] of Object.entries(originalAppointments)) {
    let appointment = normalizeAppointmentRecord(id, raw);
    if (!retainedAppointmentStatuses.has(appointment.status)) continue;
    if (
      !matchesIdentity(appointment, keptClientIds, keptUserIds) &&
      !keepNames.has(normalizeName(appointment.clientName))
    ) {
      continue;
    }
    const canonicalClientId = appointment.clientId || appointment.userId;
    if (!isFirebaseKeySafe(canonicalClientId)) {
      throw new Error(`Wizyta ${id} nie ma prawidłowego identyfikatora zachowanego klienta.`);
    }
    keptClientIds.add(canonicalClientId);
    if (appointment.userId) keptUserIds.add(appointment.userId);
    const services = data.barbers?.[appointment.barberId]?.services ?? {};
    if (!services[appointment.serviceId]) {
      const matchingServices = Object.entries(services).filter(
        ([, service]) => normalizeName(service?.name) === normalizeName(appointment.serviceName),
      );
      if (matchingServices.length === 1) {
        const [serviceId, service] = matchingServices[0];
        appointment = normalizeAppointmentRecord(id, {
          ...appointment,
          serviceId,
          serviceName: service.name,
          price: service.price,
          durationMinutes: service.durationMinutes,
        });
      }
    }
    appointments[id] = { ...appointment, clientId: canonicalClientId };
  }

  const clients = {};
  for (const [id, raw] of Object.entries(originalClients)) {
    const client = normalizeClientRecord(id, raw);
    if (!keptClientIds.has(id) && !keptUserIds.has(client.userId)) continue;
    clients[id] = client;
  }

  for (const appointment of Object.values(appointments)) {
    const existing = clients[appointment.clientId];
    if (existing) {
      clients[appointment.clientId] = normalizeClientRecord(appointment.clientId, {
        ...existing,
        barberIds: { ...(existing.barberIds ?? {}), [appointment.barberId]: true },
        hiddenFor: { ...(existing.hiddenFor ?? {}), [appointment.barberId]: false },
      });
      continue;
    }
    const parts = appointment.clientName.split(/\s+/).filter(Boolean);
    clients[appointment.clientId] = normalizeClientRecord(appointment.clientId, {
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" "),
      email: appointment.clientEmail,
      phone: appointment.phone,
      photoUrl: appointment.clientPhotoUrl,
      userId: appointment.userId || undefined,
      barberIds: { [appointment.barberId]: true },
      hiddenFor: { [appointment.barberId]: false },
      createdAt: appointment.createdAt,
      updatedAt: Date.now(),
    });
  }

  const keptAppointmentIds = new Set(Object.keys(appointments));
  const appointmentOperations = Object.fromEntries(
    Object.entries(data.appointmentOperations ?? {}).filter(([, operation]) =>
      keptAppointmentIds.has(operation?.appointmentId),
    ),
  );
  const keptOperationIds = new Set(Object.keys(appointmentOperations));
  const notificationOutbox = Object.fromEntries(
    Object.entries(data.notificationOutbox ?? {}).filter(([operationId]) =>
      keptOperationIds.has(operationId),
    ),
  );

  data.clients = clients;
  data.appointments = appointments;
  data.appointmentOperations = appointmentOperations;
  data.notificationOutbox = notificationOutbox;
  data.appointmentSync = {
    revision: (Number(data.appointmentSync?.revision) || 0) + 1,
    updatedAt: Date.now(),
  };

  const removedClientCount = Object.keys(originalClients).filter((id) => !clients[id]).length;

  return {
    data,
    report: {
      keepNames: [...keepNames],
      clientsBefore: Object.keys(originalClients).length,
      clientsAfter: Object.keys(clients).length,
      appointmentsBefore: Object.keys(originalAppointments).length,
      appointmentsAfter: Object.keys(appointments).length,
      removedClients: removedClientCount,
      removedAppointments: Object.keys(originalAppointments).length - Object.keys(appointments).length,
    },
  };
};
