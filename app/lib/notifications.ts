import { getToken, getMessaging, isSupported } from "firebase/messaging";
import { ref, set } from "firebase/database";

import { firebaseApp, realtimeDb } from "./firebase";

type NotificationUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
};

export type PushRegistrationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported_browser"
        | "missing_vapid_key"
        | "unsupported_firebase_messaging"
        | "permission_denied"
        | "service_worker_unavailable"
        | "token_unavailable"
        | "token_error";
    };

const fallbackVapidKey =
  "BGsfxDp9YC0FwBQOvxytQHKSy9-U5x15LCFl76w3Jlj3-dtPDADSV7VbKSc4q-JRyLXSOhwt9NAmX1H17aco5YU";

const readVapidKey = () =>
  (import.meta.env.VITE_FIREBASE_VAPID_KEY ||
    import.meta.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
    fallbackVapidKey) as string | undefined;

const tokenPathKey = (token: string) =>
  token
    .replaceAll(".", "_")
    .replaceAll("#", "_")
    .replaceAll("$", "_")
    .replaceAll("[", "_")
    .replaceAll("]", "_")
    .replaceAll("/", "_");

export const registerPushNotifications = async (
  user: NotificationUser,
  isAdmin: boolean,
): Promise<PushRegistrationResult> => {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("PushManager" in window)
  ) {
    return { ok: false, reason: "unsupported_browser" };
  }

  const vapidKey = readVapidKey();
  if (!vapidKey) {
    return { ok: false, reason: "missing_vapid_key" };
  }

  if (!(await isSupported())) {
    return { ok: false, reason: "unsupported_firebase_messaging" };
  }

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

  if (permission !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "service_worker_unavailable" };
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(firebaseApp);
  let token = "";

  try {
    token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    });
  } catch {
    return { ok: false, reason: "token_error" };
  }

  if (!token) {
    return { ok: false, reason: "token_unavailable" };
  }

  await set(ref(realtimeDb, `notificationTokens/${user.uid}/${tokenPathKey(token)}`), {
    token,
    isAdmin,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    updatedAt: Date.now(),
  });

  return { ok: true };
};

export const sendAppointmentNotification = async (
  event:
    | "new_booking"
    | "client_rescheduled"
    | "client_cancelled"
    | "admin_rescheduled"
    | "admin_cancelled",
  appointment: {
    id: string;
    userId?: string;
    clientName: string;
    serviceName: string;
    dateKey: string;
    startTime: string;
  },
) => {
  try {
    await fetch("/.netlify/functions/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, appointment }),
    });
  } catch {
    // Powiadomienia nie mogą blokować rezerwacji ani edycji wizyty.
  }
};
