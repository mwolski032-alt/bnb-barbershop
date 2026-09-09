import {
  readDatabase,
  withDatabaseLock,
} from "./_firebase-admin.mjs";
import { appendAppointmentAudit } from "../../shared/appointment-audit.mjs";

const defaultSections = [
  "appointments",
  "clients",
  "waitlistEntries",
  "appointmentOperations",
  "notificationOutbox",
  "team",
];

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const sameValue = (first, second) => JSON.stringify(first) === JSON.stringify(second);

const collectPatch = (before, after, path, updates) => {
  if (sameValue(before, after)) return;
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      collectPatch(before[key], after[key], path ? `${path}/${key}` : key, updates);
    }
    return;
  }
  updates[path] = after === undefined ? null : after;
};

const changedRecords = (before = {}, after = {}) => {
  const records = [];
  for (const id of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (!sameValue(before?.[id], after?.[id])) {
      records.push(before?.[id], after?.[id]);
    }
  }
  return records.filter(Boolean);
};

const collectRecipients = (before, after, actorUid, additionalUserIds = []) => {
  const userIds = new Set([actorUid, ...additionalUserIds].filter(Boolean));
  const barberIds = new Set();
  for (const section of ["appointments", "waitlistEntries", "clients"]) {
    for (const record of changedRecords(before[section], after[section])) {
      if (record.userId) userIds.add(String(record.userId));
      if (record.barberId) barberIds.add(String(record.barberId));
      for (const [barberId, linked] of Object.entries(record.barberIds ?? {})) {
        if (linked === true) barberIds.add(barberId);
      }
    }
  }

  const ownerUid = after.team?.owner?.active === true ? after.team.owner.userId : "";
  if (ownerUid) userIds.add(String(ownerUid));
  for (const barberId of barberIds) {
    const member = after.team?.barbers?.[barberId];
    if (member?.active === true && member.userId) userIds.add(String(member.userId));
  }
  return { userIds: [...userIds], barberIds: [...barberIds] };
};

const addRealtimeSyncMarkers = (database, before, result, actorUid) => {
  const { userIds, barberIds } = collectRecipients(
    before,
    database,
    actorUid,
    result.notificationUserIds ?? [],
  );
  if (userIds.length === 0 && barberIds.length === 0) return;

  database.appointmentSync ??= {};
  database.appointmentSync.users ??= {};
  database.appointmentSync.barbers ??= {};
  const now = Date.now();
  userIds.forEach((uid) => {
    database.appointmentSync.users[uid] = {
      revision: { ".sv": { increment: 1 } },
      updatedAt: now,
    };
  });
  barberIds.forEach((barberId) => {
    database.appointmentSync.barbers[barberId] = {
      revision: { ".sv": { increment: 1 } },
      updatedAt: now,
    };
  });
  result.syncRevision = 0;
  if (result.operationId && database.appointmentOperations?.[result.operationId]) {
    database.appointmentOperations[result.operationId].syncRevision = result.syncRevision;
  }
};

export const mutateScopedDatabase = async (
  accessToken,
  mutation,
  { actorUid = "", sections = defaultSections, lockScope = "appointments", load } = {},
) =>
  withDatabaseLock(lockScope, accessToken, async (lease) => {
    const database = load ? await load() : Object.fromEntries(
      await Promise.all(sections.map(async path => [path, (await readDatabase(path, accessToken)) ?? {}])),
    );
    // Keep sync updates as leaf patches so legacy markers are not overwritten.
    database.appointmentSync = { users: {}, barbers: {} };
    const before = structuredClone(database);
    const result = await mutation(database);
    if (result.error || result.idempotent) return { ...result, database: { ...database, partial: true } };

    appendAppointmentAudit(database, before, result, actorUid);
    addRealtimeSyncMarkers(database, before, result, actorUid);
    const updates = {};
    collectPatch(before, database, "", updates);
    if (Object.keys(updates).length > 0) await lease.commit(updates, result.operationId);
    return { ...result, database: { ...database, partial: true } };
  });
