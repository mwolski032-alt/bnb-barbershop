import { get, ref, set, update } from "firebase/database";
import { getAuth } from "firebase/auth";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
} from "firebase/messaging";

import { firebaseApp, realtimeDb } from "./firebase";
import { resolvePushDeviceStatus } from "../../shared/push-notifications.mjs";

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

export type PushDeviceStatus =
  | "checking"
  | "enabled"
  | "disabled"
  | "blocked"
  | "unsupported"
  | "error";

export type SendPushResult = {
  ok: boolean;
  sent: number;
  targets: number;
  failed: number;
  error?: string;
  firstError?: string;
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

const pushOptOutKey = (uid: string) => `bnb-push-disabled:${uid}`;

export const isPushNotificationsLocallyDisabled = (uid: string) => {
  try {
    return window.localStorage.getItem(pushOptOutKey(uid)) === "true";
  } catch {
    return false;
  }
};

const setPushNotificationsLocallyDisabled = (uid: string, disabled: boolean) => {
  try {
    if (disabled) {
      window.localStorage.setItem(pushOptOutKey(uid), "true");
    } else {
      window.localStorage.removeItem(pushOptOutKey(uid));
    }
  } catch {
    // Firebase remains the binding source when local storage is unavailable.
  }
};

const getCurrentMessagingToken = async () => {
  if (!(await isSupported()) || !("serviceWorker" in navigator)) return "";

  const serviceWorkerRegistration = await navigator.serviceWorker.getRegistration();
  if (!serviceWorkerRegistration) return "";

  return getToken(getMessaging(firebaseApp), {
    vapidKey: readVapidKey(),
    serviceWorkerRegistration,
  });
};

export const getPushNotificationDeviceStatus = async (
  user: NotificationUser,
): Promise<PushDeviceStatus> => {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("PushManager" in window)
  ) {
    return "unsupported";
  }

  const permission = Notification.permission;
  const optedOut = isPushNotificationsLocallyDisabled(user.uid);
  if (permission !== "granted" || optedOut) {
    return resolvePushDeviceStatus({
      supported: true,
      permission,
      optedOut,
    }) as PushDeviceStatus;
  }

  try {
    if (!(await isSupported()) || !("serviceWorker" in navigator)) return "unsupported";
    const token = await getCurrentMessagingToken();
    if (!token) return "disabled";
    const snapshot = await get(
      ref(realtimeDb, `notificationTokens/${user.uid}/${tokenPathKey(token)}`),
    );
    return resolvePushDeviceStatus({
      supported: true,
      permission,
      tokenActive: snapshot.val()?.active === true,
    }) as PushDeviceStatus;
  } catch {
    return "error";
  }
};

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
    active: true,
    isAdmin,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    userAgent: navigator.userAgent,
    lastSeenAt: Date.now(),
    updatedAt: Date.now(),
  });
  setPushNotificationsLocallyDisabled(user.uid, false);

  return { ok: true };
};

export const disablePushNotifications = async (
  user: NotificationUser,
): Promise<PushRegistrationResult> => {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("PushManager" in window)
  ) {
    return { ok: false, reason: "unsupported_browser" };
  }

  if (Notification.permission !== "granted") {
    setPushNotificationsLocallyDisabled(user.uid, true);
    return { ok: true };
  }

  try {
    const token = await getCurrentMessagingToken();
    if (token) {
      await update(
        ref(realtimeDb, `notificationTokens/${user.uid}/${tokenPathKey(token)}`),
        {
          active: false,
          updatedAt: Date.now(),
        },
      );
      await deleteToken(getMessaging(firebaseApp)).catch(() => false);
    }
    setPushNotificationsLocallyDisabled(user.uid, true);
    return { ok: true };
  } catch {
    return { ok: false, reason: "token_error" };
  }
};

const requestTestNotification = async (
  appointment: {
    id: string;
    barberId: string;
    userId: string;
    clientName: string;
    serviceName: string;
    dateKey: string;
    startTime: string;
  },
): Promise<SendPushResult> => {
  try {
    const user = getAuth(firebaseApp).currentUser;
    if (!user) {
      return { ok: false, sent: 0, targets: 0, failed: 0, error: "Authentication required." };
    }
    const response = await fetch("/.netlify/functions/send-push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "test_push", appointment }),
    });
    const result = (await response.json().catch(() => null)) as Partial<SendPushResult> | null;

    if (!response.ok) {
      return {
        ok: false,
        sent: 0,
        targets: 0,
        failed: 0,
        error: result?.error ?? "Push notification request failed.",
      };
    }

    return {
      ok: result?.ok ?? true,
      sent: result?.sent ?? 0,
      targets: result?.targets ?? 0,
      failed: result?.failed ?? 0,
      firstError: result?.firstError,
      error: result?.error,
    };
  } catch {
    return { ok: false, sent: 0, targets: 0, failed: 0, error: "Push request failed." };
  }
};

export const sendTestNotification = async (user: NotificationUser) =>
  requestTestNotification({
    id: `test-${Date.now()}`,
    barberId: "mateusz",
    userId: user.uid,
    clientName: user.displayName ?? "Klient",
    serviceName: "Test powiadomienia",
    dateKey: new Date().toISOString().slice(0, 10),
    startTime: new Date().toTimeString().slice(0, 5),
  });

export const listenForForegroundPushNotifications = async (
  onNotification?: (payload: MessagePayload) => void,
) => {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !(await isSupported())
  ) {
    return () => undefined;
  }

  const messaging = getMessaging(firebaseApp);

  return onMessage(messaging, (payload: MessagePayload) => {
    onNotification?.(payload);
    const notification = payload.notification ?? {};
    const data = payload.data ?? {};
    const title = notification.title ?? data.title ?? "BNB Barbershop";
    const options = {
      body: notification.body ?? data.body ?? "Masz nowe powiadomienie.",
      icon: notification.icon ?? data.icon ?? "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag ?? "bnb-barbershop",
      data: {
        url: data.link ?? "/",
      },
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, options))
        .catch(() => new Notification(title, options));
      return;
    }

    new Notification(title, options);
  });
};
