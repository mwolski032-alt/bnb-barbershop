import crypto from "node:crypto";

import {
  DatabaseLeaseError,
  getAccessToken,
  jsonResponse,
} from "./_firebase-admin.mjs";
import {
  processNotificationJob,
  resolveNotificationSiteUrl,
} from "./_notification-service.mjs";
import { mutateScopedDatabase } from "./_scoped-database.mjs";
import { isBookableStartTime } from "../../shared/booking-time.mjs";
import {
  BARBER_CONFIRM_ACTION,
  BARBER_REFUSE_ACTION,
  CLIENT_CONFIRM_ACTION,
  DECLINE_OFFER_ACTION,
  verifyNotificationActionToken,
} from "./lib/notification-action-token.mjs";
import { refuseClientReschedule, withoutPreviousSchedule } from "../../shared/reschedule-refusal.mjs";
import { advanceExpiredWaitlistOffers, hasBlockingWaitlistOffer } from "../../shared/waitlist.mjs";

const operationIdFor = (token) =>
  `push-confirm-${crypto.createHash("sha256").update(token).digest("hex").slice(0, 48)}`;

const sameSchedule = (appointment, claims) =>
  appointment?.userId === claims.userId &&
  appointment?.dateKey === claims.dateKey &&
  appointment?.startTime === claims.startTime;

