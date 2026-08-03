import { getToken, getMessaging, isSupported } from "firebase/messaging";
import { ref, set } from "firebase/database";

import { firebaseApp, realtimeDb } from "./firebase";

type NotificationUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
};

const readVapidKey = () => import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

const tokenPathKey = (token: string) =>
  token
    .replaceAll(".", "_")
    .replaceAll("#", "_")
    .replaceAll("$", "_")
    .replaceAll("[", "_")
    .replaceAll("]", "_")
    .replaceAll("/", "_");

export const registerPushNotifications = async (user: NotificationUser, isAdmin: boolean) => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  const vapidKey = readVapidKey();
  if (!vapidKey || !(await isSupported())) {
    return false;
  }

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

  if (permission !== "granted") {
    return false;
  }

  const serviceWorkerRegistration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration,
  });

  if (!token) {
    return false;
  }

  await set(ref(realtimeDb, `notificationTokens/${user.uid}/${tokenPathKey(token)}`), {
    token,
    isAdmin,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    updatedAt: Date.now(),
  });

  return true;
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
