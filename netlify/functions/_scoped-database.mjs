import {
  patchDatabase,
  readDatabase,
  withDatabaseLock,
} from "./_firebase-admin.mjs";

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

const addRealtimeSyncMarkers = async (database, before, result, actorUid, accessToken) => {
  const { userIds, barberIds } = collectRecipients(
    before,
    database,
    actorUid,
    result.notificationUserIds ?? [],
  );
  if (userIds.length === 0 && barberIds.length === 0) return;

  const [currentUserMarkers, currentBarberMarkers] = await Promise.all([
    Promise.all(
      userIds.map((uid) =>
        readDatabase(`appointmentSync/users/${encodeURIComponent(uid)}`, accessToken),
      ),
    ),
    Promise.all(
      barberIds.map((barberId) =>
        readDatabase(`appointmentSync/barbers/${encodeURIComponent(barberId)}`, accessToken),
      ),
    ),
  ]);
  database.appointmentSync ??= {};
  database.appointmentSync.users ??= {};
  database.appointmentSync.barbers ??= {};
  const now = Date.now();
  userIds.forEach((uid, index) => {
    const currentRevision = Number(currentUserMarkers[index]?.revision) || 0;
    database.appointmentSync.users[uid] = {
      revision: Math.max(now, currentRevision + 1),
      updatedAt: now,
    };
  });
  barberIds.forEach((barberId, index) => {
    const currentRevision = Number(currentBarberMarkers[index]?.revision) || 0;
    database.appointmentSync.barbers[barberId] = {
      revision: Math.max(now, currentRevision + 1),
      updatedAt: now,
    };
  });
  result.syncRevision = Number(database.appointmentSync.users[actorUid]?.revision) || now;
  if (result.operationId && database.appointmentOperations?.[result.operationId]) {
    database.appointmentOperations[result.operationId].syncRevision = result.syncRevision;
  }
};

export const mutateScopedDatabase = async (
  accessToken,
  mutation,
  { actorUid = "", sections = defaultSections, lockScope = "appointments" } = {},
) =>
  withDatabaseLock(lockScope, accessToken, async () => {
    const values = await Promise.all(sections.map((path) => readDatabase(path, accessToken)));
    const database = Object.fromEntries(
      sections.map((path, index) => [path, values[index] ?? {}]),
    );
    // Keep sync updates as leaf patches so legacy markers are not overwritten.
    database.appointmentSync = { users: {}, barbers: {} };
    const before = structuredClone(database);
    const result = await mutation(database);
    if (result.error || result.idempotent) return result;

    await addRealtimeSyncMarkers(database, before, result, actorUid, accessToken);
    const updates = {};
    collectPatch(before, database, "", updates);
    if (Object.keys(updates).length > 0) await patchDatabase("", updates, accessToken);
    return { ...result, database };
  });
