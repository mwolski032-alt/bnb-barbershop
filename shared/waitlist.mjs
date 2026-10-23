import { isBookableStartTime } from "./booking-time.mjs";

export const WAITLIST_OFFER_DURATION_MS = 10 * 60 * 1000;
export const WAITLIST_REOFFER_COOLDOWN_MS = 60 * 60 * 1000;

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

/** The client may pick specific days (`dates`); older entries only have a range. */
export const waitlistCoversDate = (entry, dateKey) =>
  entry.dateFrom <= dateKey &&
  entry.dateTo >= dateKey &&
  (!Array.isArray(entry.dates) || entry.dates.length === 0 || entry.dates.includes(dateKey));

const rangesOverlap = (firstStart, firstDuration, secondStart, secondDuration) =>
  firstStart < secondStart + secondDuration && secondStart < firstStart + firstDuration;

const dateKeyFromUtc = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

const dateKeysBetween = (dateFrom, dateTo, maxDays = 62) => {
  const [startYear, startMonth, startDay] = String(dateFrom).split("-").map(Number);
  const [endYear, endMonth, endDay] = String(dateTo).split("-").map(Number);
  const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
  const keys = [];
  while (current <= end && keys.length < maxDays) {
    keys.push(dateKeyFromUtc(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return keys;
};

const formatTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const hasSlotConflict = (database, slot, now) => {
  const conflictsWithAppointment = Object.values(database.appointments ?? {}).some(
    (appointment) =>
      appointment?.status !== "cancelled" &&
      appointment?.barberId === slot.barberId &&
      appointment?.dateKey === slot.dateKey &&
      rangesOverlap(
        timeToMinutes(appointment.startTime),
        Number(appointment.durationMinutes) || 15,
        timeToMinutes(slot.startTime),
        slot.durationMinutes,
      ),
  );
  if (conflictsWithAppointment) return true;

  return Object.values(database.waitlistEntries ?? {}).some(
    (entry) =>
      entry?.status === "offered" &&
      Number(entry.offer?.expiresAt) > now &&
      entry.offer?.barberId === slot.barberId &&
      entry.offer?.dateKey === slot.dateKey &&
      rangesOverlap(
        timeToMinutes(entry.offer.startTime),
        Number(entry.offer.durationMinutes) || Number(entry.durationMinutes) || 15,
        timeToMinutes(slot.startTime),
        slot.durationMinutes,
      ),
  );
};

/**
 * Every day inside the entry's wishes that has a free matching slot, earliest first:
 * [{ ...slot }] with one slot (the first free one) per day.
 */
const findAvailableDaysForEntry = (database, entry, now) => {
  const days = [];
  const member = database.team?.barbers?.[entry.barberId];
  const barber = database.barbers?.[entry.barberId];
  const service = barber?.services?.[entry.serviceId];
  if (
    member?.active !== true ||
    !member.userId ||
    !service ||
    service.id !== entry.serviceId ||
    service.barberId !== entry.barberId
  ) {
    return days;
  }

  const durationMinutes = Math.max(15, Number(service.durationMinutes) || 15);
  const todayKey = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(
    new Date(now),
  );
  const dateFrom = entry.dateFrom > todayKey ? entry.dateFrom : todayKey;

  for (const dateKey of dateKeysBetween(dateFrom, entry.dateTo)) {
    if (!waitlistCoversDate(entry, dateKey)) continue;
    const availability = barber.workSettings?.availability?.[dateKey];
    if (
      !availability ||
      availability.id !== dateKey ||
      availability.dateKey !== dateKey ||
      availability.barberId !== entry.barberId
    ) {
      continue;
    }

    const start = Math.ceil(timeToMinutes(availability.startTime) / 15) * 15;
    const end = timeToMinutes(availability.endTime);
    for (let minutes = start; minutes + durationMinutes <= end; minutes += 15) {
      const startTime = formatTime(minutes);
      if (!matchesTimePreference(entry.timePreference, startTime)) continue;
      if (!isBookableStartTime(dateKey, startTime, new Date(now))) continue;
      const slot = {
        barberId: entry.barberId,
        serviceId: entry.serviceId,
        serviceName: String(service.name || entry.serviceName || "Usługa"),
        price: String(service.price || ""),
        dateKey,
        startTime,
        durationMinutes,
      };
      if (!hasSlotConflict(database, slot, now)) {
        days.push(slot);
        break;
      }
    }
  }
  return days;
};

export const waitlistEntryMatchesSlot = (entry, slot, now = Date.now()) =>
  entry?.status === "waiting" &&
  Number(entry.nextOfferAt || 0) <= now &&
  entry.barberId === slot.barberId &&
  entry.serviceId === slot.serviceId &&
  waitlistCoversDate(entry, slot.dateKey) &&
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
  // "notify_waitlist": a slot held for this client for ten minutes (a cancellation).
  // "notify_waitlist_day": new free days that stay open to everyone.
  { action = "notify_waitlist", event = "waitlist_slot_open", extra = {} } = {},
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
    ...(action === "notify_waitlist" ? { offerExpiresAt: now + WAITLIST_OFFER_DURATION_MS } : {}),
    ...extra,
    lastOperationId: operationId,
    createdAt: now,
    updatedAt: now,
  };

  database.appointmentOperations ??= {};
  database.notificationOutbox ??= {};
  database.appointmentOperations[operationId] = {
    operationId,
    action,
    actorUid,
    appointmentId,
    appointment,
    syncRevision: Number(database.appointmentSync?.revision) || 0,
    createdAt: now,
  };
  database.notificationOutbox[operationId] = {
    operationId,
    appointmentId,
    event,
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
        waitlistEntryMatchesSlot(entry, slot, now),
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
    nextOfferAt: 0,
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
      nextOfferAt: now + WAITLIST_REOFFER_COOLDOWN_MS,
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

  return {
    changed: expired.length > 0,
    expiredCount: expired.length,
    expiredEntryIds: expired.map((entry) => entry.id),
    notificationOperationIds,
  };
};

/**
 * The barber added availability: tell every waiting client whose wishes now have a free day.
 * Nothing is held. The new days are open to everyone, the client is simply told first, and each
 * entry is told about a day only once (`notifiedDates`). A new entry, or one from before this existed,
 * first records the days that are free right now without announcing them.
 */
export const notifyNewWaitlistDays = (
  database,
  { now = Date.now(), maxNotifications = 20, excludedEntryIds = [] } = {},
) => {
  const excludedIds = new Set(excludedEntryIds);
  const waitingIds = Object.entries(database.waitlistEntries ?? {})
    .map(([id, entry]) => ({ ...entry, id: entry?.id || id }))
    .filter(
      (entry) =>
        entry.status === "waiting" &&
        !excludedIds.has(entry.id) &&
        Number(entry.nextOfferAt || 0) <= now,
    )
    .sort(
      (first, second) =>
        (Number(first.createdAt) || 0) - (Number(second.createdAt) || 0) ||
        first.id.localeCompare(second.id),
    )
    .map((entry) => entry.id);
  const notificationOperationIds = [];
  let changed = false;
  const limit = Math.max(1, Math.min(50, Number(maxNotifications) || 20));

  for (const entryId of waitingIds) {
    const entry = database.waitlistEntries?.[entryId];
    if (entry?.status !== "waiting") continue;
    const days = findAvailableDaysForEntry(database, { ...entry, id: entryId }, now);
    const free = days.map((day) => day.dateKey);

    if (!Array.isArray(entry.notifiedDates)) {
      entry.notifiedDates = free;
      changed = true;
      continue;
    }
    const known = new Set(entry.notifiedDates);
    const fresh = days.filter((day) => !known.has(day.dateKey));
    // Days that are no longer free are forgotten, so they count as new when they open up again.
    const kept = entry.notifiedDates.filter((dateKey) => free.includes(dateKey));
    if (fresh.length === 0) {
      if (kept.length !== entry.notifiedDates.length) {
        entry.notifiedDates = kept;
        changed = true;
      }
      continue;
    }
    if (notificationOperationIds.length >= limit) break;

    const first = fresh[0];
    const operationId = enqueueWaitlistNotification(
      database,
      { ...entry, id: entryId },
      first,
      `waitlist-days-${entryId}-${first.dateKey}-${now}`,
      "system",
      now,
      {
        action: "notify_waitlist_day",
        event: "waitlist_day_open",
        extra: { newDates: fresh.map((day) => day.dateKey), daysCount: fresh.length },
      },
    );
    entry.notifiedDates = [...kept, ...fresh.map((day) => day.dateKey)].sort();
    notificationOperationIds.push(operationId);
    changed = true;
  }

  return {
    changed,
    notifiedCount: notificationOperationIds.length,
    notificationOperationIds,
  };
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
      waitlistCoversDate(entry, appointment.dateKey) &&
      matchesTimePreference(entry.timePreference, appointment.startTime)
    );
  });
  for (const [id] of matches) delete database.waitlistEntries[id];
  return matches.map(([id]) => id);
};
