const appointmentFields = [
  "id",
  "barberId",
  "userId",
  "clientId",
  "clientName",
  "clientEmail",
  "clientPhotoUrl",
  "phone",
  "serviceId",
  "serviceName",
  "price",
  "priceAmount",
  "originalPriceAmount",
  "priceAdjustedAt",
  "priceAdjustedBy",
  "dateKey",
  "startTime",
  "durationMinutes",
  "status",
  "version",
  "createdAt",
  "updatedAt",
  "lastOperationId",
  "rescheduleRequestedBy",
];

const publicAppointmentFields = [
  "id",
  "barberId",
  "clientName",
  "serviceName",
  "price",
  "priceAmount",
  "dateKey",
  "startTime",
  "durationMinutes",
  "status",
  "version",
];

const sameValue = (first, second) => JSON.stringify(first) === JSON.stringify(second);

const cleanSnapshot = (value) => {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    appointmentFields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  );
};

const publicSnapshot = (value) => {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(
    publicAppointmentFields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]]),
  );
};

const actorDetails = (database, actorUid) => {
  const owner = database.team?.owner ?? {};
  if (owner.active === true && owner.userId === actorUid) {
    return { role: "owner", barberId: "", label: "Właściciel" };
  }

  for (const [barberId, member] of Object.entries(database.team?.barbers ?? {})) {
    if (member?.active === true && member.userId === actorUid) {
      return {
        role: "barber",
        barberId,
        label: String(member.displayName || member.name || barberId).slice(0, 120),
      };
    }
  }

  return { role: "client", barberId: "", label: "Klient" };
};

const changedAppointments = (before = {}, after = {}) => {
  const changes = {};
  for (const id of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const previous = before?.[id] ?? null;
    const next = after?.[id] ?? null;
    if (sameValue(previous, next)) continue;
    changes[id] = {
      id,
      type: previous ? (next ? "updated" : "deleted") : "created",
      before: cleanSnapshot(previous),
      after: cleanSnapshot(next),
    };
  }
  return changes;
};

export const appendAppointmentAudit = (
  database,
  before,
  result,
  actorUid,
  createdAt = Date.now(),
) => {
  const operationId = String(result?.operationId ?? "");
  const operation = database.appointmentOperations?.[operationId];
  if (!operationId || !operation || database.appointmentAudit?.[operationId]) return null;

  const appointments = changedAppointments(before.appointments, database.appointments);
  if (Object.keys(appointments).length === 0) return null;

  const actor = actorDetails(database, actorUid || operation.actorUid);
  const record = {
    id: operationId,
    operationId,
    action: String(operation.action || "appointment_changed").slice(0, 80),
    actorUid: String(actorUid || operation.actorUid || "").slice(0, 128),
    actorRole: actor.role,
    actorBarberId: actor.barberId,
    actorLabel: actor.label,
    appointmentIds: Object.fromEntries(Object.keys(appointments).map((id) => [id, true])),
    appointments,
    createdAt,
    schemaVersion: 1,
  };
  database.appointmentAudit ??= {};
  database.appointmentAudit[operationId] = record;
  return record;
};

export const publicAppointmentAudit = (record = {}) => ({
  id: String(record.id || record.operationId || ""),
  action: String(record.action || "appointment_changed"),
  actorRole: ["owner", "barber", "client"].includes(record.actorRole)
    ? record.actorRole
    : "client",
  actorBarberId: String(record.actorBarberId || ""),
  actorLabel: String(record.actorLabel || "").slice(0, 120),
  createdAt: Number(record.createdAt) || 0,
  changes: Object.values(record.appointments ?? {}).map((change) => ({
    id: String(change?.id || ""),
    type: ["created", "updated", "deleted"].includes(change?.type)
      ? change.type
      : "updated",
    before: publicSnapshot(change?.before),
    after: publicSnapshot(change?.after),
  })),
});