const enqueueConfirmationNotification = (database, appointment, operationId, now) => {
  database.notificationOutbox ??= {};
  database.notificationOutbox[operationId] = {
    operationId,
    appointmentId: appointment.id,
    event: "client_confirmed",
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

const confirmAppointment = (database, claims, operationId) => {
  database.appointmentOperations ??= {};
  database.appointments ??= {};
  const current = database.appointments[claims.appointmentId];
  const existingOperation = database.appointmentOperations[operationId];
  if (existingOperation) {
    if (
      existingOperation.action !== "confirm_client_notification" ||
      existingOperation.actorUid !== claims.userId ||
      existingOperation.appointmentId !== claims.appointmentId
    ) {
      return { error: "To potwierdzenie zostało już wykorzystane.", status: 409 };
    }
    if (!current || current.status !== "confirmed" || !sameSchedule(current, claims)) {
      return {
        error: "Termin tej wizyty został już zmieniony. Otwórz szczegóły, aby zobaczyć aktualne dane.",
        code: "stale_notification",
        status: 409,
      };
    }
    return {
      database,
      appointment: current,
      operationId,
      idempotent: true,
    };
  }

  if (!current || current.userId !== claims.userId) {
    return { error: "Nie znaleziono tej wizyty.", status: 404 };
  }
  if (current.status === "confirmed" && sameSchedule(current, claims)) {
    return {
      database,
      appointment: current,
      operationId,
      alreadyConfirmed: true,
      idempotent: true,
    };
  }
  if (
    current.status !== "rescheduled" ||
    current.rescheduledBy !== "admin" ||
    !sameSchedule(current, claims) ||
    Number(current.version) !== claims.appointmentVersion ||
    current.lastOperationId !== claims.scheduleOperationId
  ) {
    return {
      error: "Termin tej wizyty został już zmieniony. Otwórz szczegóły, aby zobaczyć aktualne dane.",
      code: "stale_notification",
      status: 409,
    };
  }
  if (!isBookableStartTime(current.dateKey, current.startTime)) {
    return { error: "Ten termin już minął.", code: "appointment_passed", status: 409 };
  }

  const now = Date.now();
  const next = {
    ...current,
    status: "confirmed",
    confirmedAt: now,
    confirmedBy: "client",
    version: Math.max(1, Number(current.version) || 1) + 1,
    lastOperationId: operationId,
    updatedAt: now,
  };
  database.appointments[claims.appointmentId] = next;
  database.appointmentOperations[operationId] = {
    operationId,
    action: "confirm_client_notification",
    actorUid: claims.userId,
    appointmentId: next.id,
    appointment: next,
    notificationOperationIds: [operationId],
    syncRevision: 0,
    createdAt: now,
  };
  enqueueConfirmationNotification(database, next, operationId, now);
  return {
    database,
    appointment: next,
    operationId,
    notificationOperationIds: [operationId],
    notificationUserIds: [claims.userId],
    syncRevision: 0,
  };
};

const enqueueAnswerNotification = (database, appointment, operationId, event, now) => {
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

const barberMayAnswer = (database, appointment, userId) => {
  const member = database.team?.barbers?.[appointment.barberId];
  return member?.active === true && member.userId === userId;
};

const STALE = {
  error: "Termin tej wizyty został już zmieniony. Otwórz szczegóły, aby zobaczyć aktualne dane.",
  code: "stale_notification",
  status: 409,
};

// The barber answers a visit the client moved, straight from the notification: confirm the new term, or
// refuse it, which brings the visit back to its old term and asks the client for another one.
const answerClientMove = (database, claims, operationId, now) => {
  const refusing = claims.action === BARBER_REFUSE_ACTION;
  database.appointmentOperations ??= {};
  database.appointments ??= {};
  const current = database.appointments[claims.appointmentId];
  const existingOperation = database.appointmentOperations[operationId];
  if (existingOperation) {
    return current && existingOperation.actorUid === claims.userId
      ? { database, appointment: current, operationId, idempotent: true }
      : { error: "To potwierdzenie zostało już wykorzystane.", status: 409 };
  }
  if (!current || !barberMayAnswer(database, current, claims.userId)) {
    return { error: "Nie znaleziono tej wizyty.", status: 404 };
  }
  if (
    current.status !== "rescheduled" ||
    current.rescheduledBy !== "client" ||
    current.dateKey !== claims.dateKey ||
    current.startTime !== claims.startTime ||
    Number(current.version) !== claims.appointmentVersion ||
    current.lastOperationId !== claims.scheduleOperationId
  ) {
    // Already answered (in the app or by another button) or moved again: nothing to do, and nothing to repeat.
    return STALE;
  }

  let next;
  if (refusing) {
    const refusal = refuseClientReschedule(database.appointments, current, {
      now,
      isHeld: (restored) => hasBlockingWaitlistOffer(database, restored, restored.userId || "", now),
    });
    if (refusal.error) return { error: refusal.error, code: "cannot_refuse", status: 409 };
    next = refusal.appointment;
  } else {
    next = withoutPreviousSchedule({ ...current, status: "confirmed", confirmedAt: now, confirmedBy: "admin" });
  }
  next = {
    ...next,
    version: Math.max(1, Number(current.version) || 1) + 1,
    lastOperationId: operationId,
    updatedAt: now,
  };
  database.appointments[claims.appointmentId] = next;
  database.appointmentOperations[operationId] = {
    operationId,
    action: refusing ? "refuse_admin" : "confirm_admin",
    actorUid: claims.userId,
    appointmentId: next.id,
    appointment: next,
    notificationOperationIds: [operationId],
    syncRevision: 0,
    createdAt: now,
  };
  enqueueAnswerNotification(database, next, operationId, refusing ? "admin_reschedule_refused" : "admin_confirmed", now);
  return {
    database,
    appointment: next,
    operationId,
    notificationOperationIds: [operationId],
    notificationUserIds: [next.userId],
    syncRevision: 0,
  };
};

// "Nie, dziękuję" on a held waiting-list slot: the offer ends now and the slot goes to the next person.
const declineWaitlistOffer = (database, claims, _operationId, now) => {
  const entry = database.waitlistEntries?.[claims.waitlistId];
  if (!entry || entry.userId !== claims.userId) return { error: "Nie znaleziono tego zapisu.", status: 404 };
  if (
    entry.status !== "offered" ||
    entry.offer?.dateKey !== claims.dateKey ||
    entry.offer?.startTime !== claims.startTime
  ) {
    return { database, idempotent: true, alreadyHandled: true };
  }
  database.waitlistEntries[claims.waitlistId] = {
    ...entry,
    offer: { ...entry.offer, expiresAt: now },
    updatedAt: now,
  };
  const advanced = advanceExpiredWaitlistOffers(database, now);
  return {
    database,
    notificationOperationIds: advanced.notificationOperationIds,
    notificationUserIds: [claims.userId],
    syncRevision: 0,
  };
};

const answers = {
  [CLIENT_CONFIRM_ACTION]: {
    run: confirmAppointment,
    done: "Nowy termin wizyty został potwierdzony.",
  },
  [BARBER_CONFIRM_ACTION]: {
    run: answerClientMove,
    done: "Nowy termin został potwierdzony. Klient dostał wiadomość.",
  },
  [BARBER_REFUSE_ACTION]: {
    run: answerClientMove,
    done: "Wizyta wróciła do poprzedniego terminu. Klient dostał prośbę o wybranie innego.",
  },
  [DECLINE_OFFER_ACTION]: {
    run: declineWaitlistOffer,
    done: "Dziękujemy. Termin trafi do kolejnej osoby.",
  },
};

const handler = async (request, context = {}) => {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const contentLength = Number(request.headers.get("content-length")) || 0;
    if (contentLength > 8192) {
      return jsonResponse({ ok: false, error: "Nieprawidłowe potwierdzenie." }, 413);
    }
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token || "");
    const claims = verifyNotificationActionToken(token);
    if (!claims) {
      return jsonResponse(
        { ok: false, error: "To potwierdzenie wygasło. Otwórz szczegóły wizyty." },
        401,
      );
    }

    const answer = answers[claims.action];
    const accessToken = await getAccessToken();
    const operationId = operationIdFor(token);
    const now = Date.now();
    const result = await mutateScopedDatabase(
      accessToken,
      (database) => answer.run(database, claims, operationId, now),
      { actorUid: claims.userId, lockScope: "appointments" },
    );
    if (result.error) {
      return jsonResponse({ ok: false, error: result.error, code: result.code }, result.status || 409);
    }

    if (!result.idempotent && result.notificationOperationIds?.length) {
      const siteUrl = resolveNotificationSiteUrl(request);
      const dispatch = Promise.all(
        result.notificationOperationIds.map((id) => processNotificationJob(id, { accessToken, siteUrl })),
      ).catch(() => undefined);
      if (typeof context.waitUntil === "function") context.waitUntil(dispatch);
      else await dispatch;
    }

    return jsonResponse({
      ok: true,
      idempotent: result.idempotent === true,
      alreadyConfirmed: result.alreadyConfirmed === true,
      message: result.alreadyHandled ? "Ta oferta została już wykorzystana lub wygasła." : answer.done,
      ...(result.appointment
        ? {
            appointment: {
              id: result.appointment.id,
              dateKey: result.appointment.dateKey,
              startTime: result.appointment.startTime,
              status: result.appointment.status,
              version: result.appointment.version,
            },
          }
        : {}),
    });
  } catch (error) {
    const isLeaseError = error instanceof DatabaseLeaseError;
    return jsonResponse(
      {
        ok: false,
        error: isLeaseError
          ? error.message
          : "Nie udało się wykonać akcji. Otwórz aplikację i spróbuj ponownie.",
      },
      isLeaseError ? 409 : 500,
    );
  }
};

export default handler;
