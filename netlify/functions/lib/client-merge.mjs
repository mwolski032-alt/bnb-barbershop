import { createHash } from "node:crypto";
import { cleanText, isFirebaseKeySafe, normalizePhone } from "../../../shared/data-model.mjs";

const failure = (error, status = 409) => ({ error, status });
const summary = (id, client) => ({
  id,
  name: [client.firstName, client.lastName].filter(Boolean).join(" "),
  email: client.email || "",
  phone: client.phone || "",
});
const sortedEntries = (records) => Object.entries(records ?? {}).sort(([a], [b]) => a.localeCompare(b));

export const inspectClientMerge = (database, actorUid, sourceId, targetId) => {
  if (![sourceId, targetId].every(isFirebaseKeySafe) || sourceId === targetId) {
    return failure("Wybierz dwie różne karty klientów.", 400);
  }
  const owner = database.team?.owner;
  const isOwner = owner?.active === true && owner.userId === actorUid;
  const assignments = Object.entries(database.team?.barbers ?? {})
    .filter(([, member]) => member?.userId === actorUid);
  const [barberId, member] = assignments.length === 1 ? assignments[0] : [];
  if (!isOwner && (!member?.active || !member.access?.clients || !member.access?.schedule)) {
    return failure("Scalanie wymaga dostępu do klientów i terminarza.", 403);
  }
  const source = database.clients?.[sourceId];
  const target = database.clients?.[targetId];
  if (!source || !target) return failure("Jedna z kart już nie istnieje. Odśwież bazę klientów.");
  if (!isOwner && (source.barberIds?.[barberId] !== true || target.barberIds?.[barberId] !== true)) {
    return failure("Możesz scalać tylko klientów ze swojej bazy.", 403);
  }
  if (source.userId || !target.userId || target.userId !== targetId) {
    return failure("Wybierz ręczną kartę jako źródło i konto zalogowanego klienta jako cel. Dwóch kont logowania nie można scalić.");
  }
  const appointments = sortedEntries(database.appointments).filter(([, a]) => a.clientId === sourceId);
  const waitlist = sortedEntries(database.waitlistEntries).filter(([, e]) => e.clientId === sourceId);
  const sourceBarbers = new Set([
    ...Object.keys(source.barberIds ?? {}).filter(id => source.barberIds[id] === true),
    ...appointments.map(([, a]) => a.barberId),
    ...waitlist.map(([, e]) => e.barberId),
  ]);
  if (!isOwner && [...sourceBarbers].some(id => id !== barberId)) {
    return failure("Ta ręczna karta obejmuje kilku barberów. Może ją scalić właściciel salonu.", 403);
  }
  if ([...appointments, ...waitlist].some(([, record]) => record.userId && record.userId !== target.userId)) {
    return failure("Historia tej karty jest już przypisana do innego konta. Scalenie zostało zatrzymane.");
  }
  const fingerprint = JSON.stringify({ source, target, appointments, waitlist });
  const token = createHash("sha256").update(fingerprint).digest("hex");
  return {
    source, target, appointments, waitlist, sourceBarbers,
    preview: {
      source: summary(sourceId, source),
      target: summary(targetId, target),
      appointmentCount: appointments.length,
      waitlistCount: waitlist.length,
      samePhone: normalizePhone(source.phone).length === 9 &&
        normalizePhone(source.phone) === normalizePhone(target.phone),
      token,
    },
  };
};

export const mergeConfirmedClients = (database, actorUid, body, operationId) => {
  if (body.confirmed !== true) return failure("Potwierdź, że obie karty należą do tej samej osoby.", 400);
  const sourceId = cleanText(body.sourceClientId, 120);
  const targetId = cleanText(body.targetClientId, 120);
  const inspection = inspectClientMerge(database, actorUid, sourceId, targetId);
  if (inspection.error) return inspection;
  if (body.previewToken !== inspection.preview.token) {
    return failure("Dane klienta lub jego wizyty zmieniły się. Sprawdź podgląd scalenia ponownie.");
  }
  const { source, target, appointments, waitlist, sourceBarbers } = inspection;
  const now = Date.now();
  const client = {
    ...target,
    phone: target.phone || source.phone || "",
    barberIds: { ...source.barberIds, ...target.barberIds,
      ...Object.fromEntries([...sourceBarbers].filter(Boolean).map(id => [id, true])) },
    hiddenFor: { ...source.hiddenFor, ...target.hiddenFor },
    createdAt: Math.min(...[source.createdAt, target.createdAt, now].map(Number).filter(n => n > 0)),
    updatedAt: now,
  };
  // Keep pre-merge records in the server-only operation log for recovery/audit.
  const clientMergeAudit = {
    sourceClientId: sourceId, targetClientId: targetId, approvedBy: actorUid, approvedAt: now,
    source: structuredClone(source), targetBefore: structuredClone(target),
    appointmentsBefore: Object.fromEntries(appointments.map(([id, a]) => [id, structuredClone(a)])),
    waitlistBefore: Object.fromEntries(waitlist.map(([id, e]) => [id, structuredClone(e)])),
  };
  const linkRecord = record => ({
    ...record,
    clientId: targetId,
    userId: target.userId,
    clientEmail: target.email || "",
    clientPhotoUrl: target.photoUrl || record.clientPhotoUrl || "",
    version: Math.max(1, Number(record.version) || 1) + 1,
    lastOperationId: operationId,
    updatedAt: now,
  });
  for (const [id, appointment] of appointments) database.appointments[id] = linkRecord(appointment);
  for (const [id, entry] of waitlist) database.waitlistEntries[id] = linkRecord(entry);
  database.clients[targetId] = client;
  delete database.clients[sourceId];
  return { client, clientMergeAudit };
};
