export const APPOINTMENT_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const activeStatuses = new Set(["confirmed", "rescheduled"]);

const formatterFor = (timeZone) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

const zonedParts = (timestamp, formatter) =>
  Object.fromEntries(
    formatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

export const appointmentTimestamp = (
  dateKey,
  startTime,
  timeZone = "Europe/Warsaw",
) => {
  if (!datePattern.test(String(dateKey)) || !timePattern.test(String(startTime))) {
    return Number.NaN;
  }

  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [hour, minute] = String(startTime).split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = formatterFor(timeZone);
  let timestamp = targetAsUtc;

  // Intl does not expose the zone offset directly. Two short corrections are
  // enough to map a local wall-clock time to its UTC timestamp, including DST.
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = zonedParts(timestamp, formatter);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    timestamp += targetAsUtc - representedAsUtc;
  }

  const result = zonedParts(timestamp, formatter);
  if (
    result.year !== year ||
    result.month !== month ||
    result.day !== day ||
    result.hour !== hour ||
    result.minute !== minute
  ) {
    return Number.NaN;
  }
  return timestamp;
};

const keyPart = (value) =>
  String(value ?? "")
    .replace(/[.#$\[\]/]/g, "-")
    .slice(0, 120);

export const appointmentReminderOperationId = (appointment) =>
  `visit-reminder-${keyPart(appointment?.id)}-${keyPart(appointment?.dateKey)}-${keyPart(
    String(appointment?.startTime ?? "").replace(":", "-"),
  )}`;

export const enqueueAppointmentReminders = (
  database,
  now = Date.now(),
  timeZone = "Europe/Warsaw",
) => {
  database.appointmentOperations ??= {};
  database.notificationOutbox ??= {};
  const notificationOperationIds = [];

  for (const [id, rawAppointment] of Object.entries(database.appointments ?? {})) {
    const appointment = { ...rawAppointment, id: rawAppointment?.id || id };
    const status = appointment.status || "confirmed";
    if (!appointment.userId || !appointment.barberId || !activeStatuses.has(status)) continue;

    const startsAt = appointmentTimestamp(appointment.dateKey, appointment.startTime, timeZone);
    const reminderAt = startsAt - APPOINTMENT_REMINDER_LEAD_MS;
    // Queue in advance and let the durable outbox wake at the exact minute.
    // Visits booked less than 24 hours ahead do not get a misleading "tomorrow" alert.
    if (!Number.isFinite(startsAt) || reminderAt <= now) continue;

    const operationId = appointmentReminderOperationId(appointment);
    if (database.notificationOutbox[operationId] || database.appointmentOperations[operationId]) {
      continue;
    }

    const notificationAppointment = {
      ...appointment,
      id: appointment.id,
      lastOperationId: operationId,
    };
    database.appointmentOperations[operationId] = {
      operationId,
      action: "appointment_reminder",
      actorUid: "system",
      appointmentId: appointment.id,
      appointment: notificationAppointment,
      syncRevision: Number(database.appointmentSync?.revision) || 0,
      createdAt: now,
    };
    database.notificationOutbox[operationId] = {
      operationId,
      appointmentId: appointment.id,
      event: "appointment_reminder",
      barberId: appointment.barberId,
      userId: appointment.userId,
      status: "pending",
      attempts: 0,
      maxAttempts: 6,
      nextAttemptAt: reminderAt,
      deduplicationKey: operationId,
      createdAt: now,
      updatedAt: now,
    };
    notificationOperationIds.push(operationId);
  }

  return {
    changed: notificationOperationIds.length > 0,
    queuedCount: notificationOperationIds.length,
    notificationOperationIds,
  };
};
