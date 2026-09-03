import { getAuth } from "firebase/auth";

import { firebaseApp } from "./firebase";

export type AppointmentMutationAction =
  | "create_client"
  | "reschedule_client"
  | "confirm_client"
  | "confirm_admin"
  | "cancel_client"
  | "create_admin"
  | "reschedule_admin"
  | "cancel_admin"
  | "settle_admin"
  | "mark_no_show_admin"
  | "upsert_admin_client"
  | "hide_admin_client"
  | "delete_admin_client"
  | "join_waitlist"
  | "leave_waitlist"
  | "remove_waitlist_admin";

export type AppointmentApiResult<T> = {
  ok: boolean;
  error?: string;
  code?: "stale_version" | "operation_conflict";
  operationId?: string;
  idempotent?: boolean;
  syncRevision?: number;
  appointment?: T;
  currentAppointment?: T;
  client?: unknown;
  waitlistEntry?: unknown;
  notificationQueued?: boolean;
  notificationOperationIds?: string[];
  occupancy?: Array<{
    id: string;
    barberId: string;
    dateKey: string;
    startTime: string;
    durationMinutes: number;
  }>;
  clientAppointments?: T[];
  adminAppointments?: T[];
  adminClients?: unknown[];
  clientWaitlist?: unknown[];
  adminWaitlist?: unknown[];
  teamMembers?: unknown[];
  context?: {
    role: "owner" | "barber" | "client";
    assignedRole?: "barber";
    active: boolean;
    isAdmin: boolean;
    isOwner: boolean;
    barberId: string;
    access: Record<string, boolean>;
    roleError?: "conflicting_barber_assignment";
  };
};

export class AppointmentApiError<T> extends Error {
  result: AppointmentApiResult<T> | null;
  status: number;

  constructor(message: string, result: AppointmentApiResult<T> | null, status: number) {
    super(message);
    this.name = "AppointmentApiError";
    this.result = result;
    this.status = status;
  }
}

export const createAppointmentOperationId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `operation-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

const getAuthorizationHeaders = async () => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Sesja wygasła. Zaloguj się ponownie.");
  return {
    Authorization: `Bearer ${await user.getIdToken()}`,
    "Content-Type": "application/json",
  };
};

const readResult = async <T>(response: Response) => {
  const result = (await response.json().catch(() => null)) as AppointmentApiResult<T> | null;
  if (!response.ok || !result?.ok) {
    throw new AppointmentApiError(
      result?.error || "Nie udało się zapisać zmian. Spróbuj ponownie.",
      result,
      response.status,
    );
  }
  return result;
};

export const mutateAppointment = async <T>(
  action: AppointmentMutationAction,
  payload: Record<string, unknown>,
  options: { operationId: string; expectedVersion: number },
) => {
  const headers = await getAuthorizationHeaders();
  const response = await fetch("/.netlify/functions/appointments", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action,
      operationId: options.operationId,
      expectedVersion: options.expectedVersion,
      ...payload,
    }),
  });
  const result = await readResult<T>(response);
  if (result.notificationOperationIds?.length) {
    void fetch("/.netlify/functions/notification-dispatch", {
      method: "POST",
      headers,
      body: JSON.stringify({ operationIds: result.notificationOperationIds }),
      keepalive: true,
    }).catch(() => undefined);
  }
  return result;
};

export const fetchClientAppointmentData = async <T>() => {
  const response = await fetch("/.netlify/functions/appointments", {
    method: "GET",
    headers: await getAuthorizationHeaders(),
    cache: "no-store",
  });
  return readResult<T>(response);
};
