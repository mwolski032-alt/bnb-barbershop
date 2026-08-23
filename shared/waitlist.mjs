import { isBookableStartTime } from "./booking-time.mjs";

export const WAITLIST_OFFER_DURATION_MS = 10 * 60 * 1000;

const timeToMinutes = (time) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + minutes;
};

const matchesTimePreference = (preference, startTime) => {
  const minutes = timeToMinutes(startTime);
  if (preference === "morning") return minutes < 12 * 60;
  if (preference === "afternoon") return minutes >= 12 * 60 && minutes < 17 * 60;
  if (preference === "evening") return minutes >= 17 * 60;
  return true;
};

export const waitlistEntryMatchesSlot = (entry, slot) =>
  entry?.status === "waiting" &&
  entry.barberId === slot.barberId &&
  entry.serviceId === slot.serviceId &&
  entry.dateFrom <= slot.dateKey &&
  entry.dateTo >= slot.dateKey &&
  matchesTimePreference(entry.timePreference, slot.startTime);

const notificationKeyPart = (value) =>
  String(value ?? "")
    .replace(/[.#$\[\]/]/g, "-")
    .slice(0, 90);

const enqueueWaitlistNotification = (
  database,
  entry,
  slot,
  sourceOperationId,
  actorUid,
  now,
) => {
  const operationId = `${notificationKeyPart(sourceOperationId)}-wait-${notificationKeyPart(entry.id)}`;
  const appointmentId = `waitlist-${notificationKeyPart(entry.id)}`;
  const appointment = {
    id: appointmentId,
    barberId: slot.barberId,
    clientId: entry.userId,
    userId: entry.userId,
    serviceId: slot.serviceId,
    clientName: entry.clientName,
    clientEmail: entry.clientEmail,
    phone: entry.phone,
    serviceName: slot.serviceName,
    price: slot.price,
    dateKey: slot.dateKey,
    startTime: slot.startTime,
    durationMinutes: slot.durationMinutes,
    status: "confirmed",
    version: 1,
    waitlistId: entry.id,
    offerExpiresAt: now + WAITLIST_OFFER_DURATION_MS,
    lastOperationId: operationId,
    createdAt: now,
    updatedAt: now,
  };

  database.appointmentOperations ??= {};
  database.notificationOutbox ??= {};
  database.appointmentOperations[operationId] = {
    operationId,
    action: "notify_waitlist",
    actorUid,
    appointmentId,
    appointment,
    syncRevision: Number(database.appointmentSync?.revision) || 0,
    createdAt: now,
  };
  database.notificationOutbox[operationId] = {
    operationId,
    appointmentId,
    event: "waitlist_slot_open",
    barberId: slot.barberId,
    userId: entry.userId,
    status: "pending",
    attempts: 0,
    maxAttempts: 6,
    nextAttemptAt: now,
    deduplicationKey: operationId,
    createdAt: now,
    updatedAt: now,
  };
  return operationId;
};

export const offerWaitlistSlot = (
  database,
  slot,
  {
    sourceOperationId,
    actorUid = "system",
    excludeUserId = "",
    excludedEntryIds = [],
    now = Date.now(),
  } = {},
) => {
  if (!isBookableStartTime(slot.dateKey, slot.startTime, new Date(now))) {
    return { entry: null, operationId: "" };
  }

  const excludedIds = new Set(excludedEntryIds);
  const candidates = Object.entries(database.waitlistEntries ?? {})
    .map(([id, entry]) => ({ ...entry, id: entry?.id || id }))
    .filter(
      (entry) =>
        !excludedIds.has(entry.id) &&
        entry.userId !== excludeUserId &&
        waitlistEntryMatchesSlot(entry, slot),
    )
    .sort(
      (first, second) =>
        (Number(first.createdAt) || 0) - (Number(second.createdAt) || 0) ||
        first.id.localeCompare(second.id),
    );
  const entry = candidates[0];
  if (!entry) return { entry: null, operationId: "" };

  const offer = {
    dateKey: slot.dateKey,
    startTime: slot.startTime,
    barberId: slot.barberId,
    serviceId: slot.serviceId,
    serviceName: slot.serviceName,
    price: slot.price,
    durationMinutes: slot.durationMinutes,
    offeredAt: now,
    expiresAt: now + WAITLIST_OFFER_DURATION_MS,
  };
  const offeredEntry = {
    ...entry,
    status: "offered",
    offer,
    version: Math.max(1, Number(entry.version) || 1) + 1,
    updatedAt: now,
  };
  database.waitlistEntries ??= {};
  database.waitlistEntries[entry.id] = offeredEntry;
  const operationId = enqueueWaitlistNotification(
    database,
    offeredEntry,
    slot,
    sourceOperationId || `waitlist-${now}`,
    actorUid,
    now,
  );
  return { entry: offeredEntry, operationId };
};

export const advanceExpiredWaitlistOffers = (database, now = Date.now()) => {
  const expired = Object.entries(database.waitlistEntries ?? {})
    .map(([id, entry]) => ({ ...entry, id: entry?.id || id }))
    .filter(
      (entry) =>
        entry.status === "offered" &&
        entry.offer &&
        Number(entry.offer.expiresAt) <= now,
    )
    .sort((first, second) => Number(first.offer.expiresAt) - Number(second.offer.expiresAt));
  const notificationOperationIds = [];

  for (const entry of expired) {
    const slot = { ...entry.offer };
    database.waitlistEntries[entry.id] = {
      ...entry,
      status: "waiting",
      offer: null,
      version: Math.max(1, Number(entry.version) || 1) + 1,
      updatedAt: now,
    };
    const result = offerWaitlistSlot(database, slot, {
      sourceOperationId: `waitlist-expired-${entry.id}-${Number(entry.offer.expiresAt)}`,
      excludedEntryIds: [entry.id],
      now,
    });
    if (result.operationId) notificationOperationIds.push(result.operationId);
  }

  return { changed: expired.length > 0, expiredCount: expired.length, notificationOperationIds };
};

export const hasBlockingWaitlistOffer = (database, appointment, userId, now = Date.now()) =>
  Object.values(database.waitlistEntries ?? {}).some(
    (entry) =>
      entry?.status === "offered" &&
      entry.userId !== userId &&
      Number(entry.offer?.expiresAt) > now &&
      entry.offer?.barberId === appointment.barberId &&
      entry.offer?.dateKey === appointment.dateKey &&
      entry.offer?.startTime === appointment.startTime,
  );

export const consumeMatchingWaitlistEntry = (database, appointment, userId) => {
  const matches = Object.entries(database.waitlistEntries ?? {}).filter(([, entry]) => {
    if (entry?.userId !== userId || entry.barberId !== appointment.barberId) return false;
    if (entry.serviceId !== appointment.serviceId) return false;
    if (entry.status === "offered") {
      return (
        entry.offer?.dateKey === appointment.dateKey &&
        entry.offer?.startTime === appointment.startTime
      );
    }
    return (
      entry.status === "waiting" &&
      entry.dateFrom <= appointment.dateKey &&
      entry.dateTo >= appointment.dateKey &&
      matchesTimePreference(entry.timePreference, appointment.startTime)
    );
  });
  for (const [id] of matches) delete database.waitlistEntries[id];
  return matches.map(([id]) => id);
};
