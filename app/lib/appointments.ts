import { getAuth } from "firebase/auth";

import { firebaseApp } from "./firebase";

type AppointmentMutationAction =
  | "create_client"
  | "reschedule_client"
  | "confirm_client"
  | "confirm_admin"
  | "cancel_client"
  | "create_admin"
  | "reschedule_admin"
  | "cancel_admin"
  | "settle_admin";

type AppointmentApiResult<T> = {
  ok: boolean;
  error?: string;
  appointment?: T;
  occupancy?: Array<{
    id: string;
    barberId: string;
    dateKey: string;
    startTime: string;
    durationMinutes: number;
  }>;
  clientAppointments?: T[];
  adminAppointments?: T[];
};

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
    throw new Error(result?.error || "Nie udało się zapisać zmian. Spróbuj ponownie.");
  }
  return result;
};

export const mutateAppointment = async <T>(
  action: AppointmentMutationAction,
  payload: Record<string, unknown>,
) => {
  const response = await fetch("/.netlify/functions/appointments", {
    method: "POST",
    headers: await getAuthorizationHeaders(),
    body: JSON.stringify({ action, ...payload }),
  });
  return readResult<T>(response);
};

export const fetchClientAppointmentData = async <T>() => {
  const response = await fetch("/.netlify/functions/appointments", {
    method: "GET",
    headers: await getAuthorizationHeaders(),
    cache: "no-store",
  });
  return readResult<T>(response);
};
