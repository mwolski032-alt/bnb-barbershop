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
import { verifyNotificationActionToken } from "./lib/notification-action-token.mjs";

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

    const accessToken = await getAccessToken();
    const operationId = operationIdFor(token);
    const result = await mutateScopedDatabase(
      accessToken,
      (database) => confirmAppointment(database, claims, operationId),
      { actorUid: claims.userId, lockScope: "appointments" },
    );
    if (result.error) {
      return jsonResponse({ ok: false, error: result.error, code: result.code }, result.status || 409);
    }

    if (!result.idempotent && result.notificationOperationIds?.length) {
      const dispatch = processNotificationJob(operationId, {
        accessToken,
        siteUrl: resolveNotificationSiteUrl(request),
      }).catch(() => undefined);
      if (typeof context.waitUntil === "function") context.waitUntil(dispatch);
      else await dispatch;
    }

    return jsonResponse({
      ok: true,
      idempotent: result.idempotent === true,
      alreadyConfirmed: result.alreadyConfirmed === true,
      message: "Nowy termin wizyty został potwierdzony.",
      appointment: {
        id: result.appointment.id,
        dateKey: result.appointment.dateKey,
        startTime: result.appointment.startTime,
        status: result.appointment.status,
        version: result.appointment.version,
      },
    });
  } catch (error) {
    const isLeaseError = error instanceof DatabaseLeaseError;
    return jsonResponse(
      {
        ok: false,
        error: isLeaseError
          ? error.message
          : "Nie udało się potwierdzić terminu. Otwórz szczegóły i spróbuj ponownie.",
      },
      isLeaseError ? 409 : 500,
    );
  }
};

export default handler;
